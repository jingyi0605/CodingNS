import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ButlerAuthService } from "../../src/modules/butler/butler-auth-service.js";
import { hashToken } from "../../src/shared/utils/hash.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("ButlerAuthService", () => {
  it("签发的工作区凭证会使用助手运行时 token 前缀", () => {
    const workspacePath = mkdtempSync(path.join(tmpdir(), "codingns-butler-auth-"));
    tempDirs.push(workspacePath);
    const repository = createAuthTokenRepositoryStub();
    const service = new ButlerAuthService(repository, {
      host: "127.0.0.1",
      port: 3002
    });

    const credential = service.ensureWorkspaceCredential(workspacePath, "user-1");

    expect(credential.accessToken.startsWith("butler_")).toBe(true);
    expect(repository.findByHash(hashToken(credential.accessToken), "access")).toMatchObject({
      userId: "user-1",
      tokenType: "access"
    });
  });

  it("旧的非前缀 Butler 凭证会在下次初始化时自动轮换", () => {
    const workspacePath = mkdtempSync(path.join(tmpdir(), "codingns-butler-auth-"));
    tempDirs.push(workspacePath);
    const repository = createAuthTokenRepositoryStub();
    const legacyToken = "legacy_token_value";
    const credentialPath = path.join(workspacePath, "BUTLER_AUTH.json");

    repository.create({
      id: "token-legacy",
      userId: "user-1",
      tokenType: "access",
      tokenHash: hashToken(legacyToken),
      expiresAt: "2026-12-31T00:00:00.000Z",
      revokedAt: null,
      createdAt: "2026-04-18T00:00:00.000Z"
    });
    writeFileSync(
      credentialPath,
      `${JSON.stringify({
        apiBaseUrl: "http://127.0.0.1:3002",
        accessToken: legacyToken,
        issuedAt: "2026-04-18T00:00:00.000Z",
        expiresAt: "2026-12-31T00:00:00.000Z",
        userId: "user-1"
      }, null, 2)}\n`,
      "utf8"
    );

    const service = new ButlerAuthService(repository, {
      host: "127.0.0.1",
      port: 3002
    });

    const nextCredential = service.ensureWorkspaceCredential(workspacePath, "user-1");
    const persisted = JSON.parse(readFileSync(credentialPath, "utf8")) as {
      accessToken: string;
    };

    expect(nextCredential.accessToken).not.toBe(legacyToken);
    expect(nextCredential.accessToken.startsWith("butler_")).toBe(true);
    expect(persisted.accessToken).toBe(nextCredential.accessToken);
  });
});

function createAuthTokenRepositoryStub(): {
  create: (record: {
    id: string;
    userId: string;
    tokenType: "access" | "refresh";
    tokenHash: string;
    expiresAt: string;
    revokedAt: string | null;
    createdAt: string;
  }) => void;
  findByHash: (tokenHash: string, tokenType?: "access" | "refresh") => {
    id: string;
    userId: string;
    tokenType: "access" | "refresh";
    tokenHash: string;
    expiresAt: string;
    revokedAt: string | null;
    createdAt: string;
  } | null;
} {
  const records = new Map<string, {
    id: string;
    userId: string;
    tokenType: "access" | "refresh";
    tokenHash: string;
    expiresAt: string;
    revokedAt: string | null;
    createdAt: string;
  }>();

  return {
    create(record) {
      records.set(`${record.tokenType}:${record.tokenHash}`, record);
    },
    findByHash(tokenHash, tokenType) {
      if (tokenType) {
        return records.get(`${tokenType}:${tokenHash}`) ?? null;
      }

      for (const record of records.values()) {
        if (record.tokenHash === tokenHash) {
          return record;
        }
      }

      return null;
    }
  };
}
