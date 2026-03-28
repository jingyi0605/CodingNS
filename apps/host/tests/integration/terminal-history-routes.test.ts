import { rmSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const activeFixtures: EmptyFixture[] = [];
const activeClosers: Array<() => Promise<void> | void> = [];

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

type TestHostedApp = ReturnType<typeof createTestApp>;

async function bootstrapHost(hosted: TestHostedApp): Promise<void> {
  const response = await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "password123"
    }
  });

  expect(response.statusCode).toBe(201);
}

async function login(hosted: TestHostedApp): Promise<string> {
  const response = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "password123"
    }
  });

  expect(response.statusCode).toBe(200);
  return response.json().accessToken as string;
}

async function importWorkspace(
  hosted: TestHostedApp,
  accessToken: string,
  workspacePath: string
): Promise<string> {
  const response = await hosted.app.inject({
    method: "POST",
    url: "/api/workspaces/import",
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    payload: {
      path: workspacePath,
      name: "Terminal History Workspace"
    }
  });

  expect(response.statusCode).toBe(201);
  return response.json().id as string;
}

async function createTerminalRecord(
  hosted: TestHostedApp,
  accessToken: string,
  workspaceId: string
): Promise<string> {
  const response = await hosted.app.inject({
    method: "POST",
    url: "/api/terminals",
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    payload: {
      workspaceId,
      name: "历史终端"
    }
  });

  expect(response.statusCode).toBe(201);
  return response.json().id as string;
}

async function writeTerminalContent(
  hosted: TestHostedApp,
  accessToken: string,
  terminalId: string,
  content: string
): Promise<void> {
  const response = await hosted.app.inject({
    method: "POST",
    url: `/api/terminals/${terminalId}/input`,
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    payload: {
      content
    }
  });

  expect(response.statusCode).toBe(200);
}

describe("terminal history routes", () => {
  it("可以读取已落盘的终端历史分段", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture, {
      accessTokenTtlSeconds: 30,
      refreshTokenTtlSeconds: 60
    });
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    await bootstrapHost(hosted);
    const accessToken = await login(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);
    const terminalId = await createTerminalRecord(hosted, accessToken, workspaceId);
    await writeTerminalContent(
      hosted,
      accessToken,
      terminalId,
      "printf 'history-route-1\\nhistory-route-2\\n'\r"
    );

    await delay(1200);

    const historyResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/terminals/${terminalId}/history?limit=5`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(historyResponse.statusCode).toBe(200);
    const payload = historyResponse.json() as {
      terminalId: string;
      content: string;
      lineCount: number;
      anchorLine: number;
      hasMore: boolean;
      nextBeforeSeq: number | null;
    };

    expect(payload.terminalId).toBe(terminalId);
    expect(payload.content).toContain("history-route-1");
    expect(payload.lineCount).toBeGreaterThan(0);
    expect(payload.anchorLine).toBe(payload.lineCount);
    expect(payload.nextBeforeSeq).not.toBeNull();
  });

  it("Host 重启后仍然可以读取已落盘历史", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    let firstHosted: TestHostedApp | null = null;
    let secondHosted: TestHostedApp | null = null;

    try {
      firstHosted = createTestApp(fixture, {
        databasePath,
        accessTokenTtlSeconds: 30,
        refreshTokenTtlSeconds: 60
      });
      await firstHosted.app.ready();

      await bootstrapHost(firstHosted);
      const firstAccessToken = await login(firstHosted);
      const workspaceId = await importWorkspace(firstHosted, firstAccessToken, fixture.workspaceDir);
      const terminalId = await createTerminalRecord(firstHosted, firstAccessToken, workspaceId);
      await writeTerminalContent(
        firstHosted,
        firstAccessToken,
        terminalId,
        "printf 'history-restart-1\\nhistory-restart-2\\n'\r"
      );
      await delay(1200);

      await firstHosted.app.close();
      firstHosted = null;

      secondHosted = createTestApp(fixture, {
        databasePath,
        accessTokenTtlSeconds: 30,
        refreshTokenTtlSeconds: 60
      });
      await secondHosted.app.ready();

      const secondAccessToken = await login(secondHosted);
      const historyResponse = await secondHosted.app.inject({
        method: "GET",
        url: `/api/terminals/${terminalId}/history?limit=5`,
        headers: {
          authorization: `Bearer ${secondAccessToken}`
        }
      });

      expect(historyResponse.statusCode).toBe(200);
      const payload = historyResponse.json() as {
        terminalId: string;
        content: string;
      };

      expect(payload.terminalId).toBe(terminalId);
      expect(payload.content).toContain("history-restart-1");
    } finally {
      await firstHosted?.app.close();
      await secondHosted?.app.close();
    }
  });

  it("日志文件缺失时会返回可排查错误", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    const hosted = createTestApp(fixture, {
      databasePath,
      accessTokenTtlSeconds: 30,
      refreshTokenTtlSeconds: 60
    });
    activeClosers.push(() => hosted.app.close());
    await hosted.app.ready();

    await bootstrapHost(hosted);
    const accessToken = await login(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);
    const terminalId = await createTerminalRecord(hosted, accessToken, workspaceId);
    await writeTerminalContent(
      hosted,
      accessToken,
      terminalId,
      "printf 'history-missing-file\\n'\r"
    );
    await delay(1200);

    rmSync(path.join(fixture.rootDir, "terminal-logs", terminalId, "active.log"), { force: true });

    const historyResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/terminals/${terminalId}/history?limit=5`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(historyResponse.statusCode).toBe(409);
    expect(historyResponse.json().error_code).toBe("TERMINAL_LOG_FILE_MISSING");
  });

  it("日志索引失配时会返回可排查错误", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const databasePath = path.join(fixture.rootDir, "host.sqlite");
    let firstHosted: TestHostedApp | null = null;
    let secondHosted: TestHostedApp | null = null;

    try {
      firstHosted = createTestApp(fixture, {
        databasePath,
        accessTokenTtlSeconds: 30,
        refreshTokenTtlSeconds: 60
      });
      await firstHosted.app.ready();

      await bootstrapHost(firstHosted);
      const firstAccessToken = await login(firstHosted);
      const workspaceId = await importWorkspace(firstHosted, firstAccessToken, fixture.workspaceDir);
      const terminalId = await createTerminalRecord(firstHosted, firstAccessToken, workspaceId);
      await writeTerminalContent(
        firstHosted,
        firstAccessToken,
        terminalId,
        "printf 'history-invalid-index\\n'\r"
      );
      await delay(1200);

      await firstHosted.app.close();
      firstHosted = null;

      secondHosted = createTestApp(fixture, {
        databasePath,
        accessTokenTtlSeconds: 30,
        refreshTokenTtlSeconds: 60
      });
      await secondHosted.app.ready();

      const secondAccessToken = await login(secondHosted);
      secondHosted.services.database.db.exec("PRAGMA foreign_keys = OFF");
      secondHosted.services.database.db
        .prepare("DELETE FROM terminal_log_files WHERE terminal_id = ?")
        .run(terminalId);
      secondHosted.services.database.db.exec("PRAGMA foreign_keys = ON");
      const historyResponse = await secondHosted.app.inject({
        method: "GET",
        url: `/api/terminals/${terminalId}/history?limit=5`,
        headers: {
          authorization: `Bearer ${secondAccessToken}`
        }
      });

      expect(historyResponse.statusCode).toBe(409);
      expect(historyResponse.json().error_code).toBe("TERMINAL_LOG_INDEX_INVALID");
    } finally {
      await firstHosted?.app.close();
      await secondHosted?.app.close();
    }
  });
});
