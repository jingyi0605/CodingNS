import { afterEach, describe, expect, it } from "vitest";

import {
  createProviderFixture,
  createTestApp,
  destroyFixture,
  type ProviderFixture
} from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: ProviderFixture[] = [];

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

describe("session discovery diagnostics", () => {
  it("同一工作区第二次 discovery 会更多复用来源索引，减少正文解析", async () => {
    const fixture = createProviderFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    await bootstrapAndLogin(hosted);

    const user = hosted.services.repositories.authUserRepository.findByUsername("tester");
    expect(user).not.toBeNull();
    const userId = user!.id;
    const timestamp = new Date().toISOString();

    hosted.services.repositories.workspaceRepository.create({
      id: "workspace-1",
      ownerUserId: userId,
      name: "Fixture Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null
    });

    await hosted.services.modules.sessionHistoryService.discoverWorkspaceSessions("workspace-1", userId, {
      force: true
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await hosted.services.modules.sessionHistoryService.discoverWorkspaceSessions("workspace-1", userId, {
      force: true
    });

    const diagnostics = hosted.services.modules.sessionHistoryService.listWorkspaceDiscoveryDiagnostics(
      "workspace-1",
      userId,
      20
    );

    const comparableProviders = ["claude-code", "codex"]
      .map((provider) => ({
        provider,
        entries: diagnostics.filter((entry) => entry.provider === provider).slice(0, 2)
      }))
      .filter((item) => item.entries.length >= 2);

    expect(comparableProviders.length).toBeGreaterThan(0);

    for (const item of comparableProviders) {
      const [latest, previous] = item.entries;

      expect(latest.scannedFiles).toBeGreaterThanOrEqual(latest.parsedFiles);
      expect(latest.parsedFiles).toBeLessThanOrEqual(previous.parsedFiles);
    }

    expect(
      comparableProviders.some(({ entries: [latest] }) => latest.skippedByFingerprint > 0)
    ).toBe(true);
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
