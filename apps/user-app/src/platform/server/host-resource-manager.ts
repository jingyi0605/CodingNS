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

export async function fetchHostResourceSnapshot(): Promise<HostResourceSnapshotView> {
  return await httpClient.request<HostResourceSnapshotView>("/api/system/host/resources");
}
