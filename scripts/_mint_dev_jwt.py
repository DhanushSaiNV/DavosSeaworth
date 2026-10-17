#!/usr/bin/env python3
"""Mint a fresh Supabase user access token for the env-gated verify scripts.

Why this exists. The gates need a signed-in user JWT (`DAVOS_USER_JWT`); the documented way to
get one is to sign in on the web build and copy it out of devtools. That makes every gated run
depend on a manual paste, and a token shelved in `.env` fails with `PGRST303: JWT expired`
long before anyone notices it went stale.

This mints one non-interactively from the service-role key the gates already require: it asks
the admin API for a magic link for a user (which returns `email_otp`) and exchanges that OTP
through the same `verify` endpoint the app's VerifyCodeScreen uses. No email is sent, no SMTP,
no dashboard, no browser.

  admin : POST /auth/v1/admin/generate_link {type: magiclink, email}          -> email_otp
  auth  : POST /auth/v1/verify             {type: email, email, token: <otp>} -> access_token

Which user? In order: `--email` / `DAVOS_USER_EMAIL`; else the `sub` of whatever
`DAVOS_USER_JWT` is currently set, so a run keeps the identity earlier gates used; else the
only user; else the most recently signed-in one (with a warning).

Usage (PowerShell):
  $env:DAVOS_USER_JWT = python scripts/_mint_dev_jwt.py   # fresh token on stdout
  python scripts/_mint_dev_jwt.py --claims                # exp/iat/iss/sub only; token withheld
  python scripts/_mint_dev_jwt.py --list-users
  python scripts/_mint_dev_jwt.py --email you@example.com

Importable (this is how `verify-fp04-step1.py` uses it):
  from _mint_dev_jwt import mint_for_gates
  token, claims = mint_for_gates(url, service, email)     # (None, None) when it cannot mint

Security: dev tooling only. It holds the service-role key (already required by the gates) and
mints a session for an existing user without email delivery -- an admin capability. Keep it to
local runs; never ship the service-role key or this helper to the client (AGENTS.md 4.5).
"""

import argparse
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ---------------------------------------------------------------- env / http

def load_dotenv():
    """Fill os.environ from the repo-root .env without clobbering real environment vars."""
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as fh:
        for line in fh:
            m = re.match(r"^\s*([A-Za-z_]\w*)\s*=\s*(.*)$", line)
            if m:
                os.environ.setdefault(m.group(1), m.group(2).strip().strip('"').strip("'"))


def resolved_url():
    return (os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")


def resolved_service():
    return os.environ.get("SUPABASE_SERVICE_ROLE_KEY")


def _call(url, service, method, path, body=None, timeout=60):
    h = {"Content-Type": "application/json"}
    if service:
        h["apikey"] = service
        h["Authorization"] = f"Bearer {service}"
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:  # noqa: BLE001
            return e.code, {"raw": raw[:400]}


# ---------------------------------------------------------------- jwt helpers

def _b64d(seg):
    seg += "=" * (-len(seg) % 4)
    return base64.urlsafe_b64decode(seg)


def decode_jwt_claims(token):
    """The token's claims, or None if it is not a decodable JWT. No signature check -- this is
    diagnostics, not authentication (the server still verifies the signature)."""
    if not token:
        return None
    try:
        claims = json.loads(_b64d(token.split(".")[1]))
        return claims if isinstance(claims, dict) else None
    except Exception:  # noqa: BLE001
        return None


def iso(ts):
    try:
        return datetime.fromtimestamp(float(ts), timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
    except Exception:  # noqa: BLE001
        return "?"


# ---------------------------------------------------------------- admin api

def list_users(url, service):
    st, body = _call(url, service, "GET", "/auth/v1/admin/users?per_page=200")
    if st != 200 or not isinstance(body, dict):
        raise RuntimeError(f"admin/users failed: {st} {body}")
    return body.get("users", [])


def _pick_user(users, email=None, sub=None):
    if email:
        for u in users:
            if (u.get("email") or "").lower() == email.lower():
                return u, f"--email {email}"
        return None, f"no user with email {email}"
    if sub:
        for u in users:
            if u.get("id") == sub:
                return u, "sub of the current DAVOS_USER_JWT"
    if len(users) == 1:
        return users[0], "only user"
    signed = [u for u in users if u.get("last_sign_in_at")]
    pool = signed or users
    if pool:
        best = max(pool, key=lambda u: u.get("last_sign_in_at") or "")
        return best, "most recently signed-in (pass --email to pin it)"
    return None, "no users"


def mint_access_token(url, service, email):
    """(token, claims). Raises RuntimeError with the server's own message on failure."""
    st, body = _call(url, service, "POST", "/auth/v1/admin/generate_link",
                     {"type": "magiclink", "email": email})
    if st != 200 or not isinstance(body, dict):
        raise RuntimeError(f"generate_link failed: {st} {body}")
    otp = body.get("email_otp")
    if not otp:
        raise RuntimeError("generate_link returned no email_otp")
    st, body = _call(url, service, "POST", "/auth/v1/verify",
                     {"type": "email", "email": email, "token": otp})
    if st != 200 or not isinstance(body, dict) or not body.get("access_token"):
        raise RuntimeError(f"verify failed: {st} {body}")
    token = body["access_token"]
    return token, (decode_jwt_claims(token) or {})


def mint_for_gates(url=None, service=None, email=None):
    """Best-effort: (token, claims) or (None, None). Never raises -- a gate should be able to
    report 'could not mint' without a traceback."""
    url = (url or resolved_url())
    service = service or resolved_service()
    if not url or not service:
        return None, None
    try:
        users = list_users(url, service)
    except Exception:  # noqa: BLE001
        return None, None
    current = os.environ.get("DAVOS_USER_JWT")
    sub = (decode_jwt_claims(current) or {}).get("sub") if current else None
    user, _reason = _pick_user(users, email=email or os.environ.get("DAVOS_USER_EMAIL"), sub=sub)
    if not user:
        return None, None
    try:
        return mint_access_token(url, service, user["email"])
    except Exception:  # noqa: BLE001
        return None, None


# ---------------------------------------------------------------- cli

def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--email", help="user to mint for (default: DAVOS_USER_EMAIL, else inferred)")
    ap.add_argument("--claims", action="store_true",
                    help="print exp/iat/iss/sub to stderr and withhold the token")
    ap.add_argument("--list-users", action="store_true", help="list candidates and exit")
    args = ap.parse_args()

    load_dotenv()
    url, service = resolved_url(), resolved_service()
    if not url or not service:
        sys.exit("_mint_dev_jwt: need SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and "
                 "SUPABASE_SERVICE_ROLE_KEY")

    try:
        users = list_users(url, service)
    except RuntimeError as e:
        sys.exit(f"_mint_dev_jwt: {e}")

    if args.list_users:
        for u in users:
            print(f"{u.get('email')}  id={u.get('id')}  last_sign_in={u.get('last_sign_in_at')}")
        return

    current = os.environ.get("DAVOS_USER_JWT")
    sub = (decode_jwt_claims(current) or {}).get("sub") if current else None
    user, reason = _pick_user(users, email=args.email or os.environ.get("DAVOS_USER_EMAIL"), sub=sub)
    if not user:
        sys.exit(f"_mint_dev_jwt: {reason}")

    try:
        token, claims = mint_access_token(url, service, user["email"])
    except RuntimeError as e:
        sys.exit(f"_mint_dev_jwt: {e}")

    if args.claims:
        exp, iat = claims.get("exp", 0), claims.get("iat", 0)
        print(f"user     : {user['email']}  ({reason})", file=sys.stderr)
        print(f"sub      : {claims.get('sub')}", file=sys.stderr)
        print(f"iat      : {iso(iat)}", file=sys.stderr)
        print(f"exp      : {iso(exp)}  (lifetime {exp - iat}s)", file=sys.stderr)
        print(f"iss / aud: {claims.get('iss')} / {claims.get('aud')}", file=sys.stderr)
        print("token withheld (drop --claims to print it)", file=sys.stderr)
        return

    print(token)


if __name__ == "__main__":
    main()
