import { useUserPreferenceSelector, userPreferenceStore } from "./user-preference-store";
import type { AccountPreferencesPatch, AccountPreferencesProfile } from "./types";

interface PreferencesState {
  readonly profile: AccountPreferencesProfile;
  readonly isFetching: boolean;
  readonly error: Error | null;
}

export function initializePreferences() {
  return userPreferenceStore.initialize();
}

export function updatePreferences(patch: AccountPreferencesPatch) {
  return userPreferenceStore.updateProfile(patch);
}

export function usePreferencesSelector<T>(selector: (state: PreferencesState) => T): T {
  return useUserPreferenceSelector((state) =>
    selector({
      profile: {
        ...state.profile,
        providers: state.providers,
        affairsDashboardStatesByWorkspace: state.affairsDashboardStatesByWorkspace ?? {},
        updatedAt: state.updatedAt
      },
      isFetching: false,
      error: null
    })
  );
}
