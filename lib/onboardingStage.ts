// lib/onboardingStage.ts
// The authenticated profile-stage read used by the app-shell gate and the interview
// indicator. Kept separate from `lib/onboarding.ts` so the pure module has no Supabase
// import and remains jest-loadable without a client shim.

import { supabase } from "./supabase";
import { isOnboardingStage, type OnboardingStage } from "./onboarding";

/**
 * Read the caller's own `profiles.onboarding_stage`. Throws on a transport/RLS failure or
 * an unknown value; callers decide whether to retry (gate) or keep the prior stage
 * (interview). RLS makes `.eq("id", userId)` the caller's row.
 */
export async function readOnboardingStage(userId: string): Promise<OnboardingStage> {
  const { data, error } = await supabase
    .from("profiles")
    .select("onboarding_stage")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  const value = (data as { onboarding_stage?: unknown } | null)?.onboarding_stage;
  if (!isOnboardingStage(value)) {
    throw new Error("profiles.onboarding_stage is missing or invalid");
  }
  return value;
}
