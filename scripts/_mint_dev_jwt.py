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

Importable -- the FP-04 gates use the resolver, older gates the announce:
  from _mint_dev_jwt import resolve_gate_token
  token, usable, note = resolve_gate_token(supplied=os.environ.get("DAVOS_USER_JWT"))
      # prints exactly which token this run will send, and returns usable=False rather than
      # handing back a token already known to be expired (the old, unexplained 401s).

  from _mint_dev_jwt import announce_token           # print-only variant
  announce_token(os.environ.get("DAVOS_USER_JWT"), "supplied $DAVOS_USER_JWT")

  from _mint_dev_jwt import mint_for_gates           # unchanged; (token, claims) or (None, None)
  from _mint_dev_jwt import mint_for_gates_detailed  # same, plus the reason it could not mint

Token announcement. Every gate prints the JWT it is about to send -- source, `sub`, `iat`/`exp`
with the remaining lifetime, a plain verdict, and the raw token -- so a 401 can never be a
mystery again (owner request, 2026-10-17). `resolve_gate_token` never sends a token it has
already decoded as expired: it mints a fresh one, or tells the gate to skip.

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
import time
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


def token_state(token, now=None):
    """(usable, claims, verdict) for a gate about to send this token. Never raises.

    `usable` is False for an absent / undecodable / expired token: the whole point is that a
    gate must never *send* a token it can already see is dead. The signature is not checked
    here -- the server still verifies it; this is the pre-flight our own gates were missing."""
    now = time.time() if now is None else now
    if not token:
        return False, None, "absent"
    claims = decode_jwt_claims(token)
    if not claims:
        return False, None, "not a decodable JWT"
    exp = claims.get("exp")
    if not exp:
        return False, claims, "no `exp` claim"
    if exp <= now:
        return False, claims, f"EXPIRED {iso(exp)} ({int((now - exp) / 60)} min ago)"
    return True, claims, f"valid until {iso(exp)} ({int((exp - now) / 60)} min left)"


def announce_token(token, source, claims=None, verdict=None, show_token=True, stream=None):
    """Print exactly which JWT this run is using, and return whether it is usable.

    Printed on every run, valid or not: the confusing case is a token that came from somewhere
    unexpected (`.env`, the mint fallback, or a mint that silently failed), and that is only
    visible if the identity and the expiry are on screen before the requests go out."""
    out = sys.stdout if stream is None else stream
    usable, state_claims, state_verdict = token_state(token)
    claims = claims if claims is not None else state_claims
    verdict = verdict if verdict is not None else state_verdict
    claims = claims or {}
    print(f"  JWT   source : {source}", file=out)
    if not token:
        print(f"  JWT   verdict: {verdict}", file=out)
        return usable
    iat, exp = claims.get("iat"), claims.get("exp")
    lifetime = f"lifetime {exp - iat}s, " if (iat and exp) else ""
    print(f"  JWT   sub    : {claims.get('sub')}", file=out)
    print(f"  JWT   iat    : {iso(iat)}", file=out)
    print(f"  JWT   exp    : {iso(exp)}  ({lifetime}now {iso(time.time())})", file=out)
    print(f"  JWT   aud    : {claims.get('aud')}   role: {claims.get('role')}", file=out)
    print(f"  JWT   verdict: {verdict}", file=out)
    if show_token:
        print(f"  JWT   token  : {token}", file=out)
    return usable


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


def mint_for_gates_detailed(url=None, service=None, email=None):
    """Like `mint_for_gates`, but reports WHY it could not mint. Returns
    {token, claims, email, reason, error}. `mint_for_gates` swallows every failure, so a gate
    could only ever say "minting failed" -- with no reason, which is a dead end. Keep it."""
    url = url or resolved_url()
    service = service or resolved_service()
    if not url or not service:
        return {"token": None, "claims": None, "email": None, "reason": None,
                "error": "need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to mint"}
    try:
        users = list_users(url, service)
    except Exception as e:  # noqa: BLE001
        return {"token": None, "claims": None, "email": None, "reason": None,
                "error": f"admin/users failed: {e}"}
    current = os.environ.get("DAVOS_USER_JWT")
    sub = (decode_jwt_claims(current) or {}).get("sub") if current else None
    user, reason = _pick_user(users, email=email or os.environ.get("DAVOS_USER_EMAIL"), sub=sub)
    if not user:
        return {"token": None, "claims": None, "email": None, "reason": reason,
                "error": f"no user to mint for: {reason}"}
    try:
        token, claims = mint_access_token(url, service, user["email"])
    except Exception as e:  # noqa: BLE001
        return {"token": None, "claims": None, "email": user["email"], "reason": reason,
                "error": f"minting for {user['email']} failed: {e}"}
    return {"token": token, "claims": claims, "email": user["email"], "reason": reason,
            "error": None}


def mint_for_gates(url=None, service=None, email=None):
    """Best-effort: (token, claims) or (None, None). Never raises -- a gate should be able to
    report 'could not mint' without a traceback. See `mint_for_gates_detailed` for the reason."""
    res = mint_for_gates_detailed(url, service, email)
    return res["token"], res["claims"]


def resolve_gate_token(supplied=None, url=None, service=None, email=None, allow_mint=True,
                       label="user JWT"):
    """The single place a gate decides which user JWT to send -- and prints it.

    Returns (token, usable, note). `note` is short, for the gate's own PASS line. When `usable`
    is False the caller MUST skip its authenticated legs rather than send a dead token; that
    skip is the fix for the old "everything 401s with JWT expired and I cannot see why"."""
    supplied = supplied if supplied is not None else os.environ.get("DAVOS_USER_JWT")
    url = url or resolved_url()
    service = service or resolved_service()
    usable, claims, verdict = token_state(supplied)

    if usable:
        announce_token(supplied, "supplied $DAVOS_USER_JWT", claims, verdict)
        return supplied, True, f"supplied, {verdict}"

    announce_token(
        supplied,
        "supplied $DAVOS_USER_JWT (unusable)" if supplied else "no $DAVOS_USER_JWT supplied",
    )
    if not allow_mint:
        print(f"  JWT   note   : --no-mint: not minting; no usable {label}")
        return supplied, False, f"no usable {label} (minting disabled)"

    print("  JWT   note   : minting a fresh token via the admin API ...")
    res = mint_for_gates_detailed(url, service, email)
    if not res["token"]:
        print(f"  JWT   note   : mint failed -- {res['error']}")
        return supplied, False, f"no usable {label} (mint failed)"

    usable, claims, verdict = token_state(res["token"])
    announce_token(res["token"],
                   f"minted via the admin API for {res['email']} ({res['reason']})",
                   claims, verdict)
    if not usable:  # a freshly minted token that is already dead is a bug worth surfacing
        return res["token"], False, f"minted token is unusable ({verdict})"
    return res["token"], True, f"minted for {res['email']}, {verdict}"


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
