import { spawn } from "node:child_process";
import os from "node:os";

import type { HostConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { ManagedServicePackageDto, ServiceUpdateTaskDto } from "./service-update-types.js";

interface NpmRegistryPackageDocument {
  readonly "dist-tags"?: Record<string, string | undefined>;
}

interface ManagedPackageCheckResult {
  readonly latestVersion: string | null;
  readonly hasUpdate: boolean;
  readonly checkStatus: ManagedServicePackageDto["checkStatus"];
  readonly checkError: string | null;
  readonly distTag: "latest" | "beta";
}

export interface NpmGlobalPackageInstallInput {
  packageName: string;
  distTag: "latest" | "beta";
  signal: AbortSignal;
}

export interface NpmGlobalPackageInstallResult {
  restartScheduled: boolean;
  restartDelayMs: number | null;
}

const PM2_RESTART_DELAY_MS = 3_000;

export class NpmGlobalPackageService {
  constructor(private readonly config: HostConfig) {}

  async listManagedPackages(
    channel: "stable" | "beta",
    currentVersion: string,
    resolveInstallTask: (packageName: string) => ServiceUpdateTaskDto | null
  ): Promise<ManagedServicePackageDto[]> {
    const packageName = this.config.serverUpdatePackageName;
    const installTask = resolveInstallTask(packageName);
    const checkResult = await this.checkManagedPackage(channel, packageName, currentVersion);

    return [
      {
        channel,
        packageName,
        registryUrl: buildRegistryPackageUrl(this.config.npmRegistryBaseUrl, packageName),
        packagePageUrl: `https://www.npmjs.com/package/${packageName}`,
        currentVersion,
        latestVersion: checkResult.latestVersion,
        latestTitle: null,
        latestNotes: null,
        latestPublishedAt: null,
        hasUpdate: checkResult.hasUpdate,
        checkStatus: checkResult.checkStatus,
        checkError: checkResult.checkError,
        restartRequired: Boolean(installTask?.restartRequired),
        installTask
      }
    ];
  }

  async resolveInstallTarget(
    channel: "stable" | "beta",
    currentVersion: string,
    packageName: string
  ): Promise<{
    packageName: string;
    channel: "stable" | "beta";
    targetVersion: string;
    distTag: "latest" | "beta";
  }> {
    this.assertManagedPackage(packageName);

    const checkResult = await this.checkManagedPackage(channel, packageName, currentVersion);

    if (checkResult.checkStatus === "check_failed") {
      throw new AppError({
        statusCode: 409,
        errorCode: "SERVICE_UPDATE_CHECK_FAILED",
        detail: checkResult.checkError ?? "当前无法确认服务端是否有新版本"
      });
    }

    if (!checkResult.latestVersion) {
      throw new AppError({
        statusCode: 409,
        errorCode: "SERVICE_UPDATE_VERSION_UNAVAILABLE",
        detail: "当前没有可用的服务端目标版本"
      });
    }

    if (!checkResult.hasUpdate) {
      throw new AppError({
        statusCode: 409,
        errorCode: "SERVICE_ALREADY_UP_TO_DATE",
        detail: "当前服务端已经是最新版本"
      });
    }

    return {
      packageName,
      channel,
      targetVersion: checkResult.latestVersion,
      distTag: checkResult.distTag
    };
  }

  async installGlobalPackage(
    input: NpmGlobalPackageInstallInput
  ): Promise<NpmGlobalPackageInstallResult> {
    this.assertManagedPackage(input.packageName);

    await runCommand({
      command: resolveNpmCommand(),
      args: ["install", "-g", `${input.packageName}@${input.distTag}`],
      cwd: os.homedir(),
      signal: input.signal,
      failureLabel: "npm install -g 执行失败"
    });
    await this.ensurePm2ProcessReady(input.signal);
    await this.schedulePm2Restart();

    return {
      restartScheduled: true,
      restartDelayMs: PM2_RESTART_DELAY_MS
    };
  }

  private assertManagedPackage(packageName: string): void {
    if (packageName === this.config.serverUpdatePackageName) {
      return;
    }

    throw new AppError({
      statusCode: 400,
      errorCode: "SERVICE_UPDATE_PACKAGE_UNSUPPORTED",
      detail: `当前不支持升级包 ${packageName}`
    });
  }

  private async ensurePm2ProcessReady(signal: AbortSignal): Promise<void> {
    try {
      await runCommand({
        command: resolvePm2Command(),
        args: ["describe", this.config.pm2ProcessName],
        cwd: os.homedir(),
        signal,
        failureLabel: `未找到 PM2 进程 ${this.config.pm2ProcessName}`
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";

      throw new Error(
        `npm 包已更新，但无法确认 PM2 进程 ${this.config.pm2ProcessName} 可被自动重启。请检查 pm2 是否可用，并手工执行 pm2 restart ${this.config.pm2ProcessName}。${detail ? ` ${detail}` : ""}`
      );
    }
  }

  private async schedulePm2Restart(): Promise<void> {
    try {
      await spawnDetachedNodeProcess({
        script: PM2_RESTART_HELPER_SOURCE,
        args: [
          String(PM2_RESTART_DELAY_MS),
          resolvePm2Command(),
          this.config.pm2ProcessName
        ]
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";

      throw new Error(
        `npm 包已更新，但自动调度 PM2 重启失败。请手工执行 pm2 restart ${this.config.pm2ProcessName}。${detail ? ` ${detail}` : ""}`
      );
    }
  }

  private async checkManagedPackage(
    channel: "stable" | "beta",
    packageName: string,
    currentVersion: string
  ): Promise<ManagedPackageCheckResult> {
    const registryUrl = buildRegistryPackageUrl(this.config.npmRegistryBaseUrl, packageName);

    try {
      const response = await fetch(registryUrl, {
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as NpmRegistryPackageDocument;
      const target = pickTargetVersion(payload, channel);
      const latestVersion = target.version;
      const hasUpdate =
        latestVersion !== null && compareSemver(latestVersion, currentVersion) > 0;

      return {
        latestVersion,
        hasUpdate,
        checkStatus: hasUpdate ? "ready" : "up_to_date",
        checkError: null,
        distTag: target.distTag
      };
    } catch (error) {
      return {
        latestVersion: null,
        hasUpdate: false,
        checkStatus: "check_failed",
        checkError: error instanceof Error ? error.message : "未知错误",
        distTag: channel === "beta" ? "beta" : "latest"
      };
    }
  }
}

function buildRegistryPackageUrl(baseUrl: string, packageName: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(encodeURIComponent(packageName), normalizedBaseUrl).toString();
}

function pickTargetVersion(
  payload: NpmRegistryPackageDocument,
  channel: "stable" | "beta"
): {
  version: string | null;
  distTag: "latest" | "beta";
} {
  const distTags = payload["dist-tags"] ?? {};
  const latestVersion = distTags.latest ?? null;

  if (channel !== "beta") {
    return {
      version: latestVersion,
      distTag: "latest"
    };
  }

  const betaVersion = distTags.beta ?? null;

  if (!betaVersion) {
    return {
      version: latestVersion,
      distTag: "latest"
    };
  }

  if (!latestVersion) {
    return {
      version: betaVersion,
      distTag: "beta"
    };
  }

  return compareSemver(latestVersion, betaVersion) >= 0
    ? {
        version: latestVersion,
        distTag: "latest"
      }
    : {
        version: betaVersion,
        distTag: "beta"
      };
}

function compareSemver(left: string, right: string): number {
  const leftMeta = parseSemver(left);
  const rightMeta = parseSemver(right);

  for (let index = 0; index < 3; index += 1) {
    const diff = (leftMeta.numbers[index] ?? 0) - (rightMeta.numbers[index] ?? 0);

    if (diff !== 0) {
      return diff;
    }
  }

  if (leftMeta.prerelease === rightMeta.prerelease) {
    return 0;
  }

  if (!leftMeta.prerelease) {
    return 1;
  }

  if (!rightMeta.prerelease) {
    return -1;
  }

  return leftMeta.prerelease.localeCompare(rightMeta.prerelease);
}

function parseSemver(input: string): {
  readonly numbers: [number, number, number];
  readonly prerelease: string;
} {
  const normalized = input.trim().replace(/^v/i, "");
  const [versionPart, prerelease = ""] = normalized.split("-", 2);
  const rawNumbers = versionPart.split(".");

  return {
    numbers: [
      Number.parseInt(rawNumbers[0] ?? "0", 10) || 0,
      Number.parseInt(rawNumbers[1] ?? "0", 10) || 0,
      Number.parseInt(rawNumbers[2] ?? "0", 10) || 0
    ],
    prerelease
  };
}

function createBoundedOutputCollector(limit = 8_192): {
  push(chunk: string): void;
  read(): string;
} {
  let content = "";

  return {
    push(chunk) {
      if (!chunk) {
        return;
      }

      const next = `${content}${chunk}`;
      content = next.length <= limit ? next : next.slice(next.length - limit);
    },
    read() {
      return content;
    }
  };
}

function resolveNpmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function resolvePm2Command(): string {
  return process.platform === "win32" ? "pm2.cmd" : "pm2";
}

async function runCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  signal?: AbortSignal;
  failureLabel: string;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      signal: input.signal
    });
    const output = createBoundedOutputCollector();
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      callback();
    };

    child.stdout.on("data", (chunk) => {
      output.push(String(chunk));
    });
    child.stderr.on("data", (chunk) => {
      output.push(String(chunk));
    });
    child.on("error", (error) => {
      finish(() => {
        reject(error);
      });
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        finish(resolve);
        return;
      }

      const detail = output.read().trim();
      const suffix = signal ? `signal=${signal}` : `exitCode=${code ?? "null"}`;

      finish(() => {
        reject(
          new Error(
            detail.length > 0
              ? `${input.failureLabel}: ${detail}\n${suffix}`
              : `${input.failureLabel}，${suffix}`
          )
        );
      });
    });
  });
}

async function spawnDetachedNodeProcess(input: {
  script: string;
  args: string[];
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", input.script, ...input.args], {
      cwd: os.homedir(),
      env: process.env,
      stdio: "ignore",
      windowsHide: true,
      detached: true
    });
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      callback();
    };

    child.once("spawn", () => {
      child.unref();
      finish(resolve);
    });
    child.once("error", (error) => {
      finish(() => {
        reject(error);
      });
    });
  });
}

const PM2_RESTART_HELPER_SOURCE = String.raw`
const { spawn } = require("node:child_process");

const delayMs = Number(process.argv[1] || "0");
const command = process.argv[2];
const processName = process.argv[3];

function exit(code) {
  process.exit(typeof code === "number" ? code : 0);
}

setTimeout(() => {
  const child = spawn(command, ["restart", processName], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "ignore",
    windowsHide: true
  });

  child.on("error", () => {
    exit(1);
  });
  child.on("close", (code) => {
    exit(code ?? 1);
  });
}, Math.max(0, delayMs));
`;
