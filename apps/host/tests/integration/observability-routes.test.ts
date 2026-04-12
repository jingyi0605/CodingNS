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

describe("observability routes", () => {
  it("需要登录态，并按会话启停运行时观测", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const unauthorizedBeforeSetup = await hosted.app.inject({
      method: "GET",
      url: "/api/observability/runtime"
    });
    expect(unauthorizedBeforeSetup.statusCode).toBe(403);

    const accessToken = await bootstrapAndLogin(hosted);

    const unauthorizedAfterSetup = await hosted.app.inject({
      method: "POST",
      url: "/api/observability/runtime/session"
    });
    expect(unauthorizedAfterSetup.statusCode).toBe(401);

    const openResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/observability/runtime/session",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        ttlMs: 20_000
      }
    });
    expect(openResponse.statusCode).toBe(200);
    const session = openResponse.json() as {
      sessionId: string;
      ttlMs: number;
      expiresAt: string;
    };

    await hosted.app.inject({
      method: "GET",
      url: "/api/providers/claude-code/capabilities",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    const snapshotResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/observability/runtime?sessionId=${session.sessionId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(snapshotResponse.statusCode).toBe(200);
    const snapshot = snapshotResponse.json() as {
      observedAt: string;
      session: {
        sessionId: string;
      };
      eventLoop: {
        enabled: boolean;
      };
      backgroundTasks: {
        totals: {
          enqueue: number;
        };
      };
      recentTaskActivities: Array<{
        taskType: string;
        eventType: string;
      }>;
      schedulers: {
        schedulers: Record<string, {
          tickTotal: number;
        }>;
      };
    };

    expect(snapshot.observedAt).toMatch(/^20/);
    expect(snapshot.session.sessionId).toBe(session.sessionId);
    expect(snapshot.eventLoop.enabled).toBe(true);
    expect(snapshot.backgroundTasks.totals.enqueue).toBeGreaterThanOrEqual(1);
    expect(snapshot.recentTaskActivities.length).toBeGreaterThan(0);
    expect(
      snapshot.recentTaskActivities.some(
        (activity) =>
          activity.taskType === "provider.capability_refresh" ||
          activity.taskType === "workspace.discovery"
      )
    ).toBe(true);
    expect(snapshot.schedulers.schedulers.patrol.tickTotal).toBeGreaterThanOrEqual(1);
    expect(snapshot.schedulers.schedulers.butler_follow_up.tickTotal).toBeGreaterThanOrEqual(1);
    expect(snapshot.schedulers.schedulers.session_summary.tickTotal).toBeGreaterThanOrEqual(1);

    const heartbeatResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/observability/runtime/session/${session.sessionId}/heartbeat`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        ttlMs: 15_000
      }
    });
    expect(heartbeatResponse.statusCode).toBe(200);
    expect(heartbeatResponse.json().sessionId).toBe(session.sessionId);

    const closeResponse = await hosted.app.inject({
      method: "DELETE",
      url: `/api/observability/runtime/session/${session.sessionId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(closeResponse.statusCode).toBe(204);

    const missingSessionResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/observability/runtime?sessionId=${session.sessionId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(missingSessionResponse.statusCode).toBe(404);
    expect(missingSessionResponse.json().error_code).toBe("OBSERVABILITY_SESSION_NOT_FOUND");
  });
});

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "tester",
      password: "password123"
    }
  });

  const loginResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "tester",
      password: "password123"
    }
  });

  return loginResponse.json().accessToken as string;
}
