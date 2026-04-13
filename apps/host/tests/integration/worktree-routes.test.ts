import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { nowIso } from "../../src/shared/utils/time.js";
import {
  createGitWorkspaceFixture,
  createTestApp,
  destroyFixture,
  type GitWorkspaceFixture
} from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: GitWorkspaceFixture[] = [];

afterEach(async () => {
  while (activeServers.length > 0) {
    const hosted = activeServers.pop();

    if (hosted) {
      hosted.app.server.closeAllConnections?.();
      await hosted.app.close();
    }
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("worktree routes", () => {
  it("可以从根工作区创建子工作树，并且不会混进顶层工作区列表", async () => {
    const fixture = createGitWorkspaceFixture();
    activeFixtures.push(fixture);
    runGitCommand(fixture.repoDir, ["restore", "README.md"]);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapWorkspace(hosted, fixture);
    const accessToken = await loginAsAdmin(hosted);

    const response = await hosted.app.inject({
      method: "POST",
      url: "/api/worktrees",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        sourceWorkspaceId: fixture.workspaceId,
        branchName: "feat/login"
      }
    });

    expect(response.statusCode).toBe(201);

    const body = response.json() as {
      workspace: {
        id: string;
        path: string;
        name: string;
      };
      meta: {
        workspaceId: string;
        rootWorkspaceId: string;
        parentWorkspaceId: string;
        sourceWorkspaceId: string;
        mergeTargetWorkspaceId: string;
        branchName: string;
        baseRef: string;
        depth: number;
        lifecycleStatus: string;
      };
    };
    const expectedPath = path.join(fixture.rootDir, "workspace.worktrees", "feat-login");

    expect(body.workspace.path).toBe(expectedPath);
    expect(body.workspace.name).toBe("feat/login");
    expect(body.meta).toMatchObject({
      workspaceId: body.workspace.id,
      rootWorkspaceId: fixture.workspaceId,
      parentWorkspaceId: fixture.workspaceId,
      sourceWorkspaceId: fixture.workspaceId,
      mergeTargetWorkspaceId: fixture.workspaceId,
      branchName: "feat/login",
      baseRef: "main",
      depth: 1,
      lifecycleStatus: "active"
    });
    expect(existsSync(expectedPath)).toBe(true);
    expect(runGitCommand(expectedPath, ["branch", "--show-current"])).toBe("feat/login");
    expect(runGitCommand(fixture.repoDir, ["branch", "--show-current"])).toBe("main");
    expect(
      hosted.services.repositories.workspaceWorktreeRepository.findByWorkspaceId(body.workspace.id)
    ).toMatchObject({
      workspaceId: body.workspace.id,
      rootWorkspaceId: fixture.workspaceId,
      branchName: "feat/login"
    });

    const workspaceListResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const workbenchResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/workbench",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(workspaceListResponse.statusCode).toBe(200);
    expect(workspaceListResponse.json().items.map((item: { id: string }) => item.id)).toEqual([
      fixture.workspaceId
    ]);
    expect(workbenchResponse.statusCode).toBe(200);
    expect(workbenchResponse.json().items.map((item: { workspace: { id: string } }) => item.workspace.id)).toEqual([
      fixture.workspaceId
    ]);
  });

  it("来源工作区有未提交改动时会拒绝创建子工作树", async () => {
    const fixture = createGitWorkspaceFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapWorkspace(hosted, fixture);
    const accessToken = await loginAsAdmin(hosted);

    const response = await hosted.app.inject({
      method: "POST",
      url: "/api/worktrees",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        sourceWorkspaceId: fixture.workspaceId,
        branchName: "feat/blocked"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error_code).toBe("WORKTREE_SOURCE_DIRTY");
    expect(existsSync(path.join(fixture.rootDir, "workspace.worktrees", "feat-blocked"))).toBe(false);
    expect(
      hosted.services.repositories.workspaceWorktreeRepository.listByRootWorkspaceId(fixture.workspaceId)
    ).toEqual([]);
  });

  it("支持从子工作树继续 fork，并按真实父子关系返回工作树", async () => {
    const fixture = createGitWorkspaceFixture();
    activeFixtures.push(fixture);
    runGitCommand(fixture.repoDir, ["restore", "README.md"]);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapWorkspace(hosted, fixture);
    const accessToken = await loginAsAdmin(hosted);

    const childResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/worktrees",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        sourceWorkspaceId: fixture.workspaceId,
        branchName: "feat/child"
      }
    });

    expect(childResponse.statusCode).toBe(201);

    const childWorkspaceId = childResponse.json().workspace.id as string;
    const grandChildResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/worktrees",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        sourceWorkspaceId: childWorkspaceId,
        branchName: "feat/grand-child"
      }
    });

    expect(grandChildResponse.statusCode).toBe(201);
    expect(grandChildResponse.json().meta).toMatchObject({
      rootWorkspaceId: fixture.workspaceId,
      parentWorkspaceId: childWorkspaceId,
      sourceWorkspaceId: childWorkspaceId,
      mergeTargetWorkspaceId: childWorkspaceId,
      depth: 2,
      branchName: "feat/grand-child",
      baseRef: "feat/child"
    });

    const treeResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/worktrees/tree?rootWorkspaceId=${fixture.workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(treeResponse.statusCode).toBe(200);
    expect(treeResponse.json().items).toHaveLength(1);
    expect(treeResponse.json().items[0]).toMatchObject({
      workspace: {
        id: childWorkspaceId,
        path: path.join(fixture.rootDir, "workspace.worktrees", "feat-child")
      },
      meta: {
        rootWorkspaceId: fixture.workspaceId,
        parentWorkspaceId: fixture.workspaceId,
        depth: 1,
        branchName: "feat/child"
      }
    });
    expect(treeResponse.json().items[0].children).toHaveLength(1);
    expect(treeResponse.json().items[0].children[0]).toMatchObject({
      workspace: {
        path: path.join(fixture.rootDir, "workspace.worktrees", "feat-grand-child")
      },
      meta: {
        rootWorkspaceId: fixture.workspaceId,
        parentWorkspaceId: childWorkspaceId,
        depth: 2,
        branchName: "feat/grand-child"
      }
    });

    const workbenchResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/workbench",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(workbenchResponse.statusCode).toBe(200);
    expect(workbenchResponse.json().items).toHaveLength(1);
    expect(workbenchResponse.json().items[0]).toMatchObject({
      workspace: {
        id: fixture.workspaceId
      },
      childWorktrees: [
        {
          workspace: {
            id: childWorkspaceId
          },
          children: [
            {
              workspace: {
                id: grandChildResponse.json().workspace.id
              }
            }
          ]
        }
      ]
    });
  });

  it("读取工作树树时会回收已经丢失目录的残留记录", async () => {
    const fixture = createGitWorkspaceFixture();
    activeFixtures.push(fixture);
    runGitCommand(fixture.repoDir, ["restore", "README.md"]);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapWorkspace(hosted, fixture);
    const accessToken = await loginAsAdmin(hosted);

    const createResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/worktrees",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        sourceWorkspaceId: fixture.workspaceId,
        branchName: "feat/stale"
      }
    });

    expect(createResponse.statusCode).toBe(201);

    const childWorkspaceId = createResponse.json().workspace.id as string;
    const childPath = createResponse.json().workspace.path as string;

    rmSync(childPath, { recursive: true, force: true });

    const treeResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/worktrees/tree?rootWorkspaceId=${fixture.workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const meta = hosted.services.repositories.workspaceWorktreeRepository.findByWorkspaceId(childWorkspaceId);
    const workspace = hosted.services.repositories.workspaceRepository.findById(childWorkspaceId);

    expect(treeResponse.statusCode).toBe(200);
    expect(treeResponse.json().items).toEqual([]);
    expect(meta).toMatchObject({
      workspaceId: childWorkspaceId,
      lifecycleStatus: "removed"
    });
    expect(meta?.removedAt).toBeTruthy();
    expect(workspace?.removedAt).toBeTruthy();
  });

  it("可以预检并把子工作树合并回直接父节点", async () => {
    const fixture = createGitWorkspaceFixture();
    activeFixtures.push(fixture);
    runGitCommand(fixture.repoDir, ["restore", "README.md"]);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapWorkspace(hosted, fixture);
    const accessToken = await loginAsAdmin(hosted);
    const createResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/worktrees",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        sourceWorkspaceId: fixture.workspaceId,
        branchName: "feat/merge-ready"
      }
    });

    expect(createResponse.statusCode).toBe(201);

    const childWorkspaceId = createResponse.json().workspace.id as string;
    const childPath = createResponse.json().workspace.path as string;

    appendLine(childPath, "README.md", "来自子工作树的提交");
    runGitCommand(childPath, ["add", "README.md"]);
    runGitCommand(childPath, ["commit", "-m", "feat: add child change"]);

    const previewResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/worktrees/${childWorkspaceId}/merge-preview`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(previewResponse.statusCode).toBe(200);
    expect(previewResponse.json()).toMatchObject({
      workspaceId: childWorkspaceId,
      ahead: 1,
      behind: 0,
      hasConflicts: false,
      alreadyMerged: false,
      canMerge: true,
      blockers: [],
      sourceWorkspace: {
        id: childWorkspaceId
      },
      targetWorkspace: {
        id: fixture.workspaceId
      }
    });

    const mergeResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/worktrees/${childWorkspaceId}/merge-into-parent`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(mergeResponse.statusCode).toBe(200);
    expect(mergeResponse.json()).toMatchObject({
      applied: true,
      meta: {
        workspaceId: childWorkspaceId,
        lifecycleStatus: "merged"
      }
    });
    expect(mergeResponse.json().meta.mergedAt).toBeTruthy();
    expect(runGitCommand(fixture.repoDir, ["log", "--format=%s", "-1"])).toContain("Merge branch");
    expect(readFile(fixture.repoDir, "README.md")).toContain("来自子工作树的提交");
  });

  it("合并预检会识别和父工作区的冲突", async () => {
    const fixture = createGitWorkspaceFixture();
    activeFixtures.push(fixture);
    runGitCommand(fixture.repoDir, ["restore", "README.md"]);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapWorkspace(hosted, fixture);
    const accessToken = await loginAsAdmin(hosted);
    const createResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/worktrees",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        sourceWorkspaceId: fixture.workspaceId,
        branchName: "feat/conflict"
      }
    });

    expect(createResponse.statusCode).toBe(201);

    const childWorkspaceId = createResponse.json().workspace.id as string;
    const childPath = createResponse.json().workspace.path as string;

    writeFile(childPath, "README.md", "# 标题\n\n子工作树版本\n");
    runGitCommand(childPath, ["add", "README.md"]);
    runGitCommand(childPath, ["commit", "-m", "feat: child conflict"]);

    writeFile(fixture.repoDir, "README.md", "# 标题\n\n父工作区版本\n");
    runGitCommand(fixture.repoDir, ["add", "README.md"]);
    runGitCommand(fixture.repoDir, ["commit", "-m", "feat: parent conflict"]);

    const previewResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/worktrees/${childWorkspaceId}/merge-preview`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(previewResponse.statusCode).toBe(200);
    expect(previewResponse.json()).toMatchObject({
      workspaceId: childWorkspaceId,
      hasConflicts: true,
      canMerge: false
    });
    expect(previewResponse.json().conflictPaths).toContain("README.md");
    expect(
      previewResponse.json().blockers.some((item: { code: string }) => item.code === "HAS_CONFLICTS")
    ).toBe(true);
  });

  it("合并预检会拦截直接父工作区脏状态", async () => {
    const fixture = createGitWorkspaceFixture();
    activeFixtures.push(fixture);
    runGitCommand(fixture.repoDir, ["restore", "README.md"]);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapWorkspace(hosted, fixture);
    const accessToken = await loginAsAdmin(hosted);
    const createResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/worktrees",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        sourceWorkspaceId: fixture.workspaceId,
        branchName: "feat/target-dirty"
      }
    });

    expect(createResponse.statusCode).toBe(201);

    const childWorkspaceId = createResponse.json().workspace.id as string;

    appendLine(fixture.repoDir, "README.md", "父工作区未提交改动");

    const previewResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/worktrees/${childWorkspaceId}/merge-preview`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(previewResponse.statusCode).toBe(200);
    expect(previewResponse.json()).toMatchObject({
      workspaceId: childWorkspaceId,
      canMerge: false
    });
    expect(
      previewResponse.json().blockers.some((item: { code: string }) => item.code === "TARGET_DIRTY")
    ).toBe(true);
  });

  it("git 已经合入父工作区但元数据仍是 active 时，预检会自动纠正为已合并", async () => {
    const fixture = createGitWorkspaceFixture();
    activeFixtures.push(fixture);
    runGitCommand(fixture.repoDir, ["restore", "README.md"]);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapWorkspace(hosted, fixture);
    const accessToken = await loginAsAdmin(hosted);
    const createResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/worktrees",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        sourceWorkspaceId: fixture.workspaceId,
        branchName: "feat/merged-but-meta-stale"
      }
    });

    expect(createResponse.statusCode).toBe(201);

    const childWorkspaceId = createResponse.json().workspace.id as string;
    const childPath = createResponse.json().workspace.path as string;

    appendLine(childPath, "README.md", "来自子工作树的已合并提交");
    runGitCommand(childPath, ["add", "README.md"]);
    runGitCommand(childPath, ["commit", "-m", "feat: merged but meta stale"]);

    runGitCommand(fixture.repoDir, ["merge", "--no-ff", "--no-edit", "feat/merged-but-meta-stale"]);

    const staleMeta = hosted.services.repositories.workspaceWorktreeRepository.findByWorkspaceId(childWorkspaceId);
    expect(staleMeta).not.toBeNull();

    hosted.services.repositories.workspaceWorktreeRepository.update({
      ...staleMeta!,
      lifecycleStatus: "active",
      mergedAt: null,
      updatedAt: nowIso()
    });

    const previewResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/worktrees/${childWorkspaceId}/merge-preview`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(previewResponse.statusCode).toBe(200);
    expect(previewResponse.json()).toMatchObject({
      workspaceId: childWorkspaceId,
      ahead: 0,
      behind: 1,
      alreadyMerged: true,
      canMerge: false,
      meta: {
        workspaceId: childWorkspaceId,
        lifecycleStatus: "merged"
      }
    });
    expect(previewResponse.json().meta.mergedAt).toBeTruthy();
    expect(
      previewResponse.json().blockers.some((item: { code: string }) => item.code === "NO_COMMITS_TO_MERGE")
    ).toBe(false);
    expect(
      previewResponse.json().blockers.some((item: { code: string }) => item.code === "SOURCE_NOT_ACTIVE")
    ).toBe(false);

    expect(
      hosted.services.repositories.workspaceWorktreeRepository.findByWorkspaceId(childWorkspaceId)
    ).toMatchObject({
      workspaceId: childWorkspaceId,
      lifecycleStatus: "merged"
    });
  });

  it("git 仍可合并但元数据被误标为 merged 时，预检会自动恢复 active", async () => {
    const fixture = createGitWorkspaceFixture();
    activeFixtures.push(fixture);
    runGitCommand(fixture.repoDir, ["restore", "README.md"]);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapWorkspace(hosted, fixture);
    const accessToken = await loginAsAdmin(hosted);
    const createResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/worktrees",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        sourceWorkspaceId: fixture.workspaceId,
        branchName: "feat/meta-should-be-active"
      }
    });

    expect(createResponse.statusCode).toBe(201);

    const childWorkspaceId = createResponse.json().workspace.id as string;
    const childPath = createResponse.json().workspace.path as string;

    appendLine(childPath, "README.md", "子工作树里还有待合并提交");
    runGitCommand(childPath, ["add", "README.md"]);
    runGitCommand(childPath, ["commit", "-m", "feat: meta should restore active"]);

    const staleMeta = hosted.services.repositories.workspaceWorktreeRepository.findByWorkspaceId(childWorkspaceId);
    expect(staleMeta).not.toBeNull();

    hosted.services.repositories.workspaceWorktreeRepository.update({
      ...staleMeta!,
      lifecycleStatus: "merged",
      mergedAt: nowIso(),
      updatedAt: nowIso()
    });

    const previewResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/worktrees/${childWorkspaceId}/merge-preview`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(previewResponse.statusCode).toBe(200);
    expect(previewResponse.json()).toMatchObject({
      workspaceId: childWorkspaceId,
      ahead: 1,
      behind: 0,
      alreadyMerged: false,
      canMerge: true,
      meta: {
        workspaceId: childWorkspaceId,
        lifecycleStatus: "active",
        mergedAt: null
      }
    });
    expect(
      previewResponse.json().blockers.some((item: { code: string }) => item.code === "SOURCE_NOT_ACTIVE")
    ).toBe(false);

    expect(
      hosted.services.repositories.workspaceWorktreeRepository.findByWorkspaceId(childWorkspaceId)
    ).toMatchObject({
      workspaceId: childWorkspaceId,
      lifecycleStatus: "active",
      mergedAt: null
    });
  });

  it("已经合并的子工作树可以被安全清理", async () => {
    const fixture = createGitWorkspaceFixture();
    activeFixtures.push(fixture);
    runGitCommand(fixture.repoDir, ["restore", "README.md"]);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapWorkspace(hosted, fixture);
    const accessToken = await loginAsAdmin(hosted);
    const createResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/worktrees",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        sourceWorkspaceId: fixture.workspaceId,
        branchName: "feat/cleanup-me"
      }
    });

    expect(createResponse.statusCode).toBe(201);

    const childWorkspaceId = createResponse.json().workspace.id as string;
    const childPath = createResponse.json().workspace.path as string;

    appendLine(childPath, "README.md", "准备回收的改动");
    runGitCommand(childPath, ["add", "README.md"]);
    runGitCommand(childPath, ["commit", "-m", "feat: cleanup target"]);

    const mergeResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/worktrees/${childWorkspaceId}/merge-into-parent`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(mergeResponse.statusCode).toBe(200);

    const cleanupResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/worktrees/${childWorkspaceId}/cleanup`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(cleanupResponse.statusCode).toBe(200);
    expect(cleanupResponse.json()).toMatchObject({
      workspaceId: childWorkspaceId,
      removed: true,
      meta: {
        workspaceId: childWorkspaceId,
        lifecycleStatus: "removed"
      }
    });
    expect(cleanupResponse.json().meta.removedAt).toBeTruthy();
    expect(existsSync(childPath)).toBe(false);
    expect(
      hosted.services.repositories.workspaceWorktreeRepository.findByWorkspaceId(childWorkspaceId)
    ).toMatchObject({
      workspaceId: childWorkspaceId,
      lifecycleStatus: "removed"
    });
    expect(hosted.services.repositories.workspaceRepository.findById(childWorkspaceId)?.removedAt).toBeTruthy();
  });

  it("已经合并的子工作树在请求 deleteBranch=true 时会同时删除分支", async () => {
    const fixture = createGitWorkspaceFixture();
    activeFixtures.push(fixture);
    runGitCommand(fixture.repoDir, ["restore", "README.md"]);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapWorkspace(hosted, fixture);
    const accessToken = await loginAsAdmin(hosted);
    const createResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/worktrees",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        sourceWorkspaceId: fixture.workspaceId,
        branchName: "feat/delete-branch"
      }
    });

    expect(createResponse.statusCode).toBe(201);

    const childWorkspaceId = createResponse.json().workspace.id as string;
    const childPath = createResponse.json().workspace.path as string;

    appendLine(childPath, "README.md", "准备连分支一起清理");
    runGitCommand(childPath, ["add", "README.md"]);
    runGitCommand(childPath, ["commit", "-m", "feat: merge before cleanup delete branch"]);

    const mergeResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/worktrees/${childWorkspaceId}/merge-into-parent`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(mergeResponse.statusCode).toBe(200);

    const cleanupResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/worktrees/${childWorkspaceId}/cleanup`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        deleteBranch: true
      }
    });

    expect(cleanupResponse.statusCode).toBe(200);
    expect(cleanupResponse.json()).toMatchObject({
      workspaceId: childWorkspaceId,
      removed: true,
      branchDeleteRequested: true,
      branchDeleted: true,
      deletedBranchName: "feat/delete-branch",
      branchDeleteError: null,
      meta: {
        workspaceId: childWorkspaceId,
        lifecycleStatus: "removed"
      }
    });
    expect(runGitCommand(fixture.repoDir, ["branch", "--list", "feat/delete-branch"])).toBe("");
    expect(existsSync(childPath)).toBe(false);
  });

  it("未合并的子工作树请求 deleteBranch=true 时会被拒绝", async () => {
    const fixture = createGitWorkspaceFixture();
    activeFixtures.push(fixture);
    runGitCommand(fixture.repoDir, ["restore", "README.md"]);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapWorkspace(hosted, fixture);
    const accessToken = await loginAsAdmin(hosted);
    const createResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/worktrees",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        sourceWorkspaceId: fixture.workspaceId,
        branchName: "feat/not-merged-delete"
      }
    });

    expect(createResponse.statusCode).toBe(201);

    const childWorkspaceId = createResponse.json().workspace.id as string;
    const childPath = createResponse.json().workspace.path as string;

    appendLine(childPath, "README.md", "还没合并，不允许删分支");
    runGitCommand(childPath, ["add", "README.md"]);
    runGitCommand(childPath, ["commit", "-m", "feat: not merged yet"]);

    const cleanupResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/worktrees/${childWorkspaceId}/cleanup`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        deleteBranch: true
      }
    });

    expect(cleanupResponse.statusCode).toBe(409);
    expect(cleanupResponse.json().error_code).toBe("WORKTREE_CLEANUP_BRANCH_NOT_MERGED");
    expect(existsSync(childPath)).toBe(true);
    expect(runGitCommand(fixture.repoDir, ["branch", "--list", "feat/not-merged-delete"])).toContain(
      "feat/not-merged-delete"
    );
  });

  it("清理时会拦截仍有活跃终端占用的工作树", async () => {
    const fixture = createGitWorkspaceFixture();
    activeFixtures.push(fixture);
    runGitCommand(fixture.repoDir, ["restore", "README.md"]);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapWorkspace(hosted, fixture);
    const accessToken = await loginAsAdmin(hosted);
    const createResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/worktrees",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        sourceWorkspaceId: fixture.workspaceId,
        branchName: "feat/busy-cleanup"
      }
    });

    expect(createResponse.statusCode).toBe(201);

    const childWorkspaceId = createResponse.json().workspace.id as string;
    const childPath = createResponse.json().workspace.path as string;
    const adminUserId =
      hosted.services.repositories.authUserRepository.findByUsername("admin")?.id ?? "admin";

    hosted.services.repositories.terminalInstanceRepository.create({
      id: "terminal-busy-1",
      workspaceId: childWorkspaceId,
      name: "Busy Terminal",
      cwd: childPath,
      shell: "/bin/zsh",
      runtimeType: "embedded-pty",
      runtimeSessionId: "runtime-session-1",
      attachTarget: "shell",
      status: "running",
      processId: 12345,
      createdByUserId: adminUserId,
      createdAt: nowIso(),
      lastActiveAt: nowIso(),
      closedAt: null,
      exitCode: null,
      statusDetail: null
    });

    const cleanupResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/worktrees/${childWorkspaceId}/cleanup`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(cleanupResponse.statusCode).toBe(409);
    expect(cleanupResponse.json().error_code).toBe("WORKTREE_CLEANUP_BUSY_TERMINAL");
    expect(existsSync(childPath)).toBe(true);
    expect(
      hosted.services.repositories.workspaceWorktreeRepository.findByWorkspaceId(childWorkspaceId)
    ).toMatchObject({
      workspaceId: childWorkspaceId,
      lifecycleStatus: "active"
    });
  });

  it("清理失败时会保留工作树目录和元数据，避免半删状态", async () => {
    const fixture = createGitWorkspaceFixture();
    activeFixtures.push(fixture);
    runGitCommand(fixture.repoDir, ["restore", "README.md"]);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapWorkspace(hosted, fixture);
    const accessToken = await loginAsAdmin(hosted);
    const createResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/worktrees",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        sourceWorkspaceId: fixture.workspaceId,
        branchName: "feat/dirty-cleanup"
      }
    });

    expect(createResponse.statusCode).toBe(201);

    const childWorkspaceId = createResponse.json().workspace.id as string;
    const childPath = createResponse.json().workspace.path as string;

    appendLine(childPath, "README.md", "还没提交的改动");

    const cleanupResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/worktrees/${childWorkspaceId}/cleanup`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(cleanupResponse.statusCode).toBe(409);
    expect(cleanupResponse.json().error_code).toBe("WORKTREE_CLEANUP_DIRTY");
    expect(existsSync(childPath)).toBe(true);
    expect(
      hosted.services.repositories.workspaceWorktreeRepository.findByWorkspaceId(childWorkspaceId)
    ).toMatchObject({
      workspaceId: childWorkspaceId,
      lifecycleStatus: "active",
      removedAt: null
    });
  });
});

async function bootstrapWorkspace(
  hosted: ReturnType<typeof createTestApp>,
  fixture: GitWorkspaceFixture
): Promise<void> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  const timestamp = nowIso();

  hosted.services.repositories.workspaceRepository.create({
    id: fixture.workspaceId,
    name: "Git 工作区",
    path: fixture.workspaceDir,
    repoRoot: fixture.workspaceDir,
    favorite: false,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

async function loginAsAdmin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  const loginResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  return loginResponse.json().accessToken as string;
}

function runGitCommand(cwd: string, args: string[]): string {
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

function appendLine(cwd: string, fileName: string, line: string): void {
  writeFile(cwd, fileName, `${readFile(cwd, fileName)}${line}\n`);
}

function writeFile(cwd: string, fileName: string, content: string): void {
  writeFileSync(path.join(cwd, fileName), content, "utf8");
}

function readFile(cwd: string, fileName: string): string {
  return readFileSync(path.join(cwd, fileName), "utf8");
}
