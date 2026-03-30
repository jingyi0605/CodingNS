import { clientConfigStore } from "../config/client-config-store";
import type { RuntimePlatform } from "../config/client-config-types";
import { createPlatformAdapter } from "../platform/platform-adapter";
import { initializePreferences } from "../preferences/preferences-store";

export interface BootstrapAppResult {
  platform: RuntimePlatform;
}

export async function bootstrapApplication(): Promise<BootstrapAppResult> {
  const adapter = createPlatformAdapter();
  await clientConfigStore.initialize();
  await initializePreferences();

  return {
    platform: adapter.platform
  };
}
