import fs from "node:fs";
import path from "node:path";

import type { HostConfig } from "../../config/env.js";
import { AuthService } from "../auth/auth-service.js";

const WORKSPACE_SESSION_AUTH_FILENAME = "WORKSPACE_SESSION_AUTH.json";
const WORKSPACE_SESSION_AUTH_ROTATE_THRESHOLD_SECONDS = 24 * 60 * 60;
const WORKSPACE_SESSION_AUTH_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface WorkspaceSessionCredential {
  apiBaseUrl: string;
  accessToken: string;
  issuedAt: string;
  expiresAt: string;
  userId: string;
  workspaceId: string;
  projectId: string | null;
  sessionId: string;
  callerKind: "workspace_session";
  capabilityProfile: "workspace-scoped";
}

export class WorkspaceSessionAuthService {
  constructor(
    private readonly authService: Pick<AuthService, "issueScopedAccessToken" | "authenticateAccessToken">,
    private readonly config: Pick<HostConfig, "host" | "port">
  ) {}

  ensureWorkspaceCredential(input: {
    runtimeHomeDir: string;
    userId: string;
    workspaceId: string;
    projectId?: string | null;
    sessionId: string;
  }): WorkspaceSessionCredential {
    const credentialPath = this.getCredentialFilePath(input.runtimeHomeDir);
    const existing = readWorkspaceSessionCredential(credentialPath);

    if (existing && isWorkspaceSessionCredentialValid(existing, input, this.authService)) {
      return existing;
    }

    const issued = this.authService.issueScopedAccessToken({
      userId: input.userId,
      callerKind: "workspace_session",
      capabilityProfile: "workspace-scoped",
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      sessionId: input.sessionId,
      expiresInSeconds: WORKSPACE_SESSION_AUTH_TTL_SECONDS
    });
    const next: WorkspaceSessionCredential = {
      apiBaseUrl: resolveApiBaseUrl(this.config.host, this.config.port),
      accessToken: issued.accessToken,
      issuedAt: issued.issuedAt,
      expiresAt: issued.expiresAt,
      userId: input.userId,
      workspaceId: input.workspaceId,
      projectId: input.projectId?.trim() || null,
      sessionId: input.sessionId,
      callerKind: "workspace_session",
      capabilityProfile: "workspace-scoped"
    };

    fs.mkdirSync(input.runtimeHomeDir, { recursive: true });
    fs.writeFileSync(credentialPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }

  getCredentialFilePath(runtimeHomeDir: string): string {
    return path.join(runtimeHomeDir, WORKSPACE_SESSION_AUTH_FILENAME);
  }
}

function readWorkspaceSessionCredential(filePath: string): WorkspaceSessionCredential | null {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<WorkspaceSessionCredential>;
    if (
      typeof parsed.apiBaseUrl !== "string"
      || typeof parsed.accessToken !== "string"
      || typeof parsed.issuedAt !== "string"
      || typeof parsed.expiresAt !== "string"
      || typeof parsed.userId !== "string"
      || typeof parsed.workspaceId !== "string"
      || typeof parsed.sessionId !== "string"
      || parsed.callerKind !== "workspace_session"
      || parsed.capabilityProfile !== "workspace-scoped"
    ) {
      return null;
    }

    return {
      apiBaseUrl: parsed.apiBaseUrl,
      accessToken: parsed.accessToken,
      issuedAt: parsed.issuedAt,
      expiresAt: parsed.expiresAt,
      userId: parsed.userId,
      workspaceId: parsed.workspaceId,
      projectId: typeof parsed.projectId === "string" && parsed.projectId.trim().length > 0 ? parsed.projectId : null,
      sessionId: parsed.sessionId,
      callerKind: "workspace_session",
      capabilityProfile: "workspace-scoped"
    };
  } catch {
    return null;
  }
}

function isWorkspaceSessionCredentialValid(
  credential: WorkspaceSessionCredential,
  input: {
    userId: string;
    workspaceId: string;
    projectId?: string | null;
    sessionId: string;
  },
  authService: Pick<AuthService, "authenticateAccessToken">
): boolean {
  if (
    credential.userId !== input.userId
    || credential.workspaceId !== input.workspaceId
    || credential.projectId !== (input.projectId?.trim() || null)
    || credential.sessionId !== input.sessionId
  ) {
    return false;
  }

  const expiresAt = new Date(credential.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt - Date.now() <= WORKSPACE_SESSION_AUTH_ROTATE_THRESHOLD_SECONDS * 1000) {
    return false;
  }

  try {
    const auth = authService.authenticateAccessToken(credential.accessToken);
    return (
      auth.callerKind === "workspace_session"
      && auth.capabilityProfile === "workspace-scoped"
      && auth.workspaceId === input.workspaceId
      && auth.projectId === (input.projectId?.trim() || null)
      && auth.sessionId === input.sessionId
    );
  } catch {
    return false;
  }
}

function resolveApiBaseUrl(host: string, port: number): string {
  const normalizedHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return `http://${normalizedHost}:${port}`;
}
