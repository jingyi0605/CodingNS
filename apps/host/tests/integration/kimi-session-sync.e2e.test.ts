import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: EmptyFixture[] = [];

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();

    if (server) {
      server.app.server.closeAllConnections?.();
      await server.app.close();
    }
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("Kimi 会话发现与历史读取", () => {
  it("可以发现本地 Kimi 会话并绑定原生 session id", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    prepareKimiSessionFixture(fixture);

    const hosted = createTestApp(fixture, {
      databasePath: path.join(fixture.rootDir, "host.sqlite")
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const listed = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(listed.statusCode).toBe(200);
    const kimiSession = listed
      .json()
      .items.find((item: { provider: string }) => item.provider === "kimi");

    expect(kimiSession).toBeDefined();
    expect(kimiSession.providerSessionId).toBe("kimi-session-1");
    expect(kimiSession.rawStoreRef).toBe("kimi://session/kimi-session-1");
    expect(kimiSession.title).toBe("Kimi 样本会话");
    expect(kimiSession.messageCount).toBe(5);
  });

  it("读取历史时会归一化 text/thinking/tool 消息", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    prepareKimiSessionFixture(fixture);

    const hosted = createTestApp(fixture, {
      databasePath: path.join(fixture.rootDir, "host.sqlite")
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);
    const listed = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const kimiSession = listed
      .json()
      .items.find((item: { provider: string }) => item.provider === "kimi");

    expect(kimiSession).toBeDefined();

    const history = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${kimiSession.sessionId}/messages?limit=20`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(history.statusCode).toBe(200);
    const messages = history.json().messages as Array<{ kind: string; rawRef: string }>;
    const kinds = new Set(messages.map((message) => message.kind));

    expect(kinds.has("text")).toBe(true);
    expect(kinds.has("thinking")).toBe(true);
    expect(kinds.has("tool_call")).toBe(true);
    expect(kinds.has("tool_result")).toBe(true);
    expect(messages.every((message) => message.rawRef.startsWith("kimi://session/kimi-session-1/"))).toBe(true);
  });
});

function prepareKimiSessionFixture(fixture: EmptyFixture): void {
  const kimiSessionDir = path.join(
    fixture.kimiHomeDir,
    "sessions",
    "workspace-hash-1",
    "kimi-session-1"
  );

  mkdirSync(kimiSessionDir, { recursive: true });

  writeFileSync(
    path.join(kimiSessionDir, "state.json"),
    JSON.stringify({
      sessionId: "kimi-session-1",
      title: "Kimi 样本会话",
      cwd: fixture.workspaceDir,
      archived: false
    }),
    "utf8"
  );

  writeFileSync(
    path.join(kimiSessionDir, "context.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-04-03T08:00:00.000Z",
        role: "user",
        content: [{ type: "text", text: "请总结今天的任务。" }],
        cwd: fixture.workspaceDir
      }),
      JSON.stringify({
        timestamp: "2026-04-03T08:00:02.000Z",
        role: "assistant",
        content: [{ type: "text", text: "好的，我先整理关键风险。" }],
        cwd: fixture.workspaceDir
      })
    ].join("\n"),
    "utf8"
  );

  writeFileSync(
    path.join(kimiSessionDir, "wire.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-04-03T08:00:03.000Z",
        role: "assistant",
        content: [{ type: "thinking", text: "先检查会话结构和字段。" }]
      }),
      JSON.stringify({
        timestamp: "2026-04-03T08:00:04.000Z",
        role: "assistant",
        content: [
          {
            type: "tool_call",
            id: "call-1",
            name: "read_file",
            input: {
              path: "README.md"
            }
          }
        ]
      }),
      JSON.stringify({
        timestamp: "2026-04-03T08:00:05.000Z",
        role: "tool",
        content: [
          {
            type: "tool_result",
            call_id: "call-1",
            output: "README 内容已读取"
          }
        ]
      })
    ].join("\n"),
    "utf8"
  );
}

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  const loginResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  expect(loginResponse.statusCode).toBe(200);
  return loginResponse.json().accessToken as string;
}

async function importWorkspace(
  hosted: ReturnType<typeof createTestApp>,
  accessToken: string,
  workspacePath: string
): Promise<string> {
  const imported = await hosted.app.inject({
    method: "POST",
    url: "/api/workspaces/import",
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    payload: {
      path: workspacePath,
      name: "Kimi Fixture Workspace"
    }
  });

  expect(imported.statusCode).toBe(201);
  return imported.json().id as string;
}
