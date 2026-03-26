import { realpathSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
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
