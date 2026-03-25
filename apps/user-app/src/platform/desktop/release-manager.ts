import { httpClient } from "../../network/http-client";
import { createPlatformAdapter } from "../platform-adapter";
import { clientConfigStore } from "../../config/client-config-store";
import type {
  DesktopRuntimeInfo,
  DesktopUpdateInstallResult,
  ReleaseManifest
} from "../../config/client-config-types";

export interface DesktopReleaseState {
  checkedAt: string;
  currentVersion: string;
  hasUpdate: boolean;
  manifest: ReleaseManifest | null;
  runtimeInfo: DesktopRuntimeInfo | null;
}

function compareSemver(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;

    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

export function detectDesktopReleasePlatform(): string {
  const platform = navigator.userAgent.toLowerCase();

  if (platform.includes("windows")) {
    return "windows-x64";
  }

  if (platform.includes("mac os")) {
    return "macos-universal";
  }

  return "unknown";
}

export async function checkForDesktopUpdate(): Promise<DesktopReleaseState> {
  const adapter = createPlatformAdapter();
  const runtimeResult = await adapter.bridge.getRuntimeInfo();
  const runtimeInfo = runtimeResult.ok ? runtimeResult.value ?? null : null;
  const currentVersion = runtimeInfo?.version ?? "0.0.0";
  const config = clientConfigStore.getState();
  const platform = detectDesktopReleasePlatform();
  const manifest = await httpClient.request<ReleaseManifest>(
    `/api/client/release-manifest?channel=${encodeURIComponent(config.releaseChannel)}&platform=${encodeURIComponent(platform)}`
  );

  return {
    checkedAt: new Date().toISOString(),
    currentVersion,
    hasUpdate: compareSemver(manifest.version, currentVersion) > 0,
    manifest,
    runtimeInfo
  };
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
