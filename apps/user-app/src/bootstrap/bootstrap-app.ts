import { clientConfigStore } from "../config/client-config-store";
import { createPlatformAdapter } from "../platform/platform-adapter";

export interface BootstrapAppResult {
  platform: "desktop" | "web";
}

export async function bootstrapApplication(): Promise<BootstrapAppResult> {
  const adapter = createPlatformAdapter();
  await clientConfigStore.initialize();

  return {
    platform: adapter.platform
  };
}
