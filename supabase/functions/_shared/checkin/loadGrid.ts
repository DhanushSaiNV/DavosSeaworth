// supabase/functions/_shared/checkin/loadGrid.ts
// FP-04 Step 2 — read a user's check-in grid from `profiles` (TECH-SPEC §3.2, §7.1).
//
// Refs: FP-04 FR-5, FR-15, NFR-7; TECH-SPEC §7.1, §3.2.
//
// Split from `windows.ts` because this half touches the service client, which reads `Deno.env`
// and builds a client at module load — so it cannot load under jest. The pure arithmetic stays
// in `windows.ts` and is what the unit test exercises (the `bands.ts` / `persona.ts` precedent).
//
// Both consumers share this one loader: `submit-checkin` (Step 2) canonicalizes a hint with it,
// and the `watchdog_checkin` handler (Step 6) scans with it. NFR-7's "one twin" requirement is
// about the arithmetic, but a second *reader* would be just as able to drift.

import { supabaseService } from "../config.ts";
import { isValidTimeZone, type CadenceMinutes, type Grid } from "./windows.ts";

/**
 * The user's grid, or null when it cannot be read or would be unusable. Null is a
 * **fail-closed** signal: the caller answers 500 and logs, rather than guessing a grid and
 * ingesting a doing into the wrong window (AGENTS.md §2 — never paper over a misconfiguration).
 *
 * `timezone` defaults to `'UTC'` (§7.1: a null reads as UTC). `checkin_cadence_minutes` carries
 * a CHECK in the schema and the RPC validates it, so a value outside {60,120} means the row was
 * written around both paths (the recorded `profiles` open surface) and is treated as
 * misconfiguration, not coerced.
 */
export async function loadGrid(userId: string): Promise<Grid | null> {
  const { data, error } = await supabaseService
    .from("profiles")
    .select(
      "timezone, checkin_cadence_minutes, checkin_active_hours_start, checkin_active_hours_end",
    )
    .eq("id", userId)
    .single();

  if (error || !data) return null;

  const cadence = data.checkin_cadence_minutes;
  if (cadence !== 60 && cadence !== 120) return null;

  const timezone = (data.timezone as string | null) || "UTC";
  if (!isValidTimeZone(timezone)) return null;

  return {
    timezone,
    cadenceMinutes: cadence as CadenceMinutes,
    activeStart: String(data.checkin_active_hours_start),
    activeEnd: String(data.checkin_active_hours_end),
  };
}
