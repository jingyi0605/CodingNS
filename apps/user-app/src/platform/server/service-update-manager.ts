import type {
  ServiceUpdateSnapshot,
  ServiceUpdateTaskInfo
} from "../../config/client-config-types";
import { clientConfigStore } from "../../config/client-config-store";
import { httpClient } from "../../network/http-client";

export async function fetchCurrentHostVersion(): Promise<string> {
  const result = await httpClient.request<{ version: string }>("/api/client/host-version");
  return result.version;
}

export async function checkForServiceUpdate(): Promise<ServiceUpdateSnapshot> {
  const config = clientConfigStore.getState();
  return httpClient.request<ServiceUpdateSnapshot>(
    `/api/client/service-update?channel=${encodeURIComponent(config.releaseChannel)}`
  );
}

export async function installServiceUpdate(packageName: string): Promise<ServiceUpdateTaskInfo> {
  const config = clientConfigStore.getState();
  return httpClient.request<ServiceUpdateTaskInfo>("/api/client/service-update/install", {
    method: "POST",
    body: JSON.stringify({
      packageName,
      channel: config.releaseChannel
    })
  });
}

export async function getServiceUpdateTask(taskId: string): Promise<ServiceUpdateTaskInfo> {
  return httpClient.request<ServiceUpdateTaskInfo>(
    `/api/client/service-update/tasks/${encodeURIComponent(taskId)}`
  );
}
