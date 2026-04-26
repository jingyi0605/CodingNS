import path from "node:path";

export function resolveOpenCliRuntimeStoreRoot(hostDataRootPath: string): string {
  return path.join(hostDataRootPath, "opencli-runtimes");
}

export function resolveOpenCliRuntimeRoot(hostDataRootPath: string, profileId: string): string {
  return path.join(resolveOpenCliRuntimeStoreRoot(hostDataRootPath), profileId);
}

export function createOpenCliRuntimeStagingRoot(runtimeRootPath: string): string {
  return `${runtimeRootPath}.tmp-${process.pid}-${Date.now()}`;
}
