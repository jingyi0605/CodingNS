import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

type TerminalEvent =
  | { type: "system.connected" }
  | { type: "terminal.subscribed"; terminalId: string }
  | { type: "terminal.resize.accepted"; terminalId: string; cols: number; rows: number }
  | {
      type: "terminal.backfill";
      terminalId: string;
      truncated: boolean;
      latestCursor: string | null;
      chunks: Array<{ cursor: string; content: string }>;
    }
  | {
      type: "terminal.output";
      terminalId: string;
      chunk: { cursor: string; content: string };
    }
  | { type: "terminal.status"; terminal: { id: string; status: string; statusDetail?: string | null } }
  | { type: "terminal.error"; terminalId: string; error_code: string; detail: string };

const activeClosers: Array<() => Promise<void> | void> = [];
const activeFixtures: EmptyFixture[] = [];

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

describe("spec006 终端核心能力", () => {
  it("打通受保护终端、多终端、缓存补回和命令模板主链路", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture, {
      accessTokenTtlSeconds: 30,
      refreshTokenTtlSeconds: 60
    });
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

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
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().accessToken as string;

    const anonymousTerminals = await hosted.app.inject({
      method: "GET",
      url: "/api/terminals?workspaceId=missing"
    });
    expect(anonymousTerminals.statusCode).toBe(401);
    expect(anonymousTerminals.json().error_code).toBe("UNAUTHORIZED");

    const imported = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Terminal Fixture Workspace"
      }
    });
    expect(imported.statusCode).toBe(201);
    const workspaceId = imported.json().id as string;

    const firstTerminalResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/terminals",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        name: "主终端"
      }
    });
    expect(firstTerminalResponse.statusCode).toBe(201);
    expect(firstTerminalResponse.json().status).toBe("running");
    expect(firstTerminalResponse.json().processId).toEqual(expect.any(Number));
    const firstTerminalId = firstTerminalResponse.json().id as string;

    const secondTerminalResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/terminals",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        name: "辅助终端"
      }
    });
    expect(secondTerminalResponse.statusCode).toBe(201);
    expect(secondTerminalResponse.json().processId).toEqual(expect.any(Number));
    const secondTerminalId = secondTerminalResponse.json().id as string;

    const terminalList = await hosted.app.inject({
      method: "GET",
      url: `/api/terminals?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(terminalList.statusCode).toBe(200);
    expect(terminalList.json().items).toHaveLength(2);

    await hosted.app.listen({
      host: "127.0.0.1",
      port: 0
    });

    const address = hosted.app.server.address();

    if (!address || typeof address === "string") {
      throw new Error("测试服务地址异常");
    }

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`);
    activeClosers.push(() => socket.close());
    const queue = createWsMessageQueue(socket);

    expect((await queue.next()).type).toBe("system.connected");

    socket.send(JSON.stringify({ type: "terminal.subscribe", terminalId: firstTerminalId }));
    socket.send(JSON.stringify({ type: "terminal.subscribe", terminalId: secondTerminalId }));

    await waitForTerminalSubscription(queue, firstTerminalId);
    await waitForTerminalSubscription(queue, secondTerminalId);

    socket.send(
      JSON.stringify({
        type: "terminal.resize",
        terminalId: firstTerminalId,
        cols: 100,
        rows: 28
      })
    );
    await waitForTerminalResizeAccepted(queue, firstTerminalId, 100, 28);

    await hosted.app.inject({
      method: "POST",
      url: `/api/terminals/${firstTerminalId}/input`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        content: "echo spec006-live\r"
      }
    });

    await hosted.app.inject({
      method: "POST",
      url: `/api/terminals/${secondTerminalId}/input`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        content: "echo spec006-second\r"
      }
    });

    const liveEvent = await waitForTerminalText(queue, firstTerminalId, "spec006-live");
    const secondEvent = await waitForTerminalText(queue, secondTerminalId, "spec006-second");

    expect(liveEvent.terminalId).toBe(firstTerminalId);
    expect(secondEvent.terminalId).toBe(secondTerminalId);

    socket.close();

    await hosted.app.inject({
      method: "POST",
      url: `/api/terminals/${firstTerminalId}/input`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        content: "echo spec006-reconnect\r"
      }
    });

    const reconnectSocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`
    );
    activeClosers.push(() => reconnectSocket.close());
    const reconnectQueue = createWsMessageQueue(reconnectSocket);

    expect((await reconnectQueue.next()).type).toBe("system.connected");

    reconnectSocket.send(
      JSON.stringify({
        type: "terminal.subscribe",
        terminalId: firstTerminalId,
        lastCursor: liveEvent.chunk.cursor
      })
    );

    await waitForTerminalTextAny(reconnectQueue, firstTerminalId, "spec006-reconnect");

    reconnectSocket.send(
      JSON.stringify({
        type: "terminal.subscribe",
        terminalId: firstTerminalId,
        lastCursor: "999999"
      })
    );

    const reconnectError = await waitForTerminalError(
      reconnectQueue,
      firstTerminalId,
      "RECONNECT_CURSOR_INVALID"
    );
    expect(reconnectError.error_code).toBe("RECONNECT_CURSOR_INVALID");

    const invalidTemplate = await hosted.app.inject({
      method: "POST",
      url: "/api/terminals/templates",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        name: "非法模板",
        cwd: `${fixture.rootDir}\\outside`,
        command: "echo",
        args: ["bad"]
      }
    });
    expect(invalidTemplate.statusCode).toBe(400);
    expect(invalidTemplate.json().error_code).toBe("COMMAND_TEMPLATE_INVALID");

    const templateResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/terminals/templates",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        name: "打印模板",
        cwd: fixture.workspaceDir,
        command: "echo",
        args: ["spec006-template"],
        env: {
          SPEC006_FLAG: "1"
        }
      }
    });
    expect(templateResponse.statusCode).toBe(201);
    const templateId = templateResponse.json().id as string;

    const templateList = await hosted.app.inject({
      method: "GET",
      url: `/api/terminals/templates?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(templateList.statusCode).toBe(200);
    expect(templateList.json().items).toHaveLength(1);

    const runTemplateResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/terminals/templates/${templateId}/run`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {}
    });
    expect(runTemplateResponse.statusCode).toBe(200);
    expect(runTemplateResponse.json().createdTerminal).toBe(true);
    const templateTerminalId = runTemplateResponse.json().terminalId as string;

    reconnectSocket.send(
      JSON.stringify({
        type: "terminal.subscribe",
        terminalId: templateTerminalId
      })
    );

    await waitForTerminalSubscription(reconnectQueue, templateTerminalId);
    await waitForTerminalTextAny(reconnectQueue, templateTerminalId, "spec006-template");

    const closeResponse = await hosted.app.inject({
      method: "DELETE",
      url: `/api/terminals/${firstTerminalId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(closeResponse.statusCode).toBe(200);
    expect(closeResponse.json()).toEqual({ success: true });
  }, 20000);

  it("在 Windows 下提供明确 shell 选项，并支持模板在可用 shell 中执行", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture, {
      accessTokenTtlSeconds: 30,
      refreshTokenTtlSeconds: 60
    });
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

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
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().accessToken as string;

    const imported = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Windows Shell Workspace"
      }
    });
    expect(imported.statusCode).toBe(201);
    const workspaceId = imported.json().id as string;

    const anonymousShells = await hosted.app.inject({
      method: "GET",
      url: "/api/terminals/shells"
    });
    expect(anonymousShells.statusCode).toBe(401);

    const shellOptionsResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/terminals/shells",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(shellOptionsResponse.statusCode).toBe(200);
    const shellOptions = shellOptionsResponse.json().items as Array<{
      id: string;
      label: string;
      shell: string;
      available: boolean;
      unavailableReason: string | null;
    }>;

    const cmdShell = mustFindShell(shellOptions, "cmd");
    const powerShell = mustFindShell(shellOptions, "powershell");
    const gitBash = mustFindShell(shellOptions, "git-bash");

    expect(cmdShell.available).toBe(true);
    expect(powerShell.available).toBe(true);

    const cmdTerminalId = await createTerminalWithShell(
      hosted.app,
      accessToken,
      workspaceId,
      "cmd-shell-terminal",
      cmdShell.shell
    );
    const powerShellTerminalId = await createTerminalWithShell(
      hosted.app,
      accessToken,
      workspaceId,
      "powershell-terminal",
      powerShell.shell
    );

    let gitBashTerminalId: string | null = null;

    if (gitBash.available) {
      gitBashTerminalId = await createTerminalWithShell(
        hosted.app,
        accessToken,
        workspaceId,
        "git-bash-terminal",
        gitBash.shell
      );
    } else {
      const invalidGitBash = await hosted.app.inject({
        method: "POST",
        url: "/api/terminals",
        headers: {
          authorization: `Bearer ${accessToken}`
        },
        payload: {
          workspaceId,
          name: "git-bash-terminal",
          shell: gitBash.shell
        }
      });
      expect(invalidGitBash.statusCode).toBe(400);
      expect(invalidGitBash.json().error_code).toBe("INVALID_SHELL");
      expect(gitBash.unavailableReason).toBeTruthy();
    }

    const templateResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/terminals/templates",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        name: "windows-shell-template",
        cwd: fixture.workspaceDir,
        command: "echo",
        args: ["spec006-shell-template"]
      }
    });
    expect(templateResponse.statusCode).toBe(201);
    const templateId = templateResponse.json().id as string;

    await hosted.app.listen({
      host: "127.0.0.1",
      port: 0
    });

    const address = hosted.app.server.address();

    if (!address || typeof address === "string") {
      throw new Error("Windows shell 测试服务地址异常");
    }

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?access_token=${accessToken}`);
    activeClosers.push(() => socket.close());
    const queue = createWsMessageQueue(socket);

    expect((await queue.next()).type).toBe("system.connected");

    const terminalIds = [cmdTerminalId, powerShellTerminalId, gitBashTerminalId].filter(Boolean) as string[];

    for (const terminalId of terminalIds) {
      socket.send(JSON.stringify({ type: "terminal.subscribe", terminalId }));
      await waitForTerminalSubscription(queue, terminalId);

      const runTemplateResponse = await hosted.app.inject({
        method: "POST",
        url: `/api/terminals/templates/${templateId}/run`,
        headers: {
          authorization: `Bearer ${accessToken}`
        },
        payload: {
          terminalId
        }
      });
      expect(runTemplateResponse.statusCode).toBe(200);
      expect(runTemplateResponse.json().createdTerminal).toBe(false);
      await waitForTerminalTextAny(queue, terminalId, "spec006-shell-template");
    }

    const createTemplateTerminalResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/terminals/templates/${templateId}/run`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        shell: powerShell.shell
      }
    });
    expect(createTemplateTerminalResponse.statusCode).toBe(200);
    expect(createTemplateTerminalResponse.json().createdTerminal).toBe(true);

    const createdTerminalId = createTemplateTerminalResponse.json().terminalId as string;
    const listed = await hosted.app.inject({
      method: "GET",
      url: `/api/terminals?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(listed.statusCode).toBe(200);
    const createdTerminal = listed
      .json()
      .items.find((item: { id: string }) => item.id === createdTerminalId);
    expect(createdTerminal?.shell).toBe(powerShell.shell);
  }, 20000);

  it("终端在后台常驻，并在绑定进程退出后标记为 error", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture, {
      accessTokenTtlSeconds: 30,
      refreshTokenTtlSeconds: 60,
      terminalIdleTimeoutSeconds: 1
    });
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

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
    const accessToken = login.json().accessToken as string;

    const imported = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Idle Cleanup Workspace"
      }
    });
    const workspaceId = imported.json().id as string;

    const created = await hosted.app.inject({
      method: "POST",
      url: "/api/terminals",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        name: "待清理终端"
      }
    });
    expect(created.statusCode).toBe(201);
    const terminalId = created.json().id as string;
    expect(created.json().processId).toEqual(expect.any(Number));

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const stillRunning = await waitForTerminalStatus(
      hosted,
      workspaceId,
      accessToken,
      terminalId,
      "running"
    );
    expect(stillRunning.id).toBe(terminalId);
    expect(stillRunning.processId).toEqual(expect.any(Number));

    const exitResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/terminals/${terminalId}/input`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        content: "exit 7\r"
      }
    });
    expect(exitResponse.statusCode).toBe(200);

    const erroredTerminal = await waitForTerminalStatus(
      hosted,
      workspaceId,
      accessToken,
      terminalId,
      "error"
    );
    expect(erroredTerminal.id).toBe(terminalId);
    expect(erroredTerminal.status).toBe("error");
    expect(erroredTerminal.processId).toEqual(expect.any(Number));
    expect(String(erroredTerminal.statusDetail)).toContain("exitCode=7");
  }, 10000);
});

async function createTerminalWithShell(
  app: ReturnType<typeof createTestApp>["app"],
  accessToken: string,
  workspaceId: string,
  name: string,
  shell: string
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/terminals",
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    payload: {
      workspaceId,
      name,
      shell
    }
  });

  expect(response.statusCode).toBe(201);
  expect(response.json().shell).toBe(shell);
  return response.json().id as string;
}

function mustFindShell(
  shellOptions: Array<{
    id: string;
    label: string;
    shell: string;
    available: boolean;
    unavailableReason: string | null;
  }>,
  id: string
) {
  const matched = shellOptions.find((item) => item.id === id);

  expect(matched).toBeTruthy();
  return matched!;
}

function createWsMessageQueue(socket: WebSocket) {
  const pending: TerminalEvent[] = [];
  const waiters: Array<(value: TerminalEvent) => void> = [];

  socket.on("message", (raw) => {
    const payload = JSON.parse(raw.toString()) as TerminalEvent;
    const waiter = waiters.shift();

    if (waiter) {
      waiter(payload);
      return;
    }

    pending.push(payload);
  });

  return {
    async next(timeoutMs = 8000): Promise<TerminalEvent> {
      if (pending.length > 0) {
        return pending.shift()!;
      }

      return await new Promise<TerminalEvent>((resolve, reject) => {
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

async function waitForTerminalSubscription(
  queue: ReturnType<typeof createWsMessageQueue>,
  terminalId: string
): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    const event = await queue.next();

    if (event.type === "terminal.subscribed" && event.terminalId === terminalId) {
      return;
    }
  }

  throw new Error(`没有收到终端订阅确认: ${terminalId}`);
}

async function waitForTerminalText(
  queue: ReturnType<typeof createWsMessageQueue>,
  terminalId: string,
  text: string
): Promise<Extract<TerminalEvent, { type: "terminal.output" }>> {
  for (let index = 0; index < 20; index += 1) {
    const event = await queue.next();

    if (
      event.type === "terminal.output" &&
      event.terminalId === terminalId &&
      event.chunk.content.includes(text)
    ) {
      return event;
    }
  }

  throw new Error(`没有等到终端输出: ${terminalId} ${text}`);
}

async function waitForTerminalBackfill(
  queue: ReturnType<typeof createWsMessageQueue>,
  terminalId: string,
  text: string
): Promise<Extract<TerminalEvent, { type: "terminal.backfill" }>> {
  for (let index = 0; index < 20; index += 1) {
    const event = await queue.next();

    if (
      event.type === "terminal.backfill" &&
      event.terminalId === terminalId &&
      event.chunks.some((chunk) => chunk.content.includes(text))
    ) {
      return event;
    }
  }

  throw new Error(`没有等到终端补回输出: ${terminalId} ${text}`);
}

async function waitForTerminalError(
  queue: ReturnType<typeof createWsMessageQueue>,
  terminalId: string,
  errorCode: string
): Promise<Extract<TerminalEvent, { type: "terminal.error" }>> {
  for (let index = 0; index < 12; index += 1) {
    const event = await queue.next();

    if (
      event.type === "terminal.error" &&
      event.terminalId === terminalId &&
      event.error_code === errorCode
    ) {
      return event;
    }
  }

  throw new Error(`没有等到终端错误事件: ${terminalId} ${errorCode}`);
}

async function waitForTerminalResizeAccepted(
  queue: ReturnType<typeof createWsMessageQueue>,
  terminalId: string,
  cols: number,
  rows: number
): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    const event = await queue.next();

    if (
      event.type === "terminal.resize.accepted" &&
      event.terminalId === terminalId &&
      event.cols === cols &&
      event.rows === rows
    ) {
      return;
    }
  }

  throw new Error(`没有等到终端尺寸调整确认: ${terminalId} ${cols}x${rows}`);
}

async function waitForTerminalTextAny(
  queue: ReturnType<typeof createWsMessageQueue>,
  terminalId: string,
  text: string
): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    const event = await queue.next();

    if (
      event.type === "terminal.output" &&
      event.terminalId === terminalId &&
      event.chunk.content.includes(text)
    ) {
      return;
    }

    if (
      event.type === "terminal.backfill" &&
      event.terminalId === terminalId &&
      event.chunks.some((chunk) => chunk.content.includes(text))
    ) {
      return;
    }
  }

  throw new Error(`没有等到终端输出或补回: ${terminalId} ${text}`);
}

async function waitForTerminalStatus(
  hosted: ReturnType<typeof createTestApp>,
  workspaceId: string,
  accessToken: string,
  terminalId: string,
  expectedStatus: string
) {
  for (let index = 0; index < 20; index += 1) {
    const listed = await hosted.app.inject({
      method: "GET",
      url: `/api/terminals?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(listed.statusCode).toBe(200);
    const terminal = listed.json().items.find((item: { id: string }) => item.id === terminalId);

    if (terminal?.status === expectedStatus) {
      return terminal;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`一直没有等到终端状态更新: ${terminalId} -> ${expectedStatus}`);
}
