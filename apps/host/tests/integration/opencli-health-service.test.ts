import { describe, expect, it } from "vitest";

import {
  OpenCliHealthService,
  parseOpenCliDoctorHealthState
} from "../../src/modules/opencli/opencli-health-service.js";

describe("OpenCLI 健康检查", () => {
  it("doctor 输出包含 Extension 和 Connectivity OK 时会判定为 ready", async () => {
    const service = new OpenCliHealthService(
      {
        discover: () => ({
          installState: "installed",
          binaryPath: "/tmp/opencli",
          installPath: "/tmp/opencli-root",
          version: "1.7.7",
          manifestSource: null
        })
      },
      {
        now: () => "2026-05-18T00:45:00.000Z",
        commandRunner: async () => [
          "opencli v1.7.7 doctor (node v25.6.0)",
          "",
          "[OK] Daemon: running on port 19825 (v1.7.7)",
          "[OK] Extension: connected (v1.0.2) -> v1.0.15 available",
          "[OK] Connectivity: connected in 0.4s"
        ].join("\n")
      }
    );

    const result = await service.check();

    expect(result.healthState).toBe("ready");
    expect(result.errorCode).toBeNull();
    expect(result.errorDetail).toBeNull();
  });

  it("缺少扩展或扩展未连接时会判定为 bridge_missing", () => {
    expect(parseOpenCliDoctorHealthState("[MISSING] Extension: not installed")).toBe("bridge_missing");
    expect(parseOpenCliDoctorHealthState("Browser Bridge extension not connected")).toBe("bridge_missing");
    expect(parseOpenCliDoctorHealthState("[FAIL] Connectivity: timeout")).toBe("bridge_missing");
  });

  it("其他输出会退化为 binary_ready", () => {
    expect(parseOpenCliDoctorHealthState("[OK] Daemon: running on port 19825")).toBe("binary_ready");
  });
});
