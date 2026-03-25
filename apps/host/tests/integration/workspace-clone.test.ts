import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GitCommandRunner } from "../../src/modules/git/git-command-runner.js";
import { WorkspaceService } from "../../src/modules/workspace/workspace-service.js";
import type { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";
import { createEmptyFixture, createTestApp, destroyFixture, type EmptyFixture } from "../helpers/test-app.js";

const activeClosers: Array<() => Promise<void> | void> = [];
const activeFixtures: EmptyFixture[] = [];
const activeTempDirs: string[] = [];

afterEach(async () => {
  while (activeClosers.length > 0) {
    const close = activeClosers.pop();
    await close?.();
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }

  while (activeTempDirs.length > 0) {
    const tempDir = activeTempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("workspace clone", () => {
  it("支持把 Git 仓库克隆到指定目录并自动导入工作区", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const sourceDir = path.join(fixture.rootDir, "source-repo");
    const remoteDir = path.join(fixture.rootDir, "remote.git");
    const cloneParentPath = path.join(fixture.rootDir, "projects");

    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(cloneParentPath, { recursive: true });
    runGit(sourceDir, ["init", "--initial-branch=main"]);
    runGit(sourceDir, ["config", "user.name", "CodingNS Test"]);
    runGit(sourceDir, ["config", "user.email", "codingns@example.com"]);
    writeFileSync(path.join(sourceDir, "README.md"), "# clone\n", "utf8");
    runGit(sourceDir, ["add", "README.md"]);
    runGit(sourceDir, ["commit", "-m", "chore: init clone fixture"]);
    runGit(fixture.rootDir, ["clone", "--bare", sourceDir, remoteDir]);

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);

    const response = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/clone",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        repositoryUrl: remoteDir,
        parentPath: cloneParentPath,
        directoryName: "cloned-app",
        name: "Cloned App",
        auth: {
          mode: "none"
        }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: "Cloned App",
      path: path.join(cloneParentPath, "cloned-app"),
      repoRoot: path.join(cloneParentPath, "cloned-app")
    });
    expect(
      readFileSync(path.join(cloneParentPath, "cloned-app", "README.md"), "utf8")
    ).toContain("# clone");
  });

  it("使用 token 认证时会注入 askpass，而不是把凭据拼进仓库地址", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-workspace-clone-"));
    activeTempDirs.push(tempDir);

    const parentPath = path.join(tempDir, "projects");
    mkdirSync(parentPath, { recursive: true });

    const runMock = vi.fn(async (cwd: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
      mkdirSync(path.join(parentPath, "private-app"), { recursive: true });

      expect(cwd).toBe(parentPath);
      expect(args).toEqual(["clone", "https://example.com/private.git", "private-app"]);
      expect(options?.env).toMatchObject({
        CODINGNS_GIT_AUTH_USERNAME: "oauth2",
        CODINGNS_GIT_AUTH_SECRET: "secret-token",
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never"
      });

      return {
        stdout: "",
        stderr: "",
        exitCode: 0
      };
    });

    const workspaceRepository = createWorkspaceRepositoryMock();
    const service = new WorkspaceService(
      workspaceRepository as unknown as WorkspaceRepository,
      {
        run: runMock
      } as unknown as GitCommandRunner
    );

    const workspace = await service.cloneWorkspace({
      repositoryUrl: "https://example.com/private.git",
      parentPath,
      directoryName: "private-app",
      name: "Private App",
      auth: {
        mode: "token",
        username: "oauth2",
        token: "secret-token"
      }
    });

    const callOptions = runMock.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv } | undefined;
    const askPassPath = callOptions?.env?.GIT_ASKPASS;

    expect(askPassPath).toBeTruthy();
    expect(existsSync(askPassPath!)).toBe(false);
    expect(workspace).toMatchObject({
      name: "Private App",
      path: path.join(parentPath, "private-app")
    });
    expect(workspaceRepository.create).toHaveBeenCalledTimes(1);
  });
});

function createWorkspaceRepositoryMock() {
  return {
    findByPath: vi.fn(() => null),
    create: vi.fn((record) => record),
    list: vi.fn(() => []),
    findById: vi.fn(() => null)
  };
}

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "password123"
    }
  });

  const login = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "password123"
    }
  });

  return login.json().accessToken as string;
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    env: process.env,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} 执行失败`);
  }
}
