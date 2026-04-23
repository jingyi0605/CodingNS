import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { GitCommandRunner } from "../../src/modules/git/git-command-runner.js";
import { GitReadService } from "../../src/modules/git/git-read-service.js";
import { WorkspaceRepoGuard } from "../../src/modules/git/workspace-repo-guard.js";
import { SessionIsolatedWorkspaceService } from "../../src/modules/parallel-sessions/session-isolated-workspace-service.js";
import { WorkspaceService } from "../../src/modules/workspace/workspace-service.js";
import { SessionIsolatedWorkspaceRepository } from "../../src/storage/repositories/session-isolated-workspace-repository.js";
import { ParallelSessionGroupRepository } from "../../src/storage/repositories/parallel-session-group-repository.js";
import { WorkspaceNavigationStateRepository } from "../../src/storage/repositories/workspace-navigation-state-repository.js";
import { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";
import { WorkspaceWorktreeRepository } from "../../src/storage/repositories/workspace-worktree-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";
import type { SessionListItem } from "../../src/types/domain.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();

    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("SessionIsolatedWorkspaceService", () => {
  it("能创建临时隔离工作区，并且不会混入顶层工作区列表", async () => {
    const harness = createHarness();
    const result = await harness.service.createForMember({
      groupId: "group-1",
      sourceWorkspaceId: harness.rootWorkspace.id,
      createSession: async (workspaceId) => {
        return buildSession("session-1", workspaceId);
      }
    });

    expect(result.record.lifecycleStatus).toBe("active");
    expect(result.record.ownerSessionId).toBe("session-1");
    expect(result.record.workspaceId).toBe(result.workspace.id);
    expect(harness.workspaceWorktreeRepository.findByWorkspaceId(result.workspace.id)).toBeNull();
    expect(harness.workspaceService.list().map((workspace) => workspace.id)).toEqual([harness.rootWorkspace.id]);
    expect(existsSync(result.workspace.path)).toBe(true);
  });

  it("升级临时隔离工作区后会进入正式子工作区链路", async () => {
    const harness = createHarness();
    const created = await harness.service.createForMember({
      groupId: "group-1",
      sourceWorkspaceId: harness.rootWorkspace.id,
      createSession: async (workspaceId) => {
        return buildSession("session-1", workspaceId);
      }
    });

    const promoted = harness.service.promote(created.record.id);

    expect(promoted.record.lifecycleStatus).toBe("promoted");
    expect(promoted.worktree.workspaceId).toBe(created.workspace.id);
    expect(harness.workspaceWorktreeRepository.findByWorkspaceId(created.workspace.id)).not.toBeNull();
  });

  it("删除成员时会清理未升级的临时工作区和分支", async () => {
    const harness = createHarness();
    const created = await harness.service.createForMember({
      groupId: "group-1",
      sourceWorkspaceId: harness.rootWorkspace.id,
      createSession: async (workspaceId) => {
        return buildSession("session-1", workspaceId);
      }
    });

    const cleaned = await harness.service.cleanupByOwnerSessionId("session-1");

    expect(cleaned?.removed).toBe(true);
    expect(cleaned?.record.lifecycleStatus).toBe("removed");
    expect(cleaned?.branchDeleted).toBe(true);
    expect(existsSync(created.workspace.path)).toBe(false);
    expect(harness.sessionIsolatedWorkspaceRepository.findById(created.record.id)?.lifecycleStatus).toBe("removed");
    expect(listBranchNames(harness.rootWorkspace.path)).not.toContain(created.record.branchName);
  });

  it("空仓库也能先补空提交，再创建临时隔离工作区", async () => {
    const harness = createHarness({
      withInitialCommit: false
    });
    const result = await harness.service.createForMember({
      groupId: "group-1",
      sourceWorkspaceId: harness.rootWorkspace.id,
      createSession: async (workspaceId) => {
        return buildSession("session-1", workspaceId);
      }
    });

    expect(result.record.baseRef).toBe("main");
    expect(runGit(harness.rootWorkspace.path, ["rev-list", "--count", "HEAD"])).toBe("1");
    expect(runGit(harness.rootWorkspace.path, ["ls-tree", "--name-only", "-r", "HEAD"])).toBe("");
    expect(existsSync(result.workspace.path)).toBe(true);
  });
});

function createHarness(options: { withInitialCommit?: boolean } = {}) {
  const rootDir = mkdtempSync(path.join(tmpdir(), "codingns-session-isolated-"));
  tempDirs.push(rootDir);
  const repoPath = path.join(rootDir, "repo");
  mkdirSync(repoPath, { recursive: true });
  const withInitialCommit = options.withInitialCommit ?? true;

  runGit(repoPath, ["init", "--initial-branch=main"]);
  runGit(repoPath, ["config", "user.name", "CodingNS Test"]);
  runGit(repoPath, ["config", "user.email", "codingns@example.com"]);

  if (withInitialCommit) {
    writeFileSync(path.join(repoPath, "README.md"), "# parallel\n", "utf8");
    runGit(repoPath, ["add", "README.md"]);
    runGit(repoPath, ["commit", "-m", "chore: init repo"]);
  }

  const database = createDatabaseClient(":memory:");
  const gitCommandRunner = new GitCommandRunner({
    preferHelperProcess: false
  });
  const workspaceRepository = new WorkspaceRepository(database.db);
  const workspaceNavigationStateRepository = new WorkspaceNavigationStateRepository(database.db);
  const workspaceWorktreeRepository = new WorkspaceWorktreeRepository(database.db);
  const sessionIsolatedWorkspaceRepository = new SessionIsolatedWorkspaceRepository(database.db);
  const parallelSessionGroupRepository = new ParallelSessionGroupRepository(database.db);
  const workspaceService = new WorkspaceService(
    workspaceRepository,
    gitCommandRunner,
    workspaceNavigationStateRepository,
    undefined,
    workspaceWorktreeRepository,
    undefined,
    sessionIsolatedWorkspaceRepository
  );
  const rootWorkspace = workspaceService.importWorkspace(repoPath, "Root Repo");
  parallelSessionGroupRepository.create({
    id: "group-1",
    workspaceId: rootWorkspace.id,
    sourceType: "new",
    sourceSessionId: null,
    sourceMessageId: null,
    sharedPrompt: "test",
    requestedCount: 2,
    anchorSessionId: null,
    status: "active",
    createdByUserId: seedUser(database.db, "user-1"),
    createdAt: "2026-04-23T10:00:00.000Z",
    updatedAt: "2026-04-23T10:00:00.000Z",
    deletedAt: null
  });
  const gitReadService = new GitReadService(
    gitCommandRunner,
    new WorkspaceRepoGuard(workspaceService, gitCommandRunner)
  );
  const service = new SessionIsolatedWorkspaceService(
    sessionIsolatedWorkspaceRepository,
    workspaceWorktreeRepository,
    workspaceService,
    gitReadService,
    gitCommandRunner,
    {
      cloneTemplatesToWorkspace() {
        return;
      }
    }
  );

  return {
    service,
    rootWorkspace,
    workspaceService,
    workspaceWorktreeRepository,
    sessionIsolatedWorkspaceRepository
  };
}

function seedUser(db: ReturnType<typeof createDatabaseClient>["db"], userId: string): string {
  db.prepare(
    `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    userId,
    "hash",
    "admin",
    "2026-04-23T08:00:00.000Z",
    "2026-04-23T08:00:00.000Z"
  );

  return userId;
}

function buildSession(sessionId: string, workspaceId: string): SessionListItem {
  return {
    sessionId,
    workspaceId,
    provider: "codex",
    providerSessionId: `${sessionId}-provider`,
    rawStoreRef: `/tmp/${sessionId}.jsonl`,
    parentSessionId: null,
    sessionKind: "default",
    annotationSourceMessageId: null,
    annotationSourceText: null,
    forkMethod: null,
    forkSourceType: null,
    forkSourceSessionId: null,
    forkSourceMessageId: null,
    inheritedPrefixMessageCount: null,
    isSubagent: false,
    subagentLabel: null,
    isArchived: false,
    isFavorite: false,
    title: sessionId,
    messageCount: 1,
    lastMessageAt: "2026-04-23T10:00:00.000Z",
    createdAt: "2026-04-23T10:00:00.000Z",
    updatedAt: "2026-04-23T10:00:00.000Z",
    syncStatus: "idle",
    syncCursor: null,
    lastSyncAt: "2026-04-23T10:00:00.000Z",
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: "idle",
    activitySource: "none",
    lastEventAt: null,
    completedAt: null,
    lastSeenAt: null,
    activityState: "idle",
    parallelGroup: null,
    displayParentSessionId: null,
    sessionIsolatedWorkspace: null
  };
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    env: process.env,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} 执行失败`);
  }

  return result.stdout.trim();
}

function listBranchNames(cwd: string): string[] {
  return runGit(cwd, ["branch", "--format=%(refname:short)"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
