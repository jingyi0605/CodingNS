import type { ServiceUpdateInfo } from "../../config/client-config-types";
import { clientConfigStore } from "../../config/client-config-store";
import { httpClient } from "../../network/http-client";

export async function checkForServiceUpdate(): Promise<ServiceUpdateInfo> {
  const config = clientConfigStore.getState();
  return httpClient.request<ServiceUpdateInfo>(
    `/api/client/service-update?channel=${encodeURIComponent(config.releaseChannel)}`
  );
}
