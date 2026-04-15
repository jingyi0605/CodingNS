import type {
  AndroidApkManifest,
  AndroidReleaseState,
  AndroidUpdateInstallResult
} from "../../config/client-config-types";
import { clientConfigStore } from "../../config/client-config-store";
import { httpClient } from "../../network/http-client";
import { createPlatformAdapter } from "../platform-adapter";

export async function checkForAndroidUpdate(): Promise<AndroidReleaseState> {
  const adapter = createPlatformAdapter();
  const config = clientConfigStore.getState();
  const runtimeResult = await adapter.bridge.getAndroidRuntimeInfo();

  if (!runtimeResult.ok || !runtimeResult.value) {
    throw new Error(runtimeResult.detail ?? "读取 Android 运行时信息失败。");
  }

  const manifest = await httpClient.request<AndroidApkManifest>(
    `/api/client/release-manifest?channel=${encodeURIComponent(config.releaseChannel)}&platform=android-apk`
  );
  const hasUpdate = manifest.versionCode > runtimeResult.value.versionCode;

  return {
    checkedAt: new Date().toISOString(),
    currentVersion: runtimeResult.value.version,
    currentVersionCode: runtimeResult.value.versionCode,
    hasUpdate,
    manifest,
    runtimeInfo: runtimeResult.value
  };
}

export async function installAndroidUpdate(
  manifest: AndroidApkManifest
): Promise<AndroidUpdateInstallResult> {
  const adapter = createPlatformAdapter();
  return adapter.bridge.installAndroidUpdate(manifest);
}
