import { describe, expect, it } from "vitest";

import { GitRemoteCredentialService } from "../../src/modules/git/git-remote-credential-service.js";
import { GitRemoteCredentialRepository } from "../../src/storage/repositories/git-remote-credential-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

describe("GitRemoteCredentialService", () => {
  it("保存后可以从 Host 端重新读出 basic 认证", () => {
    const database = createDatabaseClient(":memory:");
    const repository = new GitRemoteCredentialRepository(database.db);
    const service = new GitRemoteCredentialService(repository, "test-secret");
    seedUser(database, "user-1");

    service.save("user-1", "https://example.com/repo.git", {
      mode: "basic",
      username: "jackson",
      password: "secret-password"
    });

    expect(service.load("user-1", "https://example.com/repo.git")).toEqual({
      mode: "basic",
      username: "jackson",
      password: "secret-password"
    });

    const row = repository.findByUserIdAndRemoteUrl("user-1", "https://example.com/repo.git");
    expect(row?.secretCiphertext).not.toContain("secret-password");

    database.close();
  });

  it("凭据损坏时会自动删除，避免后续持续污染远程同步", () => {
    const database = createDatabaseClient(":memory:");
    const repository = new GitRemoteCredentialRepository(database.db);
    const service = new GitRemoteCredentialService(repository, "test-secret");
    seedUser(database, "user-1");

    repository.upsert({
      userId: "user-1",
      remoteUrl: "https://example.com/repo.git",
      authMode: "token",
      usernameCiphertext: "broken",
      secretCiphertext: "broken",
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:00:00.000Z"
    });

    expect(service.load("user-1", "https://example.com/repo.git")).toBeNull();
    expect(repository.findByUserIdAndRemoteUrl("user-1", "https://example.com/repo.git")).toBeNull();

    database.close();
  });
});

function seedUser(database: ReturnType<typeof createDatabaseClient>, userId: string): void {
  database.db
    .prepare(
      `INSERT INTO auth_users (
        id,
        username,
        password_hash,
        role,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      "admin",
      "seeded-password-hash",
      "admin",
      "2026-04-12T00:00:00.000Z",
      "2026-04-12T00:00:00.000Z"
    );
}
