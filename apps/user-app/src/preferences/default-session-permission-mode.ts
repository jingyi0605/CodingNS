import { userPreferenceStore } from "./user-preference-store";

export function getDefaultSessionPermissionMode(): string | null {
  const permissionMode = userPreferenceStore.getState().profile.defaultPermissionMode;
  return permissionMode === "default" ? null : permissionMode;
}
