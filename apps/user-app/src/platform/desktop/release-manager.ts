import { createPlatformAdapter } from "../platform-adapter";
import { clientConfigStore } from "../../config/client-config-store";
import type {
  DesktopReleaseState,
  DesktopUpdateInstallResult,
  ReleaseManifest
} from "../../config/client-config-types";

export async function checkForDesktopUpdate(): Promise<DesktopReleaseState> {
  const adapter = createPlatformAdapter();
  const config = clientConfigStore.getState();
  const result = await adapter.bridge.checkForUpdate(config.releaseChannel);

  if (!result.ok || !result.value) {
    throw new Error(result.detail ?? "更新检查失败。");
  }

  return result.value;
}

export async function installDesktopUpdate(
  manifest: ReleaseManifest
): Promise<DesktopUpdateInstallResult> {
  const adapter = createPlatformAdapter();
  return adapter.bridge.installUpdate(manifest);
}

export async function rollbackDesktopUpdate() {
  const adapter = createPlatformAdapter();
  return adapter.bridge.rollbackToPreviousVersion();
}
