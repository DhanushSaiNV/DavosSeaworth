# Repair Prompt

Preamble: "You are a senior software engineer. Fix the issues below in C:\Users\dhanu\Documents\codes\RepoDestinations\DavosSeaworth. Work only on required changes; no unrelated refactoring unless necessary for a fix."

## Context — base ref, target ref, conventions

- **Base commit**: `24324978ff3caf4ff2a9caec31ae70501f2a96b8` ("Guard one primary reply per user message and repair unanswered turns")
- **Target**: Working tree (staged + unstaged + untracked changes implementing FP-02 Step 5b + FP-BG catalog)
- **Conventions**: AGENTS.md (non-negotiable constraints, change protocol, naming), TECH-SPECS.md (implementation details, [SPEC] values in config), GLOSSARY.md (terminology), PRD (ULTIMATE-PRD1.md)
- **Stack**: Expo Router (TypeScript), React Native primitives, Supabase (Edge Functions Deno, pgvector, pg_cron), Jest + ESLint flat + Prettier

## Required Changes — ordered Blocker→Minor

### 1. [Minor] Add crypto polyfill for UUID generator — File: `lib/ids.ts:31-37`

**Current code:**
```typescript
function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const source = (globalThis as {
    crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
  }).crypto;
  if (typeof source?.getRandomValues === "function") {
    source.getRandomValues(out);
    return out;
  }
  // Hermes without a crypto polyfill. Math.random is fine for a dedupe key.
  for (let i = 0; i < length; i += 1) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}
```

**Required change:** Add `expo-crypto` (already in Expo SDK) to guarantee `crypto.getRandomValues` availability. Remove the `Math.random` fallback.

```typescript
import * as Crypto from 'expo-crypto';

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  Crypto.getRandomValues(out);
  return out;
}
```

**Why:** Eliminates theoretical collision risk from `Math.random()`; `expo-crypto` is a standard Expo polyfill with zero bundle cost.

**Acceptance criteria:**
- [ ] `expo-crypto` imported (already in dependencies via Expo SDK)
- [ ] `Math.random` fallback removed
- [ ] `makeClientMessageId()` still passes existing test (RFC 4122 v4 shape, 500 unique)
- [ ] `npx tsc --noEmit` passes

---

### 2. [Minor] Add retry-with-backoff to config loader — File: `lib/config.ts:87-111`

**Current code:**
```typescript
export async function loadConfig(): Promise<void> {
  if (values) return;
  if (inflight) return inflight;

  emit(LOADING);
  inflight = (async () => {
    try {
      const { data, error } = await supabase.from("config").select("key, value");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error("config table returned no rows");
      }
      values = parseConfigRows(data as { key: string; value: unknown }[]);
      inflight = null;
      emit({ status: "loaded", error: null });
    } catch (err) {
      inflight = null;
      const message = err instanceof Error ? err.message : String(err);
      emit({ status: "error", error: message });
    }
  })();

  return inflight;
}
```

**Required change:** Add 3-attempt exponential backoff (1s, 2s, 4s) before emitting `error` status.

```typescript
export async function loadConfig(): Promise<void> {
  if (values) return;
  if (inflight) return inflight;

  const MAX_ATTEMPTS = 3;
  const BASE_DELAY_MS = 1000;

  emit(LOADING);
  inflight = (async () => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { data, error } = await supabase.from("config").select("key, value");
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) {
          throw new Error("config table returned no rows");
        }
        values = parseConfigRows(data as { key: string; value: unknown }[]);
        inflight = null;
        emit({ status: "loaded", error: null });
        return;
      } catch (err) {
        if (attempt === MAX_ATTEMPTS) {
          inflight = null;
          const message = err instanceof Error ? err.message : String(err);
          emit({ status: "error", error: message });
          return;
        }
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  })();

  return inflight;
}
```

**Why:** Transient Supabase outages (DNS, cold start, brief network) should auto-recover without user action. The manual Retry button remains as final fallback.

**Acceptance criteria:**
- [ ] 3 attempts with 1s/2s/4s delays on repeated failures
- [ ] Success on attempt 2 or 3 emits `loaded` status
- [ ] All 3 attempts fail → emits `error` status
- [ ] Existing `useConfig()` hook and composer gating unchanged
- [ ] `npx tsc --noEmit` passes

---

### 3. [Minor] Apply holdoff to 4xx (client) errors — File: `lib/chat.ts:272-278`

**Current code:**
```typescript
export function retryDelayFor(kind: ChatErrorKind, holdoffMs: number): number {
  return kind === "network" ? holdoffMs : 0;
}
```

**Required change:** Apply a short 3-second holdoff for `client` (4xx) errors to prevent spam retries on validation failures.

```typescript
const CLIENT_ERROR_HOLDOFF_MS = 3000;

export function retryDelayFor(kind: ChatErrorKind, holdoffMs: number): number {
  if (kind === "network") return holdoffMs;
  if (kind === "client") return CLIENT_ERROR_HOLDOFF_MS;
  return 0; // server (5xx) and auth (401) retry immediately
}
```

**Why:** 4xx errors (message too long, malformed UUID, etc.) won't succeed on immediate retry. A short holdoff prevents UI thrashing while keeping the Retry button available.

**Acceptance criteria:**
- [ ] `retryDelayFor("client", 150000)` returns `3000`
- [ ] `retryDelayFor("network", 150000)` returns `150000`
- [ ] `retryDelayFor("server", 150000)` returns `0`
- [ ] `retryDelayFor("auth", 150000)` returns `0`
- [ ] Existing tests pass (update test expectation for 4xx bucket)

---

### 4. [Minor] Move `CHAT_LAST_N` to config table — Files: `supabase/migrations/0018_config_chat_client.sql`, `app/(app)/chat.tsx:30-31,63-77`

**Current migration (add new row):**
```sql
insert into config (key, value, description) values
('chat_send_timeout_ms', '90000', 'Client timeout for the send-message invocation (ms); below the verified 150 s sync limit'),
('chat_realtime_watchdog_ms', '8000', 'Delay before the chat client re-selects an assistant row Realtime has not delivered (ms)'),
('chat_retry_holdoff_ms', '150000', 'Minimum delay before retrying a send whose outcome is unknown (ms); matches the 150 s sync limit so no second pipeline run starts while the first may still be alive');
```

**Required change:** Add `chat_last_n` row to migration and read it in chat.tsx.

Migration addition:
```sql
('chat_last_n', '50', 'Number of recent messages to load for the chat thread (newest first)');
```

Chat.tsx changes:
```typescript
// Remove line 30-31: const CHAT_LAST_N = 50;

// In limits interface (line 34-39):
interface ChatLimits {
  maxChars: number;
  sendTimeoutMs: number;
  watchdogMs: number;
  retryHoldoffMs: number;
  lastN: number;  // ADD
}

// In useMemo (line 63-77):
const limits = useMemo<ChatLimits | null>(() => {
  if (config.status !== 'loaded') return null;
  try {
    return {
      maxChars: requireConfigNumber('chat_max_message_chars'),
      sendTimeoutMs: requireConfigNumber('chat_send_timeout_ms'),
      watchdogMs: requireConfigNumber('chat_realtime_watchdog_ms'),
      retryHoldoffMs: requireConfigNumber('chat_retry_holdoff_ms'),
      lastN: requireConfigNumber('chat_last_n'),  // ADD
    };
  } catch (err) {
    console.error('[chat] config error:', err);
    return null;
  }
}, [config.status]);

// In fetchMessages (line 88):
.limit(limits?.lastN ?? 50);  // fallback for safety during transition
```

**Why:** Consistency with AGENTS.md §2 — all `[SPEC]` values in `config`, readable at runtime, no hardcoded defaults.

**Acceptance criteria:**
- [ ] Migration `0018` includes `chat_last_n` row
- [ ] `lib/config.ts` types unchanged (values is `Record<string, unknown>`)
- [ ] Chat loads `limits.lastN` messages (default 50)
- [ ] `npx tsc --noEmit` passes
- [ ] Document in TECH-SPECS §11 and GLOSSARY §16 (already done in staged changes)

---

### 5. [Minor] Apply AGENTS.md amendment from FP-BG §2.1 — File: `AGENTS.md`

**Current state:** AGENTS.md §8.4 does not contain the content-drafting rule.

**Required change:** Add the following to AGENTS.md §8.4 (after existing content):

```markdown
**Content drafting rule (BG-01 amendment):** Agents may draft owner-content (rules, exemplars, few-shot pairs, onboarding scripts) only in `content/`, with `status=draft` and a visible DRAFT label. Only owner-approved content (`status=approved`) may be seeded via content migrations. Placeholders remain labeled and are never presented as final content.
```

**Why:** The FP-BG catalog declares this amendment as "approved with this FP" but it hasn't been applied to the canonical AGENTS.md. Without it, background agents may seed draft content directly.

**Acceptance criteria:**
- [ ] Amendment appears in AGENTS.md §8.4
- [ ] No other AGENTS.md sections modified
- [ ] `docs/feature-prds/FP-BG/FP-BG.md` §2.1 reference remains accurate

---

### 6. [Nit] Remove `REVIEWER.md` and untrack `.expo/devices.json` — Files: repo root

**Required changes:**
```bash
rm REVIEWER.md
git rm --cached .expo/devices.json
```

**Why:** `REVIEWER.md` is the review template (not a project document). `.expo/devices.json` is local device state that should stay gitignored.

**Acceptance criteria:**
- [ ] `REVIEWER.md` deleted
- [ ] `.expo/devices.json` no longer tracked (stays in working tree, ignored)
- [ ] `git status` shows no untracked `REVIEWER.md` and no staged `.expo/devices.json`

---

### 7. [Nit] Add unit tests for `lib/config.ts` pure helpers — File: `lib/config.test.ts` (new)

**Required change:** Create `lib/config.test.ts` testing `parseConfigRows` and `coerceConfigNumber`.

```typescript
// lib/config.test.ts
import { parseConfigRows, coerceConfigNumber, resetConfigStore } from "./config";

describe("parseConfigRows", () => {
  it("builds lookup map from rows", () => {
    const rows = [
      { key: "a", value: 1 },
      { key: "b", value: "two" },
    ];
    expect(parseConfigRows(rows)).toEqual({ a: 1, b: "two" });
  });

  it("last key wins on duplicates", () => {
    const rows = [
      { key: "a", value: 1 },
      { key: "a", value: 2 },
    ];
    expect(parseConfigRows(rows)).toEqual({ a: 2 });
  });

  it("empty array returns empty object", () => {
    expect(parseConfigRows([])).toEqual({});
  });
});

describe("coerceConfigNumber", () => {
  it("passes through numbers", () => {
    expect(coerceConfigNumber("k", 42)).toBe(42);
    expect(coerceConfigNumber("k", 0)).toBe(0);
    expect(coerceConfigNumber("k", -5)).toBe(-5);
  });

  it("parses numeric strings", () => {
    expect(coerceConfigNumber("k", "90000")).toBe(90000);
    expect(coerceConfigNumber("k", "3.14")).toBe(3.14);
  });

  it("throws on null/undefined/empty", () => {
    expect(() => coerceConfigNumber("k", null)).toThrow('config key "k" is missing');
    expect(() => coerceConfigNumber("k", undefined)).toThrow('config key "k" is missing');
    expect(() => coerceConfigNumber("k", "")).toThrow('config key "k" is missing');
  });

  it("throws on non-numeric strings", () => {
    expect(() => coerceConfigNumber("k", "abc")).toThrow('config key "k" is not numeric');
    expect(() => coerceConfigNumber("k", NaN)).toThrow('config key "k" is not numeric');
  });
});
```

**Why:** Exported helpers marked "Exported for tests" should have tests. Pure functions are trivial to test and catch regressions.

**Acceptance criteria:**
- [ ] `lib/config.test.ts` created with above tests
- [ ] `npx jest --ci` passes (21+ tests total)
- [ ] No changes to `lib/config.ts` logic

---

## Tests to Run

```bash
# TypeScript compile check
npx tsc --noEmit

# Lint (ESLint flat config)
npx eslint . --ext .ts,.tsx

# Format check (Prettier)
npx prettier --check .

# Unit tests
npx jest --ci
```

## Constraints

- No public API changes (all changes internal/client-only)
- Minimal focused diffs — only the 7 items above
- Update tests/docs if required (items 4, 5, 7 include doc updates)
- Follow project style: React Native primitives, no HTML/DOM, `[SPEC]` in config, fail-closed
- No new dependencies beyond `expo-crypto` (already in Expo SDK)

## Definition of Done

- [ ] All 7 changes applied
- [ ] `npx tsc --noEmit` exits 0
- [ ] `npx eslint . --ext .ts,.tsx` exits 0 (no new warnings)
- [ ] `npx prettier --check .` exits 0
- [ ] `npx jest --ci` passes (21+ tests)
- [ ] Summary of changes + test results provided