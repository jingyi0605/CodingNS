import type {
  DesktopReleaseState,
  ManagedServicePackageInfo
} from "../../config/client-config-types";
import type { RefreshDesktopUpdateStateOptions } from "../desktop/release-manager";
import { refreshDesktopUpdateState } from "../desktop/release-manager";
import { checkForServiceUpdate } from "../server/service-update-manager";

export interface CombinedUpdateCheckResult {
  readonly servicePackage: ManagedServicePackageInfo | null;
  readonly serviceError: string | null;
  readonly clientState: DesktopReleaseState | null;
  readonly clientError: string | null;
}

export async function checkCombinedUpdates(
  options: RefreshDesktopUpdateStateOptions = {}
): Promise<CombinedUpdateCheckResult> {
  const [serviceResult, clientResult] = await Promise.allSettled([
    checkForServiceUpdate(),
    refreshDesktopUpdateState(options)
  ]);

  return {
    servicePackage:
      serviceResult.status === "fulfilled"
        ? serviceResult.value.packages[0] ?? null
        : null,
    serviceError:
      serviceResult.status === "rejected"
        ? toErrorMessage(serviceResult.reason)
        : null,
    clientState:
      clientResult.status === "fulfilled"
        ? clientResult.value
        : null,
    clientError:
      clientResult.status === "rejected"
        ? toErrorMessage(clientResult.reason)
        : null
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "检查更新失败";
}
