import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createGitWorkspaceFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture,
  type GitWorkspaceFixture
} from "../helpers/test-app.js";

const activeClosers: Array<() => Promise<void> | void> = [];
const activeEmptyFixtures: EmptyFixture[] = [];
const activeGitFixtures: GitWorkspaceFixture[] = [];

function createWsMessageQueue(socket: WebSocket) {
  const pending: string[] = [];
  const waiters: Array<(value: string) => void> = [];

  socket.on("message", (raw) => {
    const text = raw.toString();
    const waiter = waiters.shift();

    if (waiter) {
      waiter(text);
      return;
    }

    pending.push(text);
  });

  return {
    async next(timeoutMs = 2000): Promise<string> {
      if (pending.length > 0) {
        return pending.shift()!;
      }

      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.indexOf(resolve);

          if (index >= 0) {
            waiters.splice(index, 1);
          }

          reject(new Error(`等待 WebSocket 消息超时: ${timeoutMs}ms`));
        }, timeoutMs);

        waiters.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
    }
  };
}

afterEach(async () => {
  while (activeClosers.length > 0) {
    const close = activeClosers.pop();
    await close?.();
  }

  while (activeEmptyFixtures.length > 0) {
    const fixture = activeEmptyFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }

  while (activeGitFixtures.length > 0) {
    const fixture = activeGitFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("workbench panel snapshots", () => {
  it("terminalManager.snapshot 会携带 shellOptions", async () => {
    const fixture = createEmptyFixture();
    activeEmptyFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir, "Shell Workspace");

    await hosted.app.listen({
      host: "127.0.0.1",
      port: 0
    });

    const address = hosted.app.server.address();

    if (!address || typeof address === "string") {
      throw new Error("terminalManager snapshot 测试服务地址异常");
    }

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`);
    activeClosers.push(() => socket.close());
    const queue = createWsMessageQueue(socket);

    expect(JSON.parse(await queue.next()).type).toBe("system.connected");

    socket.send(
      JSON.stringify({
        type: "terminalManager.subscribe",
        workspaceId
      })
    );

    while (true) {
      const payload = JSON.parse(await queue.next()) as {
        type: string;
        snapshot?: {
          workspaceId: string;
          shellOptions?: Array<{
            id: string;
            shell: string;
            available: boolean;
          }>;
        };
      };

      if (payload.type !== "terminalManager.snapshot" || !payload.snapshot) {
        continue;
      }

      expect(payload.snapshot.workspaceId).toBe(workspaceId);
      expect(payload.snapshot.shellOptions?.length ?? 0).toBeGreaterThan(0);
      expect(payload.snapshot.shellOptions?.[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          shell: expect.any(String),
          available: expect.any(Boolean)
        })
      );
      break;
    }
  });

  it("workspaceManagement.snapshot 会返回共享管理摘要", async () => {
    const fixture = createGitWorkspaceFixture({ withRemote: true });
    activeGitFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir, "Managed Workspace");

    await hosted.app.listen({
      host: "127.0.0.1",
      port: 0
    });

    const address = hosted.app.server.address();

    if (!address || typeof address === "string") {
      throw new Error("workspaceManagement snapshot 测试服务地址异常");
    }

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`);
    activeClosers.push(() => socket.close());
    const queue = createWsMessageQueue(socket);

    expect(JSON.parse(await queue.next()).type).toBe("system.connected");

    socket.send(
      JSON.stringify({
        type: "workspaceManagement.subscribe",
        workspaceId
      })
    );

    while (true) {
      const payload = JSON.parse(await queue.next()) as {
        type: string;
        snapshot?: {
          workspaceId: string;
          name: string;
          path: string;
          git: {
            isRepository: boolean;
            currentBranch: string | null;
            commitCount: number | null;
            remotes: Array<{ name: string }>;
          };
          codeComposition: {
            scannedFileCount: number;
            items: Array<{ type: string; count: number }>;
          };
        };
      };

      if (payload.type !== "workspaceManagement.snapshot" || !payload.snapshot) {
        continue;
      }

      expect(payload.snapshot).toMatchObject({
        workspaceId,
        name: "Managed Workspace",
        path: fixture.workspaceDir,
        git: {
          isRepository: true,
          currentBranch: "main",
          commitCount: 1
        }
      });
      expect(payload.snapshot.git.remotes).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "origin" })])
      );
      expect(payload.snapshot.codeComposition.scannedFileCount).toBeGreaterThan(0);
      expect(payload.snapshot.codeComposition.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "Markdown", count: 1 })])
      );
      break;
    }
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

async function importWorkspace(
  hosted: ReturnType<typeof createTestApp>,
  accessToken: string,
  workspacePath: string,
  name: string
): Promise<string> {
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
  return response.json().id as string;
}
