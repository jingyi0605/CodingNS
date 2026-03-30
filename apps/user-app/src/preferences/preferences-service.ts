import { httpClient } from "../network/http-client";
import type { AccountPreferencesPatch, AccountPreferencesProfile } from "./types";

const PROFILE_PATH = "/api/preferences/profile";

export async function fetchPreferencesProfile(): Promise<AccountPreferencesProfile> {
  return httpClient.request<AccountPreferencesProfile>(PROFILE_PATH);
}

export async function updatePreferencesProfile(
  patch: AccountPreferencesPatch
): Promise<AccountPreferencesProfile> {
  return httpClient.request<AccountPreferencesProfile>(PROFILE_PATH, {
    method: "PUT",
    body: JSON.stringify(patch)
  });
}
