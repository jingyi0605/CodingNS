import { mkdirSync } from "node:fs";
import { realpathSync } from "node:fs";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createGitWorkspaceFixture,
  createTestApp,
  destroyFixture,
  type GitWorkspaceFixture
} from "../helpers/test-app.js";

const activeClosers: Array<() => Promise<void> | void> = [];
const activeFixtures: GitWorkspaceFixture[] = [];

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
});

describe("workspace management", () => {
  it("按当前用户隔离工作区列表和管理入口", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const adminWorkspacePath = path.join(fixture.rootDir, "admin-workspace");
    const memberWorkspacePath = path.join(fixture.rootDir, "member-workspace");
    mkdirSync(adminWorkspacePath, { recursive: true });
    mkdirSync(memberWorkspacePath, { recursive: true });

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const adminToken = await bootstrapAndLogin(hosted);
    const createMemberResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: {
        authorization: `Bearer ${adminToken}`
      },
      payload: {
        username: "member",
        password: "password456"
      }
    });
    expect(createMemberResponse.statusCode).toBe(201);

    const memberLoginResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "member",
        password: "password456"
      }
    });
    expect(memberLoginResponse.statusCode).toBe(200);
    const memberToken = memberLoginResponse.json().accessToken as string;

    const adminImportResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${adminToken}`
      },
      payload: {
        path: adminWorkspacePath,
        name: "Admin Workspace"
      }
    });
    expect(adminImportResponse.statusCode).toBe(201);
    const adminWorkspace = adminImportResponse.json() as { id: string; ownerUserId: string };
    expect(adminWorkspace.ownerUserId).toBeTruthy();

    const memberImportResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${memberToken}`
      },
      payload: {
        path: memberWorkspacePath,
        name: "Member Workspace"
      }
    });
    expect(memberImportResponse.statusCode).toBe(201);
    const memberWorkspace = memberImportResponse.json() as { id: string; ownerUserId: string };
    expect(memberWorkspace.ownerUserId).toBeTruthy();
    expect(memberWorkspace.ownerUserId).not.toBe(adminWorkspace.ownerUserId);

    const adminListResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: {
        authorization: `Bearer ${adminToken}`
      }
    });
    expect(adminListResponse.statusCode).toBe(200);
    expect((adminListResponse.json().items as Array<{ id: string }>).map((item) => item.id)).toEqual([
      adminWorkspace.id
    ]);

    const memberListResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: {
        authorization: `Bearer ${memberToken}`
      }
    });
    expect(memberListResponse.statusCode).toBe(200);
    expect((memberListResponse.json().items as Array<{ id: string }>).map((item) => item.id)).toEqual([
      memberWorkspace.id
    ]);

    const memberReadsAdminManagement = await hosted.app.inject({
      method: "GET",
      url: `/api/workspaces/${adminWorkspace.id}/management`,
      headers: {
        authorization: `Bearer ${memberToken}`
      }
    });
    expect(memberReadsAdminManagement.statusCode).toBe(404);

    const memberDeletesAdminWorkspace = await hosted.app.inject({
      method: "DELETE",
      url: `/api/workspaces/${adminWorkspace.id}`,
      headers: {
        authorization: `Bearer ${memberToken}`
      }
    });
    expect(memberDeletesAdminWorkspace.statusCode).toBe(404);
  });

  it("支持读取工作区管理详情，并在软移除后用同一路径恢复旧记录", async () => {
    const fixture = createGitWorkspaceFixture({ withRemote: true });
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const realWorkspacePath = realpathSync(fixture.workspaceDir);
    const importResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Managed Workspace"
      }
    });

    expect(importResponse.statusCode).toBe(201);
    const importedWorkspace = importResponse.json() as {
      id: string;
      name: string;
      path: string;
      repoRoot: string | null;
    };

    const detailResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/workspaces/${importedWorkspace.id}/management`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      workspaceId: importedWorkspace.id,
      name: "Managed Workspace",
      path: fixture.workspaceDir,
      git: {
        isRepository: true,
        currentBranch: "main",
        commitCount: 1,
        error: null
      },
      codeComposition: {
        truncated: false,
        error: null
      }
    });
    expect(detailResponse.json().git.repoRoot).toBe(realWorkspacePath);
    expect(detailResponse.json().git.remotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "origin"
        })
      ])
    );
    expect(detailResponse.json().codeComposition.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "Markdown",
          count: 1
        })
      ])
    );

    const removeResponse = await hosted.app.inject({
      method: "DELETE",
      url: `/api/workspaces/${importedWorkspace.id}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(removeResponse.statusCode).toBe(200);
    expect(removeResponse.json().removedAt).toBeTruthy();

    const listAfterRemove = await hosted.app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(listAfterRemove.statusCode).toBe(200);
    expect(listAfterRemove.json().items).toHaveLength(0);

    const reimportResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir
      }
    });

    expect(reimportResponse.statusCode).toBe(201);
    expect(reimportResponse.json()).toMatchObject({
      id: importedWorkspace.id,
      name: "Managed Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir
    });

    const listAfterReimport = await hosted.app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(listAfterReimport.statusCode).toBe(200);
    expect(listAfterReimport.json().items).toEqual([
      expect.objectContaining({
        id: importedWorkspace.id,
        name: "Managed Workspace"
      })
    ]);
  });

  it("代码组成只统计 Git 已跟踪文件，不混入未跟踪文件", async () => {
    const fixture = createGitWorkspaceFixture();
    activeFixtures.push(fixture);
    writeFileSync(path.join(fixture.workspaceDir, "scratch.rs"), "fn main() {}\n", "utf8");

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const importResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Tracked Only Workspace"
      }
    });

    expect(importResponse.statusCode).toBe(201);

    const detailResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/workspaces/${importResponse.json().id as string}/management`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().codeComposition.scannedFileCount).toBe(1);
    expect(detailResponse.json().codeComposition.items).toEqual([
      expect.objectContaining({
        type: "Markdown",
        count: 1
      })
    ]);
    expect(
      detailResponse.json().codeComposition.items.some(
        (item: { type: string }) => item.type === "Rust"
      )
    ).toBe(false);
  });

  it("支持工作区重排，并把折叠状态持久化到工作台快照", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const butlerWorkspacePath = path.join(fixture.rootDir, "butler-workspace");
    const hiddenWorkspacePath = path.join(butlerWorkspacePath, "hidden-workspace");
    const workspaceAlphaPath = path.join(fixture.rootDir, "workspace-alpha");
    const workspaceBetaPath = path.join(fixture.rootDir, "workspace-beta");
    const workspaceGammaPath = path.join(fixture.rootDir, "workspace-gamma");
    mkdirSync(hiddenWorkspacePath, { recursive: true });
    mkdirSync(workspaceAlphaPath, { recursive: true });
    mkdirSync(workspaceBetaPath, { recursive: true });
    mkdirSync(workspaceGammaPath, { recursive: true });

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const initButlerProfileResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/butler/profile/init",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        displayName: "代码助手",
        providerId: "codex",
        workspacePath: butlerWorkspacePath
      }
    });

    expect(initButlerProfileResponse.statusCode).toBe(201);

    const importHiddenWorkspaceResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: hiddenWorkspacePath,
        name: "Hidden"
      }
    });

    expect(importHiddenWorkspaceResponse.statusCode).toBe(201);

    const importedWorkspaces = [] as Array<{ id: string; name: string; sortOrder: number }>;

    for (const [workspacePath, name] of [
      [workspaceAlphaPath, "Alpha"],
      [workspaceBetaPath, "Beta"],
      [workspaceGammaPath, "Gamma"]
    ] as const) {
      const response = await hosted.app.inject({
        method: "POST",
        url: "/api/workspaces/import",
        headers: {
          authorization: `Bearer ${accessToken}`
        },
        payload: {
          path: workspacePath,
          name
        }
      });

      expect(response.statusCode).toBe(201);
      importedWorkspaces.push(response.json() as { id: string; name: string; sortOrder: number });
    }

    expect(importedWorkspaces.map((workspace) => workspace.sortOrder)).toEqual([1, 2, 3]);

    const reorderResponse = await hosted.app.inject({
      method: "PUT",
      url: "/api/workspaces/reorder",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceIds: [
          importedWorkspaces[2].id,
          importedWorkspaces[0].id,
          importedWorkspaces[1].id
        ]
      }
    });

    expect(reorderResponse.statusCode).toBe(200);
    expect(
      (reorderResponse.json().items as Array<{ id: string; sortOrder: number }>).map((workspace) => ({
        id: workspace.id,
        sortOrder: workspace.sortOrder
      }))
    ).toEqual([
      { id: importedWorkspaces[2].id, sortOrder: 0 },
      { id: importedWorkspaces[0].id, sortOrder: 1 },
      { id: importedWorkspaces[1].id, sortOrder: 2 }
    ]);

    const collapseResponse = await hosted.app.inject({
      method: "PUT",
      url: `/api/workspaces/${importedWorkspaces[0].id}/navigation-state`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        collapsed: true
      }
    });

    expect(collapseResponse.statusCode).toBe(200);
    expect(collapseResponse.json()).toMatchObject({
      workspaceId: importedWorkspaces[0].id,
      collapsed: true
    });

    const workbenchResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/workbench",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(workbenchResponse.statusCode).toBe(200);
    expect(workbenchResponse.json().items).toHaveLength(3);
    expect(workbenchResponse.json().items).toEqual([
      expect.objectContaining({
        workspace: expect.objectContaining({
          id: importedWorkspaces[2].id,
          sortOrder: 0
        }),
        collapsed: false
      }),
      expect.objectContaining({
        workspace: expect.objectContaining({
          id: importedWorkspaces[0].id,
          sortOrder: 1
        }),
        collapsed: true
      }),
      expect.objectContaining({
        workspace: expect.objectContaining({
          id: importedWorkspaces[1].id,
          sortOrder: 2
        }),
        collapsed: false
      })
    ]);
  });
});

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
