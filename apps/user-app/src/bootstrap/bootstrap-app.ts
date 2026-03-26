import { clientConfigStore } from "../config/client-config-store";
import type { RuntimePlatform } from "../config/client-config-types";
import { createPlatformAdapter } from "../platform/platform-adapter";

export interface BootstrapAppResult {
  platform: RuntimePlatform;
}

export async function bootstrapApplication(): Promise<BootstrapAppResult> {
  const adapter = createPlatformAdapter();
  await clientConfigStore.initialize();

  return {
    platform: adapter.platform
  };
}
