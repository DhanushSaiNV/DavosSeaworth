// lib/ids.ts
// Client-generated message id (FR-16).
//
// Randomness comes from `expo-crypto` — a native CSPRNG on iOS/Android, the Web Crypto
// API on web — rather than `Math.random`, so ids are collision-resistant with no
// weak-entropy caveat.
//
// The server validates `client_message_id` against a uuid regex, so the shape must be
// RFC 4122 v4. Uniqueness is what matters here: the value is a per-user idempotency
// key, never a secret.
//
// Refs: FP-02 FR-16; TECH-SPECS §3.2, §7.10; D23.

import * as Crypto from "expo-crypto";

const HEX = "0123456789abcdef";

/** RFC 4122 v4 uuid, e.g. `f0b6f3a2-...`. */
export function makeClientMessageId(): string {
  const bytes = Crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  let hex = "";
  for (let i = 0; i < 16; i += 1) {
    hex += HEX[bytes[i] >> 4] + HEX[bytes[i] & 0x0f];
  }
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
