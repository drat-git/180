import { db } from "./db";
import { supabase } from "./supabase";
import type { Json, Tables } from "./database.types";
import {
  accountProfileKey,
  registerAccountProfile,
  type AccountProfile,
} from "./accountProfile";
import type { Configuration } from "./customizationTypes";
import type { OnboardingSelection } from "./starters";
import { pullTasks } from "./taskSync";
import { pullAnti } from "./antiSync";
import { pullCustomization } from "./customizationSync";

export const onboardingDraftKey = (userId: string) =>
  `onboarding-draft:${userId}`;
export function profileFromWire(
  row: Tables<"account_profiles">,
): AccountProfile {
  return {
    userId: row.user_id,
    createdAt: row.created_at,
    signupTimezone: row.signup_timezone,
    startDate: row.start_date,
    legacy: row.legacy,
    onboardingCompletedAt: row.onboarding_completed_at,
    starterId: row.starter_id,
    starterVersion: row.starter_version,
    initialConfiguration: row.initial_configuration as unknown as Configuration,
  };
}
function validProfile(value: unknown, userId: string): value is AccountProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as AccountProfile;
  return (
    profile.userId === userId &&
    typeof profile.legacy === "boolean" &&
    /^\d{4}-\d{2}-\d{2}$/.test(profile.startDate) &&
    !!profile.initialConfiguration &&
    ["blocks", "items", "lists"].every((key) =>
      Array.isArray(profile.initialConfiguration[key as keyof Configuration]),
    )
  );
}
export async function cachedAccountProfile(
  userId: string,
): Promise<AccountProfile | undefined> {
  const row = await db.meta.get(accountProfileKey(userId));
  try {
    const value: unknown = row ? JSON.parse(row.value) : null;
    if (validProfile(value, userId)) {
      registerAccountProfile(value);
      return value;
    }
  } catch {
    /* A malformed cache cannot select a different account. */
  }
}
export async function cacheAccountProfile(profile: AccountProfile) {
  registerAccountProfile(profile);
  await db.meta.put({
    key: accountProfileKey(profile.userId),
    value: JSON.stringify(profile),
  });
}
export async function fetchAccountProfile(
  userId: string,
): Promise<AccountProfile> {
  const { data, error } = await supabase
    .from("account_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  const profile = profileFromWire(data);
  if (!validProfile(profile, userId))
    throw new Error("Could not read your account setup.");
  await cacheAccountProfile(profile);
  return profile;
}
export async function completeOnboarding(
  userId: string,
  selection: OnboardingSelection,
): Promise<AccountProfile> {
  const { data: session } = await supabase.auth.getSession();
  if (session.session?.user.id !== userId)
    throw new Error("Sign in again to finish creating your space.");
  const { operationId, starterId, version, ...entries } = selection;
  const { data, error } = await supabase.rpc("complete_onboarding", {
    p_operation: operationId,
    p_starter: starterId,
    p_version: version,
    p_selection: entries as unknown as Json,
  });
  if (error) throw error;
  const profile = profileFromWire(
    data as unknown as Tables<"account_profiles">,
  );
  if (!validProfile(profile, userId) || !profile.onboardingCompletedAt)
    throw new Error("Your setup could not be confirmed. Please try again.");
  // Register the frozen baseline before reconciliation resolves any definitions.
  registerAccountProfile(profile);
  await Promise.all([
    pullTasks(userId),
    pullAnti(userId),
    pullCustomization(userId),
  ]);
  await db.transaction("rw", db.meta, async () => {
    await db.meta.put({
      key: accountProfileKey(userId),
      value: JSON.stringify(profile),
    });
    await db.meta.delete(onboardingDraftKey(userId));
  });
  return profile;
}
