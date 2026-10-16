import { START_DATE } from "./model";
import type { Configuration } from "./customizationTypes";

export interface AccountProfile {
  userId: string;
  createdAt: string;
  signupTimezone: string;
  startDate: string;
  legacy: boolean;
  onboardingCompletedAt: string | null;
  starterId: string | null;
  starterVersion: number | null;
  initialConfiguration: Configuration;
}
export const emptyConfiguration = (): Configuration => ({
  blocks: [],
  items: [],
  lists: [],
});
// Per-identity context is restored before that account's app or sync engine opens.
const profiles = new Map<string, AccountProfile>();
export const accountProfileKey = (userId: string) =>
  `account-profile:${userId}`;
export const getAccountProfile = (userId: string) => profiles.get(userId);
export function registerAccountProfile(profile: AccountProfile) {
  profiles.set(profile.userId, structuredClone(profile));
}
export function clearAccountProfiles() {
  profiles.clear();
}
export function legacyAccountProfile(userId: string): AccountProfile {
  return {
    userId,
    createdAt: `${START_DATE}T00:00:00Z`,
    signupTimezone: "America/New_York",
    startDate: START_DATE,
    legacy: true,
    onboardingCompletedAt: `${START_DATE}T00:00:00Z`,
    starterId: null,
    starterVersion: null,
    initialConfiguration: emptyConfiguration(),
  };
}
export function signupTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
