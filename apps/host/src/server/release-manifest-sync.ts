import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { HostConfig } from "../config/env.js";

const DEFAULT_ANDROID_RELEASE_MANIFEST_URL =
  "https://github.com/jingyi0605/CodingNS/releases/latest/download/android-apk.json";
const RELEASE_SYNC_TIMEOUT_MS = 15_000;

interface AndroidReleaseManifest {
  channel: "stable" | "beta";
  version: string;
  versionCode: number;
  packageName: string;
  fileName: string;
  downloadUrl: string;
  sha256: string;
  publishedAt: string;
  notes: string;
  minSupportedVersionCode: number | null;
  htmlUrl: string | null;
}

export async function syncReleaseManifests(
  config: Pick<HostConfig, "releaseManifestRoot">
): Promise<void> {
  if (process.env.CODINGNS_SYNC_RELEASE_MANIFESTS === "0") {
    return;
  }

  const manifestUrl =
    normalizeOptionalText(process.env.CODINGNS_ANDROID_RELEASE_MANIFEST_URL)
    ?? DEFAULT_ANDROID_RELEASE_MANIFEST_URL;

  try {
    await syncAndroidReleaseManifest({
      releaseManifestRoot: config.releaseManifestRoot,
      manifestUrl
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[host] 同步 Android 发布清单失败：${detail}`);
  }
}

export async function syncAndroidReleaseManifest(input: {
  releaseManifestRoot: string;
  manifestUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(input.manifestUrl, {
    headers: {
      accept: "application/json"
    },
    signal: AbortSignal.timeout(input.timeoutMs ?? RELEASE_SYNC_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`请求 ${input.manifestUrl} 失败，HTTP 状态码 ${response.status}`);
  }

  const raw = await response.text();
  const manifest = parseAndroidReleaseManifest(raw);
  const channelDir = path.join(input.releaseManifestRoot, manifest.channel);
  const targetPath = path.join(channelDir, "android-apk.json");
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

  await mkdir(channelDir, { recursive: true });

  const current = await readFile(targetPath, "utf8").catch(() => null);

  if (current === serialized) {
    return targetPath;
  }

  await writeFile(targetPath, serialized, "utf8");
  return targetPath;
}

function parseAndroidReleaseManifest(raw: string): AndroidReleaseManifest {
  let parsed;

  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("Android 发布清单不是合法 JSON");
  }

  if (
    !isReleaseChannel(parsed.channel) ||
    !isNonEmptyString(parsed.version) ||
    !isPositiveInteger(parsed.versionCode) ||
    !isNonEmptyString(parsed.packageName) ||
    !isNonEmptyString(parsed.fileName) ||
    !isNonEmptyString(parsed.downloadUrl) ||
    !isNonEmptyString(parsed.sha256) ||
    !isNonEmptyString(parsed.publishedAt)
  ) {
    throw new Error("Android 发布清单字段不完整");
  }

  return {
    channel: parsed.channel,
    version: parsed.version,
    versionCode: parsed.versionCode,
    packageName: parsed.packageName,
    fileName: parsed.fileName,
    downloadUrl: parsed.downloadUrl,
    sha256: parsed.sha256,
    publishedAt: parsed.publishedAt,
    notes: isNonEmptyString(parsed.notes) ? parsed.notes : "",
    minSupportedVersionCode: isPositiveInteger(parsed.minSupportedVersionCode)
      ? parsed.minSupportedVersionCode
      : null,
    htmlUrl: isNonEmptyString(parsed.htmlUrl) ? parsed.htmlUrl : null
  };
}

function isReleaseChannel(value: unknown): value is "stable" | "beta" {
  return value === "stable" || value === "beta";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function normalizeOptionalText(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
