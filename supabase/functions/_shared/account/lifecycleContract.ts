// supabase/functions/_shared/account/lifecycleContract.ts
// Decision 27 / TECH-SPEC §7.13 — the delete-account request contract.
//
// Pure and Deno-free so jest can load it (`lib/account.test.ts`), mirroring the
// `flagContract` pattern. The confirmation word is exact and case-sensitive: a client that
// sends "reset" to the reset mode is refused, because the whole point of type-to-confirm is
// that the caller had to read the copy.

export type AccountMode = "reset" | "delete";

export type ParsedAccountBody =
  | { ok: true; mode: AccountMode }
  | { ok: false; status: number; error: string };

export function confirmationWord(mode: AccountMode): "RESET" | "DELETE" {
  return mode === "reset" ? "RESET" : "DELETE";
}

export function parseAccountBody(body: unknown): ParsedAccountBody {
  if (typeof body !== "object" || body === null) {
    return { ok: false, status: 400, error: "Body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  const mode = record.mode;
  const confirm = record.confirm;

  if (mode !== "reset" && mode !== "delete") {
    return { ok: false, status: 400, error: 'mode must be "reset" or "delete"' };
  }
  const expected = confirmationWord(mode);
  if (confirm !== expected) {
    return { ok: false, status: 400, error: `confirm must be "${expected}"` };
  }
  return { ok: true, mode };
}
