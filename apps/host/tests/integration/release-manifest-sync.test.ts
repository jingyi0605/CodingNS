import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { syncAndroidReleaseManifest } from "../../src/server/release-manifest-sync.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();

  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("release-manifest-sync", () => {
  it("会把远端 Android 清单同步到本地 stable 目录", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-release-sync-"));
    tempDirs.push(tempDir);

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          channel: "stable",
          version: "0.7.2",
          versionCode: 7002,
          packageName: "com.codingns.userapp",
          fileName: "app-universal-release.apk",
          downloadUrl: "https://example.invalid/app-universal-release.apk",
          sha256: "sha256:test-digest",
          publishedAt: "2026-05-06T08:00:00.000Z",
          notes: "Android 发布说明",
          minSupportedVersionCode: null,
          htmlUrl: "https://example.invalid/release/v0.7.2"
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const outputPath = await syncAndroidReleaseManifest({
      releaseManifestRoot: tempDir,
      manifestUrl: "https://example.invalid/android-apk.json",
      fetchImpl: fetchMock as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outputPath).toBe(path.join(tempDir, "stable", "android-apk.json"));
    expect(JSON.parse(readFileSync(outputPath, "utf8"))).toMatchObject({
      channel: "stable",
      version: "0.7.2",
      versionCode: 7002,
      packageName: "com.codingns.userapp"
    });
  });

  it("远端清单不合法时不会覆盖本地已有文件", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-release-sync-"));
    tempDirs.push(tempDir);

    const stableDir = path.join(tempDir, "stable");
    const manifestPath = path.join(stableDir, "android-apk.json");
    mkdirSync(stableDir, { recursive: true });
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          channel: "stable",
          version: "0.7.1",
          versionCode: 7001,
          packageName: "com.codingns.userapp",
          fileName: "app-universal-release.apk",
          downloadUrl: "https://example.invalid/app-universal-release.apk",
          sha256: "sha256:old-digest",
          publishedAt: "2026-05-05T08:00:00.000Z",
          notes: "旧清单"
        },
        null,
        2
      ),
      "utf8"
    );

    const originalContent = readFileSync(manifestPath, "utf8");
    const fetchMock = vi.fn(async () =>
      new Response("{\"channel\":\"stable\"}", {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await expect(
      syncAndroidReleaseManifest({
        releaseManifestRoot: tempDir,
        manifestUrl: "https://example.invalid/android-apk.json",
        fetchImpl: fetchMock as typeof fetch
      })
    ).rejects.toThrow("Android 发布清单字段不完整");

    expect(readFileSync(manifestPath, "utf8")).toBe(originalContent);
  });
});
