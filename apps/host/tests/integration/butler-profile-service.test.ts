import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ButlerProfile } from "../../src/types/domain.js";
import type { ButlerProfileRepository } from "../../src/storage/repositories/butler-profile-repository.js";
import type { ButlerProjectRepository } from "../../src/storage/repositories/butler-project-repository.js";
import { ButlerProfileService } from "../../src/modules/butler/butler-profile-service.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("ButlerProfileService", () => {
  it("未初始化时会明确拒绝启动控制会话", () => {
    const service = new ButlerProfileService(
      {
        find: vi.fn(() => null)
      } as unknown as ButlerProfileRepository,
      {
        list: vi.fn(() => [])
      } as unknown as Pick<ButlerProjectRepository, "list">
    );

    try {
      service.ensureInitialized();
      throw new Error("should throw");
    } catch (error) {
      expect(error).toMatchObject({
        errorCode: "BUTLER_PROFILE_NOT_INITIALIZED"
      });
    }
  });

  it("初始化时会拒绝直接复用项目仓库目录作为助手工作目录", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-profile-"));
    tempDirs.push(repoRoot);

    const service = new ButlerProfileService(
      {
        find: vi.fn(() => null)
      } as unknown as ButlerProfileRepository,
      {
        list: vi.fn(() => [
          {
            repoRoot
          }
        ])
      } as unknown as Pick<ButlerProjectRepository, "list">
    );

    try {
      service.initProfile({
        providerId: "codex",
        workspacePath: repoRoot,
        agentsMode: "inline",
        agentsContent: "# AGENTS.md\n你是代码助手",
        persona: {
          tone: "direct",
          language: "zh-CN",
          summaryStyle: "brief"
        },
        focus: {
          projectIds: [],
          riskPreference: "conservative",
          reportPriority: ["risk", "blocker"]
        }
      });
      throw new Error("should throw");
    } catch (error) {
      expect(error).toMatchObject({
        errorCode: "INVALID_INPUT",
        field: "workspacePath"
      });
    }
  });

  it("初始化后可以保存正式档案", () => {
    const workspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-profile-"));
    tempDirs.push(workspacePath);
    let savedProfile: ButlerProfile | null = null;

    const repository = {
      find: vi.fn(() => savedProfile),
      create: vi.fn((record: ButlerProfile) => {
        savedProfile = record;
        return record;
      })
    } satisfies Pick<ButlerProfileRepository, "find" | "create">;

    const service = new ButlerProfileService(
      repository as unknown as ButlerProfileRepository,
      {
        list: vi.fn(() => [])
      } as unknown as Pick<ButlerProjectRepository, "list">
    );

    const profile = service.initProfile({
      providerId: "codex",
      workspacePath,
      agentsMode: "inline",
      agentsContent: "# AGENTS.md\n你是代码助手",
      persona: {
        tone: "direct",
        language: "zh-CN",
        summaryStyle: "brief"
      },
      focus: {
        projectIds: [],
        riskPreference: "conservative",
        reportPriority: ["risk", "blocker"]
      }
    });

    expect(profile.providerId).toBe("codex");
    expect(profile.workspacePath).toBe(workspacePath);
    expect(profile.agentsMode).toBe("inline");
    expect(profile.focus.summaryDebounceSeconds).toBe(300);
    expect(repository.create).toHaveBeenCalledOnce();
    expect(execFileSync("git", ["-C", workspacePath, "rev-parse", "--show-toplevel"], {
      encoding: "utf8"
    }).trim()).toBe(fs.realpathSync.native(workspacePath));
  });

  it("旧档案只标记为未完成时，可以重新完成初始化而不会再插入重复主键", () => {
    const workspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-profile-"));
    tempDirs.push(workspacePath);
    let savedProfile: ButlerProfile | null = {
      id: "default",
      displayName: "旧助手",
      providerId: "codex",
      workspacePath,
      agentsMode: "inline",
      agentsFilePath: null,
      agentsContent: "# AGENTS.md\n旧规则",
      persona: {
        tone: "direct",
        language: "zh-CN",
        summaryStyle: "brief"
      },
      focus: {
        projectIds: [],
        riskPreference: "conservative",
        reportPriority: ["risk"],
        summaryDebounceSeconds: 300
      },
      setupCompleted: false,
      initializedAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    };

    const repository = {
      find: vi.fn(() => savedProfile),
      create: vi.fn((record: ButlerProfile) => {
        savedProfile = record;
        return record;
      }),
      update: vi.fn((record: ButlerProfile) => {
        savedProfile = record;
        return record;
      })
    } satisfies Pick<ButlerProfileRepository, "find" | "create" | "update">;

    const service = new ButlerProfileService(
      repository as unknown as ButlerProfileRepository,
      {
        list: vi.fn(() => [])
      } as unknown as Pick<ButlerProjectRepository, "list">
    );

    const profile = service.initProfile({
      displayName: "新助手",
      providerId: "claude-code",
      workspacePath,
      agentsMode: "inline",
      persona: {
        tone: "steady",
        language: "zh-CN",
        summaryStyle: "brief"
      },
      focus: {
        projectIds: [],
        riskPreference: "balanced",
        reportPriority: ["risk", "blocker"]
      }
    });

    expect(profile.displayName).toBe("新助手");
    expect(profile.providerId).toBe("claude-code");
    expect(profile.setupCompleted).toBe(true);
    expect(repository.update).toHaveBeenCalledOnce();
    expect(repository.create).not.toHaveBeenCalled();
    expect(profile.initializedAt).not.toBe("2026-05-01T00:00:00.000Z");
  });

  it("初始化或切换到已禁用 provider 时会直接拒绝", () => {
    const workspacePath = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-profile-"));
    tempDirs.push(workspacePath);

    const service = new ButlerProfileService(
      {
        find: vi.fn(() => null),
        create: vi.fn()
      } as unknown as ButlerProfileRepository,
      {
        list: vi.fn(() => [])
      } as unknown as Pick<ButlerProjectRepository, "list">,
      workspacePath,
      {
        get: vi.fn(() => ({
          providerId: "codex",
          enabled: false,
          updatedAt: "2026-04-26T10:00:00.000Z"
        }))
      }
    );

    try {
      service.initProfile({
        providerId: "codex",
        workspacePath,
        agentsMode: "inline",
        agentsContent: "# AGENTS.md\n你是代码助手",
        persona: {
          tone: "direct",
          language: "zh-CN",
          summaryStyle: "brief"
        },
        focus: {
          projectIds: [],
          riskPreference: "conservative",
          reportPriority: ["risk", "blocker"]
        }
      });
      throw new Error("should throw");
    } catch (error) {
      expect(error).toMatchObject({
        errorCode: "PROVIDER_DISABLED",
        field: "providerId"
      });
    }
  });

  it("文件模式会生成独立助手规则，不继承普通项目会话规则", () => {
    const dataRootDir = mkdtempSync(path.join(os.tmpdir(), "codingns-butler-data-"));
    tempDirs.push(dataRootDir);
    let savedProfile: ButlerProfile | null = null;

    const service = new ButlerProfileService(
      {
        find: vi.fn(() => savedProfile),
        create: vi.fn((record: ButlerProfile) => {
          savedProfile = record;
          return record;
        })
      } as unknown as ButlerProfileRepository,
      {
        list: vi.fn(() => [])
      } as unknown as Pick<ButlerProjectRepository, "list">,
      dataRootDir
    );

    const profile = service.initProfile({
      displayName: "阿尔文",
      providerId: "codex",
      agentsMode: "file",
      persona: {
        tone: "direct",
        language: "zh-CN",
        summaryStyle: "brief"
      },
      focus: {
        projectIds: [],
        riskPreference: "conservative",
        reportPriority: ["risk", "blocker"]
      }
    });

    expect(profile.workspacePath).toBe(path.join(dataRootDir, "butler-workspace"));
    expect(profile.agentsFilePath).toBe(path.join(profile.workspacePath, "AGENTS.md"));
    expect(fs.existsSync(path.join(profile.workspacePath, ".git", "HEAD"))).toBe(true);
    expect(profile.agentsContent).toContain("这套规则只服务于代码助手工作目录");
    expect(profile.agentsContent).toContain("如果上层仓库、默认配置或普通项目会话规则和这里冲突");
  });

  it("读取历史档案时会保留 claude-code provider", () => {
    const service = new ButlerProfileService(
      {
        find: vi.fn(() => ({
          id: "default",
          displayName: "阿尔文",
          providerId: "claude-code",
          workspacePath: "/tmp/butler",
          agentsMode: "inline",
          agentsFilePath: null,
          agentsContent: "# AGENTS.md\n你是代码助手",
          persona: {
            tone: "direct",
            language: "zh-CN",
            summaryStyle: "brief"
          },
          focus: {
            projectIds: [],
            riskPreference: "conservative",
            reportPriority: ["risk"],
            summaryDebounceSeconds: 300
          },
          initializedAt: "2026-04-09T00:00:00.000Z",
          updatedAt: "2026-04-09T00:00:00.000Z"
        }))
      } as unknown as ButlerProfileRepository,
      {
        list: vi.fn(() => [])
      } as unknown as Pick<ButlerProjectRepository, "list">
    );

    expect(service.getProfile()).toMatchObject({
      providerId: "claude-code"
    });
  });
});
