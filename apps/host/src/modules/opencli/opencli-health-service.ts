import { spawn } from "node:child_process";

import { nowIso } from "../../shared/utils/time.js";
import type { OpenCliHealthState, OpenCliInstallState } from "../../types/domain.js";
import {
  OpenCliInstallDiscovery,
  type OpenCliInstallDiscoveryResult
} from "./opencli-install-discovery.js";

export interface OpenCliHealthCheckResult {
  installState: OpenCliInstallState;
  healthState: OpenCliHealthState;
  version: string | null;
  installPath: string | null;
  checkedAt: string;
  errorCode: string | null;
  errorDetail: string | null;
}

export interface OpenCliHealthServiceOptions {
  now?: () => string;
  commandRunner?: OpenCliDoctorRunner;
}

export interface OpenCliInstallDiscoveryPort {
  discover(): OpenCliInstallDiscoveryResult;
}

type OpenCliDoctorRunner = (binaryPath: string, args: readonly string[]) => Promise<string>;

export class OpenCliHealthService {
  private readonly now: () => string;
  private readonly commandRunner: OpenCliDoctorRunner;

  constructor(
    private readonly installDiscovery: OpenCliInstallDiscoveryPort = new OpenCliInstallDiscovery(),
    options: OpenCliHealthServiceOptions = {}
  ) {
    this.now = options.now ?? nowIso;
    this.commandRunner = options.commandRunner ?? runOpenCliDoctorCommand;
  }

  async check(): Promise<OpenCliHealthCheckResult> {
    const discovery = this.installDiscovery.discover();
    const checkedAt = this.now();

    if (discovery.installState !== "installed" || !discovery.binaryPath) {
      return {
        installState: discovery.installState,
        healthState: "unknown",
        version: discovery.version,
        installPath: discovery.installPath,
        checkedAt,
        errorCode: null,
        errorDetail: null
      };
    }

    try {
      const output = await this.commandRunner(discovery.binaryPath, ["doctor"]);

      return {
        installState: discovery.installState,
        healthState: parseOpenCliDoctorHealthState(output),
        version: discovery.version,
        installPath: discovery.installPath,
        checkedAt,
        errorCode: null,
        errorDetail: null
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);

      return {
        installState: discovery.installState,
        healthState: parseOpenCliDoctorHealthState(detail),
        version: discovery.version,
        installPath: discovery.installPath,
        checkedAt,
        errorCode: "OPENCLI_DOCTOR_FAILED",
        errorDetail: detail
      };
    }
  }
}

export function parseOpenCliDoctorHealthState(output: string): OpenCliHealthState {
  if (/\[OK\]\s+Connectivity:/i.test(output) || /\[OK\]\s+Extension:/i.test(output)) {
    return "ready";
  }

  if (
    /\[MISSING\]\s+Extension:/i.test(output)
    || /Browser Bridge extension not connected/i.test(output)
    || /\[FAIL\]\s+Connectivity:/i.test(output)
  ) {
    return "bridge_missing";
  }

  return "binary_ready";
}

async function runOpenCliDoctorCommand(binaryPath: string, args: readonly string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(binaryPath, [...args], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, 20_000);

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      callback();
    };

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("close", (code, signal) => {
      const combinedOutput = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");

      if (code === 0) {
        finish(() => resolve(combinedOutput));
        return;
      }

      finish(() => {
        reject(new Error(
          combinedOutput || (signal ? `signal=${signal}` : `exitCode=${code ?? "null"}`)
        ));
      });
    });
  });
}
