import type { OpenCliHealthCheckResult, OpenCliHealthService } from "../opencli/opencli-health-service.js";

export type BrowserBridgeAvailability =
  | "ready"
  | "daemon_missing"
  | "extension_missing"
  | "unavailable";

export interface BrowserBridgeStatusDto {
  provider: "opencli";
  availability: BrowserBridgeAvailability;
  detail: string | null;
  checkedAt: string;
  installPath: string | null;
  version: string | null;
}

export class OpenCliBrowserBridgeService {
  constructor(private readonly openCliHealthService: OpenCliHealthService) {}

  async getStatus(): Promise<BrowserBridgeStatusDto> {
    const health = await this.openCliHealthService.check();

    return {
      provider: "opencli",
      availability: mapBridgeAvailability(health),
      detail: health.errorDetail ?? null,
      checkedAt: health.checkedAt,
      installPath: health.installPath,
      version: health.version
    };
  }
}

function mapBridgeAvailability(result: OpenCliHealthCheckResult): BrowserBridgeAvailability {
  if (result.installState !== "installed") {
    return "unavailable";
  }

  switch (result.healthState) {
    case "ready":
      return "ready";
    case "bridge_missing":
      return "extension_missing";
    case "binary_ready":
      return "daemon_missing";
    default:
      return "unavailable";
  }
}
