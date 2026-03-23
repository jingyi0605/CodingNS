export interface BootstrapState {
  id: "default";
  initialized: boolean;
  initializedAt: string | null;
  initializedByUserId: string | null;
}

export interface AuthUser {
  id: string;
  username: string;
  passwordHash: string;
  role: "admin";
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokenRecord {
  id: string;
  userId: string;
  tokenType: "access" | "refresh";
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  repoRoot: string | null;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionIndex {
  id: string;
  workspaceId: string;
  provider: string;
  providerSessionId: string;
  title: string | null;
  status: string;
  lastMessageAt: string | null;
  rawRef: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionState {
  sessionId: string;
  syncCursor: string | null;
  lastSyncAt: string | null;
  syncErrorCode: string | null;
  syncErrorMessage: string | null;
  updatedAt: string;
}

export interface ProviderMessage {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  rawRef: string;
}

export interface ProviderMessagePage {
  items: ProviderMessage[];
  nextCursor: string | null;
}
