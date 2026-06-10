import { afterEach, describe, expect, it } from "vitest";

import { SessionSourceIndexRepository } from "../../src/storage/repositories/session-source-index-repository.js";
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

describe("session source index repair routes", () => {
  it("可以按 provider 显式重建来源索引", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const user = hosted.services.repositories.authUserRepository.findByUsername("tester");
    expect(user).not.toBeNull();
    const timestamp = new Date().toISOString();

    hosted.services.repositories.workspaceRepository.create({
      id: "workspace-1",
      ownerUserId: user!.id,
      name: "Repair Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null
    });

    const repository = new SessionSourceIndexRepository(hosted.services.database.db);
    repository.upsert({
      sourceKey: "codex:raw:/tmp/codex/a.jsonl",
      provider: "codex",
      sourceKind: "jsonl",
      workspaceId: "workspace-1",
      providerSessionId: "codex-a",
      rawStoreRef: "/tmp/codex/a.jsonl",
      workspacePath: fixture.workspaceDir,
      fingerprintMtimeMs: 1,
      fingerprintSizeBytes: 1,
      fingerprintInode: null,
      fingerprintVersion: null,
      title: "codex-a",
      messageCount: 1,
      lastMessageAt: null,
      isArchivedHint: false,
      lastParsedAt: timestamp,
      lastVerifiedAt: timestamp,
      sampleDueAt: null,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    repository.upsert({
      sourceKey: "claude-code:raw:/tmp/claude/b.jsonl",
      provider: "claude-code",
      sourceKind: "jsonl",
      workspaceId: "workspace-1",
      providerSessionId: "claude-b",
      rawStoreRef: "/tmp/claude/b.jsonl",
      workspacePath: fixture.workspaceDir,
      fingerprintMtimeMs: 1,
      fingerprintSizeBytes: 1,
      fingerprintInode: null,
      fingerprintVersion: null,
      title: "claude-b",
      messageCount: 1,
      lastMessageAt: null,
      isArchivedHint: false,
      lastParsedAt: timestamp,
      lastVerifiedAt: timestamp,
      sampleDueAt: null,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const response = await hosted.app.inject({
      method: "POST",
      url: "/api/sessions/source-index/rebuild",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId: "workspace-1",
        provider: "codex",
        awaitDiscovery: true
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workspaceId: "workspace-1",
      provider: "codex",
      clearedSourceCount: 1,
      awaitDiscovery: true
    });
    expect(repository.listByWorkspaceId("workspace-1").map((item) => item.provider)).toEqual(["claude-code"]);
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
