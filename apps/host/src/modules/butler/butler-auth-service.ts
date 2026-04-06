import fs from "node:fs";
import path from "node:path";

import { createId } from "../../shared/utils/id.js";
import { hashToken } from "../../shared/utils/hash.js";
import { addSeconds, nowIso } from "../../shared/utils/time.js";
import { createOpaqueToken } from "../../shared/utils/tokens.js";
import type { AuthTokenRepository } from "../../storage/repositories/auth-token-repository.js";
import type { HostConfig } from "../../config/env.js";

const BUTLER_AUTH_FILENAME = "BUTLER_AUTH.json";
const BUTLER_AUTH_ROTATE_THRESHOLD_SECONDS = 7 * 24 * 60 * 60;
const BUTLER_AUTH_TTL_SECONDS = 180 * 24 * 60 * 60;

export interface ButlerWorkspaceCredential {
  apiBaseUrl: string;
  accessToken: string;
  issuedAt: string;
  expiresAt: string;
  userId: string;
}

export class ButlerAuthService {
  constructor(
    private readonly authTokenRepository: Pick<AuthTokenRepository, "create" | "findByHash">,
    private readonly config: Pick<HostConfig, "host" | "port">
  ) {}

  ensureWorkspaceCredential(workspacePath: string, userId: string): ButlerWorkspaceCredential {
    const credentialPath = path.join(workspacePath, BUTLER_AUTH_FILENAME);
    const existing = readWorkspaceCredential(credentialPath);

    if (existing && isWorkspaceCredentialValid(existing, userId, this.authTokenRepository)) {
      return existing;
    }

    const next = this.issueWorkspaceCredential(userId);
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.writeFileSync(credentialPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }

  getCredentialFilePath(workspacePath: string): string {
    return path.join(workspacePath, BUTLER_AUTH_FILENAME);
  }

  private issueWorkspaceCredential(userId: string): ButlerWorkspaceCredential {
    const now = new Date();
    const accessToken = createOpaqueToken();
    const issuedAt = nowIso(now);
    const expiresAt = addSeconds(now, BUTLER_AUTH_TTL_SECONDS);

    this.authTokenRepository.create({
      id: createId(),
      userId,
      tokenType: "access",
      tokenHash: hashToken(accessToken),
      expiresAt,
      revokedAt: null,
      createdAt: issuedAt
    });

    return {
      apiBaseUrl: resolveButlerApiBaseUrl(this.config.host, this.config.port),
      accessToken,
      issuedAt,
      expiresAt,
      userId
    };
  }
}

function readWorkspaceCredential(filePath: string): ButlerWorkspaceCredential | null {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<ButlerWorkspaceCredential>;

    if (
      typeof parsed.apiBaseUrl !== "string"
      || typeof parsed.accessToken !== "string"
      || typeof parsed.issuedAt !== "string"
      || typeof parsed.expiresAt !== "string"
      || typeof parsed.userId !== "string"
    ) {
      return null;
    }

    return parsed as ButlerWorkspaceCredential;
  } catch {
    return null;
  }
}

function isWorkspaceCredentialValid(
  credential: ButlerWorkspaceCredential,
  userId: string,
  authTokenRepository: Pick<AuthTokenRepository, "findByHash">
): boolean {
  if (credential.userId !== userId) {
    return false;
  }

  const expiresAt = new Date(credential.expiresAt).getTime();

  if (!Number.isFinite(expiresAt) || expiresAt - Date.now() <= BUTLER_AUTH_ROTATE_THRESHOLD_SECONDS * 1000) {
    return false;
  }

  const record = authTokenRepository.findByHash(hashToken(credential.accessToken), "access");

  if (!record || record.revokedAt || record.userId !== userId) {
    return false;
  }

  return new Date(record.expiresAt).getTime() > Date.now();
}

function resolveButlerApiBaseUrl(host: string, port: number): string {
  const normalizedHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return `http://${normalizedHost}:${port}`;
}
