import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";
import { SessionChangedFileService } from "../../src/modules/sessions/session-changed-file-service.js";
import { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import { SessionMessageAttachmentService } from "../../src/modules/sessions/session-message-attachment-service.js";
import { SessionBindingRepository } from "../../src/storage/repositories/session-binding-repository.js";
import { SessionChangedFileRepository } from "../../src/storage/repositories/session-changed-file-repository.js";
import { SessionIndexRepository } from "../../src/storage/repositories/session-index-repository.js";
import { SessionMessageAttachmentRepository } from "../../src/storage/repositories/session-message-attachment-repository.js";
import { SessionStateRepository } from "../../src/storage/repositories/session-state-repository.js";
import { SessionStatusSnapshotRepository } from "../../src/storage/repositories/session-status-snapshot-repository.js";
import { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

describe("provider cli availability", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();

      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("CLI 缺失时会把 Codex 能力降级为不可启动", async () => {
    const service = createSessionHistoryService({
      codexCliPath: join(createTempRoot(), "missing-codex"),
      codexHomeDir: join(createTempRoot(), "codex-home")
    });
    const capabilities = await service.instance.getProviderCapabilities("codex");

    expect(capabilities.canStartSession).toBe(false);
    expect(capabilities.canResumeSession).toBe(false);
    expect(capabilities.canSendMessage).toBe(false);
    expect(capabilities.limitations[0]).toContain("Codex CLI");

    service.dispose();
  });

  it("PATH 里没有 claude 时会禁用 Claude Code 能力", async () => {
    vi.stubEnv("PATH", "");

    const service = createSessionHistoryService();
    const capabilities = await service.instance.getProviderCapabilities("claude-code");

    expect(capabilities.canStartSession).toBe(false);
    expect(capabilities.canResumeSession).toBe(false);
    expect(capabilities.canSendMessage).toBe(false);
    expect(capabilities.limitations[0]).toContain("Claude CLI");

    service.dispose();
  });

  it("CLI 可用性只在 Host 启动时探测一次，运行中新增 CLI 也不会刷新", async () => {
    const cliDir = createTempRoot();
    const claudeBinaryPath = join(cliDir, process.platform === "win32" ? "claude.cmd" : "claude");

    vi.stubEnv("PATH", "");

    const service = createSessionHistoryService();
    const initialCapabilities = await service.instance.getProviderCapabilities("claude-code");

    expect(initialCapabilities.canStartSession).toBe(false);

    writeFileSync(
      claudeBinaryPath,
      process.platform === "win32" ? "@echo off\r\necho claude\r\n" : "#!/bin/sh\necho claude\n",
      "utf8"
    );

    if (process.platform !== "win32") {
      chmodSync(claudeBinaryPath, 0o755);
    }

    vi.stubEnv("PATH", cliDir);

    const cachedCapabilities = await service.instance.getProviderCapabilities("claude-code");
    expect(cachedCapabilities.canStartSession).toBe(false);
    expect(cachedCapabilities.limitations[0]).toContain("Claude CLI");

    service.dispose();
  });

  function createSessionHistoryService(overrides: Partial<ReturnType<typeof resolveHostConfig>> = {}) {
    const rootDir = createTempRoot();
    const claudeCodeHomeDir = join(rootDir, "claude-home");
    const codexHomeDir = join(rootDir, "codex-home");
    const geminiHomeDir = join(rootDir, "gemini-home");
    const kimiHomeDir = join(rootDir, "kimi-home");
    const opencodeDataDir = join(rootDir, "opencode-data");

    [claudeCodeHomeDir, codexHomeDir, geminiHomeDir, kimiHomeDir, opencodeDataDir].forEach((dir) =>
      mkdirSync(dir, { recursive: true })
    );

    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir,
      codexHomeDir,
      geminiHomeDir,
      kimiHomeDir,
      opencodeDataDir,
      opencodeDbPath: join(opencodeDataDir, "opencode.db"),
      ...overrides
    });
    const database = createDatabaseClient(":memory:");
    const instance = new SessionHistoryService(
      database.db,
      new WorkspaceRepository(database.db),
      new SessionBindingRepository(database.db),
      new SessionChangedFileService(new SessionChangedFileRepository(database.db)),
      new SessionIndexRepository(database.db),
      new SessionMessageAttachmentService(
        new SessionMessageAttachmentRepository(database.db),
        config
      ),
      new SessionStateRepository(database.db),
      new SessionStatusSnapshotRepository(database.db),
      config
    );

    return {
      instance,
      dispose() {
        database.close();
      }
    };
  }

  function createTempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), "codingns-provider-cli-"));
    tempDirs.push(dir);
    return dir;
  }
});
