import { clientConfigStore } from "../config/client-config-store";
import { localHostDiscoveryStore } from "../config/local-host-discovery-store";
import type { RuntimePlatform } from "../config/client-config-types";
import { createPlatformAdapter } from "../platform/platform-adapter";
import { initializePreferences } from "../preferences/preferences-store";

export interface BootstrapAppResult {
  platform: RuntimePlatform;
}

export async function bootstrapApplication(): Promise<BootstrapAppResult> {
  const adapter = createPlatformAdapter();
  await clientConfigStore.initialize();
  localHostDiscoveryStore.initialize();
  // 偏好配置允许晚到；不能为了等一条远程请求把整个首屏挂死。
  void initializePreferences().catch(() => undefined);

  return {
    platform: adapter.platform
  };
}
