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

describe("auth user management", () => {
  it("支持编辑、删除未使用用户，并按用户返回会话使用详情", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "admin1234"
      }
    });

    const login = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "admin1234"
      }
    });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().accessToken as string;
    const headers = {
      authorization: `Bearer ${accessToken}`
    };

    const created = await hosted.app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers,
      payload: {
        username: "alice",
        password: "alice1234"
      }
    });
    expect(created.statusCode).toBe(201);
    const aliceId = created.json().userId as string;

    const aliceLoginAfterCreate = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "alice",
        password: "alice1234"
      }
    });
    expect(aliceLoginAfterCreate.statusCode).toBe(200);
    expect(aliceLoginAfterCreate.json().user).toMatchObject({
      userId: aliceId,
      username: "alice"
    });

    const updated = await hosted.app.inject({
      method: "PATCH",
      url: `/api/admin/users/${aliceId}`,
      headers,
      payload: {
        username: "alice-renamed",
        password: "alice5678"
      }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      userId: aliceId,
      username: "alice-renamed",
      status: "active"
    });


    const aliceLoginAfterUpdate = await hosted.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "alice-renamed",
        password: "alice5678"
      }
    });
    expect(aliceLoginAfterUpdate.statusCode).toBe(200);
    expect(aliceLoginAfterUpdate.json().user).toMatchObject({
      userId: aliceId,
      username: "alice-renamed"
    });

    const temp = await hosted.app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers,
      payload: {
        username: "temp-user",
        password: "temp1234"
      }
    });
    expect(temp.statusCode).toBe(201);
    const tempId = temp.json().userId as string;

    const deleteTemp = await hosted.app.inject({
      method: "DELETE",
      url: `/api/admin/users/${tempId}`,
      headers
    });
    expect(deleteTemp.statusCode).toBe(200);
    expect(deleteTemp.json()).toEqual({
      success: true,
      deletedUserId: tempId
    });

    const timestamp = "2026-06-07T10:00:00.000Z";
    hosted.services.repositories.workspaceRepository.create({
      id: "workspace-alice",
      ownerUserId: aliceId,
      name: "Alice 工作区",
      path: path.join(fixture.workspaceDir, "alice"),
      repoRoot: path.join(fixture.workspaceDir, "alice"),
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null
    });
    hosted.services.repositories.sessionBindingRepository.upsert({
      sessionId: "session-alice",
      userId: aliceId,
      workspaceId: "workspace-alice",
      provider: "codex",
      providerSessionId: "provider-session-alice",
      rawStoreRef: "codex://session-alice",
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    hosted.services.database.db
      .prepare(
        `INSERT INTO butler_control_sessions (
           id,
           user_id,
           provider_id,
           session_id,
           purpose,
           title,
           source_item_id,
           model,
           reasoning_level,
           permission_mode,
           status,
           last_context_version,
           last_summary,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "control-session-alice",
        aliceId,
        "codex",
        "session-alice",
        "chat",
        "Alice 控制会话",
        null,
        "gpt-5",
        null,
        null,
        "idle",
        null,
        null,
        timestamp,
        timestamp
      );

    const usage = await hosted.app.inject({
      method: "GET",
      url: "/api/admin/users/usage?period=day",
      headers
    });
    expect(usage.statusCode).toBe(200);
    const aliceUsage = usage.json().users.find(
      (item: { user: { userId: string } }) => item.user.userId === aliceId
    );
    expect(aliceUsage).toMatchObject({
      sessionCount: 1,
      tokenUsageAvailable: false,
      tokenTotals: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      },
      timeline: [
        {
          bucket: "2026-06-07",
          sessionCount: 1,
          totalTokens: 0
        }
      ],
      modelUsage: [
        {
          label: "gpt-5",
          count: 1
        }
      ],
      cliProviderUsage: [
        {
          label: "codex",
          count: 1
        }
      ]
    });

    const blockedDelete = await hosted.app.inject({
      method: "DELETE",
      url: `/api/admin/users/${aliceId}`,
      headers
    });
    expect(blockedDelete.statusCode).toBe(409);
    expect(blockedDelete.json().error_code).toBe("USER_HAS_DATA");
  });
});
