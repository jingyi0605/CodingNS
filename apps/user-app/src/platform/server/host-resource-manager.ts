import { httpClient } from "../../network/http-client";

export interface HostResourceSnapshotView {
  observedAt: string;
  cpu: {
    usedRatio: number;
    logicalCoreCount: number;
  };
  memory: {
    usedBytes: number;
    totalBytes: number;
    freeBytes: number;
  };
  disk: {
    usedBytes: number;
    totalBytes: number;
    freeBytes: number;
  };
}

export async function fetchHostResourceSnapshot(targetHostId?: string | null): Promise<HostResourceSnapshotView> {
  const normalizedTargetHostId = targetHostId?.trim();

  if (normalizedTargetHostId) {
    return await httpClient.request<HostResourceSnapshotView>("/api/system/host/resources", {
      targetHostId: normalizedTargetHostId
    });
  }

  return await httpClient.request<HostResourceSnapshotView>("/api/system/host/resources");
}
