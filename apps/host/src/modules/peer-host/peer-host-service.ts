import { AppError } from "../../shared/errors/app-error.js";
import { decryptSecret, encryptSecret } from "../../shared/utils/secret-box.js";
import { createId } from "../../shared/utils/id.js";
import type {
  PeerHostRecord,
  PeerHostSessionRecord,
  PeerHostStatus,
  PeerHostWorkspaceBindingRecord,
} from "../../types/domain.js";
import type {
  PeerHostRepository,
  PeerHostSessionRepository,
  PeerHostWorkspaceBindingRepository,
} from "../../storage/repositories/peer-host-repository.js";
import {
  HOST_HANDSHAKE_PRODUCT,
  PEER_HOST_API_COMPATIBILITY,
  type HostHandshakeDto,
} from "./host-handshake.js";
import { readHostPackageVersion } from "../client/client-service.js";

export interface PeerHostCreateInput {
  name?: string;
  alias?: string;
  tagColor?: string | null;
  baseUrl?: string;
}

export interface PeerHostUpdateInput {
  name?: string;
  alias?: string | null;
  tagColor?: string | null;
  baseUrl?: string;
}

export interface PeerHostWorkspaceBindingUpdateInput {
  activeHostId?: string;
  selectedHostId?: string;
  remoteWorkspaceId?: string | null;
  remoteWorkspacePath?: string | null;
  remoteWorkspaceName?: string | null;
}

export interface PeerHostWorkspaceBindingView {
  activeHostId: string;
  workspaceKey: string;
  selectedHostId: string;
  remoteWorkspaceId: string | null;
  remoteWorkspacePath: string | null;
  remoteWorkspaceName: string | null;
  updatedAt: string;
}

export interface PeerHostLoginInput {
  username?: string;
  password?: string;
}

export interface PeerHostSessionView {
  exists: true;
  username: string;
  remoteUserId: string;
  remoteUsername: string;
  expiresAt: string | null;
  savedAt: string;
  updatedAt: string;
}

export class PeerHostService {
  private readonly peerHostWorkspaceBindingRepository:
    | PeerHostWorkspaceBindingRepository
    | null;
  private readonly credentialSecret: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly peerHostRepository: PeerHostRepository,
    private readonly peerHostSessionRepository: PeerHostSessionRepository,
    peerHostWorkspaceBindingRepositoryOrCredentialSecret:
      | PeerHostWorkspaceBindingRepository
      | string,
    credentialSecretOrFetch?: string | typeof fetch,
    fetchImpl: typeof fetch = fetch,
  ) {
    if (typeof peerHostWorkspaceBindingRepositoryOrCredentialSecret === "string") {
      this.peerHostWorkspaceBindingRepository = null;
      this.credentialSecret = peerHostWorkspaceBindingRepositoryOrCredentialSecret;
      this.fetchImpl =
        typeof credentialSecretOrFetch === "function"
          ? credentialSecretOrFetch
          : fetchImpl;
      return;
    }

    this.peerHostWorkspaceBindingRepository =
      peerHostWorkspaceBindingRepositoryOrCredentialSecret;
    this.credentialSecret = normalizeRequiredText(
      credentialSecretOrFetch,
      "credentialSecret",
      "缺少凭据加密密钥",
    );
    this.fetchImpl = fetchImpl;
  }

  list(ownerUserId: string): PeerHostRecord[] {
    return this.peerHostRepository.listByOwner(ownerUserId);
  }

  create(ownerUserId: string, input: PeerHostCreateInput): PeerHostRecord {
    const now = new Date().toISOString();
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const normalizedBaseUrl = baseUrl;
    const name = normalizeName(input.name) ?? new URL(baseUrl).host;
    const alias = normalizeAlias(input.alias);
    const tagColor = normalizeTagColor(input.tagColor);

    this.ensureBaseUrlUnused(ownerUserId, normalizedBaseUrl);

    return this.peerHostRepository.create({
      id: createId(),
      ownerUserId,
      name,
      alias,
      tagColor,
      baseUrl,
      normalizedBaseUrl,
      status: "unknown",
      remoteVersion: null,
      remoteApiCompatibility: null,
      remoteHostFingerprint: null,
      lastCheckedAt: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      createdAt: now,
      updatedAt: now,
      removedAt: null,
    });
  }

  get(ownerUserId: string, peerHostId: string): PeerHostRecord {
    return this.requirePeerHost(ownerUserId, peerHostId);
  }

  update(
    ownerUserId: string,
    peerHostId: string,
    input: PeerHostUpdateInput,
  ): PeerHostRecord {
    const existing = this.requirePeerHost(ownerUserId, peerHostId);
    const baseUrl =
      input.baseUrl === undefined
        ? existing.baseUrl
        : normalizeBaseUrl(input.baseUrl);
    const normalizedBaseUrl = baseUrl;
    const name = normalizeName(input.name) ?? existing.name;
    const alias =
      input.alias === undefined ? existing.alias : normalizeAlias(input.alias);
    const tagColor =
      input.tagColor === undefined ? existing.tagColor : normalizeTagColor(input.tagColor);

    if (normalizedBaseUrl !== existing.normalizedBaseUrl) {
      this.ensureBaseUrlUnused(ownerUserId, normalizedBaseUrl);
    }

    const updated = this.peerHostRepository.updateConfig(
      peerHostId,
      ownerUserId,
      {
        name,
        alias,
        tagColor,
        baseUrl,
        normalizedBaseUrl,
        resetConnectionState: normalizedBaseUrl !== existing.normalizedBaseUrl,
        updatedAt: new Date().toISOString(),
      },
    );

    if (!updated) {
      throwPeerHostNotFound();
    }

    if (normalizedBaseUrl !== existing.normalizedBaseUrl) {
      this.peerHostSessionRepository.delete(peerHostId, ownerUserId);
    }

    return updated;
  }

  listWorkspaceBindings(ownerUserId: string): PeerHostWorkspaceBindingView[] {
    const repository = this.requireWorkspaceBindingRepository();
    return this.peerHostWorkspaceBindingRepository
      ? repository
      .listByOwner(ownerUserId)
      .map(toWorkspaceBindingView)
      : [];
  }

  saveWorkspaceBinding(
    ownerUserId: string,
    workspaceKeyInput: unknown,
    input: PeerHostWorkspaceBindingUpdateInput,
  ): PeerHostWorkspaceBindingView {
    const workspaceKey = normalizeRequiredText(
      workspaceKeyInput,
      "workspaceKey",
      "缺少工作区标识",
    );
    const activeHostId = normalizeRequiredText(
      input.activeHostId,
      "activeHostId",
      "缺少当前 HOST 标识",
    );
    const selectedHostId = normalizeRequiredText(
      input.selectedHostId,
      "selectedHostId",
      "缺少选中的 HOST 标识",
    );

    if (selectedHostId !== "current") {
      this.requirePeerHost(ownerUserId, selectedHostId);
    }

    const remoteWorkspaceId = normalizeOptionalText(input.remoteWorkspaceId);
    const remoteWorkspacePath = normalizeOptionalText(input.remoteWorkspacePath);
    const remoteWorkspaceName = normalizeOptionalText(input.remoteWorkspaceName);

    const now = new Date().toISOString();
    return toWorkspaceBindingView(
      this.requireWorkspaceBindingRepository().upsert({
        ownerUserId,
        activeHostId,
        workspaceKey,
        selectedHostId,
        remoteWorkspaceId: selectedHostId === "current" ? null : remoteWorkspaceId,
        remoteWorkspacePath: selectedHostId === "current" ? null : remoteWorkspacePath,
        remoteWorkspaceName: selectedHostId === "current" ? null : remoteWorkspaceName,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  delete(
    ownerUserId: string,
    peerHostId: string,
  ): { success: true; peerHostId: string } {
    this.requirePeerHost(ownerUserId, peerHostId);
    this.peerHostSessionRepository.delete(peerHostId, ownerUserId);
    this.peerHostRepository.markRemoved(
      peerHostId,
      ownerUserId,
      new Date().toISOString(),
    );
    return { success: true, peerHostId };
  }

  async check(
    ownerUserId: string,
    peerHostId: string,
  ): Promise<PeerHostRecord> {
    const peerHost = this.requirePeerHost(ownerUserId, peerHostId);
    const checkedAt = new Date().toISOString();

    try {
      const handshake = await this.fetchHandshake(peerHost.baseUrl);
      const result = this.resolveCheckStatus(handshake);

      return this.persistCheckResult(peerHostId, ownerUserId, {
        status: result.status,
        remoteVersion: handshake.version,
        remoteApiCompatibility: handshake.apiCompatibility,
        remoteHostFingerprint: handshake.hostFingerprint,
        lastCheckedAt: checkedAt,
        lastErrorCode: result.errorCode,
        lastErrorDetail: result.errorDetail,
        updatedAt: checkedAt,
      });
    } catch (error) {
      return this.persistCheckResult(peerHostId, ownerUserId, {
        status: "unreachable",
        remoteVersion: null,
        remoteApiCompatibility: null,
        remoteHostFingerprint: null,
        lastCheckedAt: checkedAt,
        lastErrorCode: readErrorCode(error, "PEER_HOST_UNREACHABLE"),
        lastErrorDetail: readErrorDetail(error, "目标 HOST 不可达"),
        updatedAt: checkedAt,
      });
    }
  }

  async login(
    ownerUserId: string,
    peerHostId: string,
    input: PeerHostLoginInput,
  ): Promise<PeerHostSessionView> {
    const peerHost = this.ensureProxyReady(ownerUserId, peerHostId);
    const username = normalizeRequiredText(
      input.username,
      "username",
      "缺少目标 HOST 用户名",
    );
    const password = normalizeRequiredText(
      input.password,
      "password",
      "缺少目标 HOST 密码",
    );
    const response = await this.fetchJson(
      `${peerHost.baseUrl}/api/auth/login`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      },
    );
    const payload = response.payload as RemoteAuthResponse;

    if (!response.ok || !isRemoteAuthResponse(payload)) {
      throw new AppError({
        statusCode: response.status === 401 ? 401 : 502,
        errorCode: "PEER_HOST_LOGIN_FAILED",
        detail: "目标 HOST 登录失败",
      });
    }

    const now = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + payload.expiresIn * 1000,
    ).toISOString();
    const record: PeerHostSessionRecord = {
      peerHostId,
      ownerUserId,
      username,
      accessTokenEncrypted: encryptSecret(
        this.credentialSecret,
        payload.accessToken,
      ),
      refreshTokenEncrypted: encryptSecret(
        this.credentialSecret,
        payload.refreshToken,
      ),
      expiresAt,
      remoteUserId: payload.user.userId,
      remoteUsername: payload.user.username,
      remoteHostFingerprint: peerHost.remoteHostFingerprint,
      savedAt: now,
      updatedAt: now,
    };

    this.peerHostSessionRepository.upsert(record);
    return toSessionView(record);
  }

  async reconnect(
    ownerUserId: string,
    peerHostId: string,
  ): Promise<PeerHostRecord> {
    const checked = await this.check(ownerUserId, peerHostId);

    if (checked.status !== "reachable") {
      return checked;
    }

    try {
      await this.getAccessTokenForProxy(ownerUserId, checked);
      return this.persistCheckResult(peerHostId, ownerUserId, {
        status: "reachable",
        remoteVersion: checked.remoteVersion,
        remoteApiCompatibility: checked.remoteApiCompatibility,
        remoteHostFingerprint: checked.remoteHostFingerprint,
        lastCheckedAt: new Date().toISOString(),
        lastErrorCode: null,
        lastErrorDetail: null,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      return this.persistCheckResult(peerHostId, ownerUserId, {
        status: resolveReconnectFailureStatus(error),
        remoteVersion: checked.remoteVersion,
        remoteApiCompatibility: checked.remoteApiCompatibility,
        remoteHostFingerprint: checked.remoteHostFingerprint,
        lastCheckedAt: new Date().toISOString(),
        lastErrorCode: readErrorCode(error, "PEER_HOST_RECONNECT_FAILED"),
        lastErrorDetail: readErrorDetail(error, "目标 HOST 重连失败"),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  deleteSession(
    ownerUserId: string,
    peerHostId: string,
  ): { success: true; peerHostId: string } {
    this.requirePeerHost(ownerUserId, peerHostId);
    this.peerHostSessionRepository.delete(peerHostId, ownerUserId);
    return { success: true, peerHostId };
  }

  ensureProxyReady(ownerUserId: string, peerHostId: string): PeerHostRecord {
    const peerHost = this.requirePeerHost(ownerUserId, peerHostId);

    if (peerHost.status !== "reachable") {
      throw new AppError({
        statusCode: 409,
        errorCode:
          peerHost.status === "version_mismatch"
            ? "PEER_HOST_VERSION_MISMATCH"
            : "PEER_HOST_UNREACHABLE",
        detail: "目标 HOST 未检查通过，不能代理访问",
        data: {
          peerHostId,
          status: peerHost.status,
        },
      });
    }

    if (
      peerHost.remoteVersion !== readHostPackageVersion() ||
      peerHost.remoteApiCompatibility !== PEER_HOST_API_COMPATIBILITY
    ) {
      throw new AppError({
        statusCode: 409,
        errorCode: "PEER_HOST_VERSION_MISMATCH",
        detail: "目标 HOST 版本或 API 兼容标识不一致",
        data: {
          peerHostId,
          remoteVersion: peerHost.remoteVersion,
          remoteApiCompatibility: peerHost.remoteApiCompatibility,
        },
      });
    }

    return peerHost;
  }

  async getAccessTokenForProxy(
    ownerUserId: string,
    peerHost: PeerHostRecord,
  ): Promise<string> {
    const session = this.peerHostSessionRepository.find(
      peerHost.id,
      ownerUserId,
    );

    if (!session) {
      throw new AppError({
        statusCode: 409,
        errorCode: "PEER_HOST_SESSION_REQUIRED",
        detail: "目标 HOST 还没有登录态，请先登录该 HOST",
        data: { peerHostId: peerHost.id },
      });
    }

    if (session.remoteHostFingerprint !== peerHost.remoteHostFingerprint) {
      this.peerHostSessionRepository.delete(peerHost.id, ownerUserId);
      throw new AppError({
        statusCode: 409,
        errorCode: "PEER_HOST_IDENTITY_CHANGED",
        detail: "目标 HOST 身份已变化，请重新登录",
        data: { peerHostId: peerHost.id },
      });
    }

    if (shouldRefreshPeerHostSession(session)) {
      return await this.refreshPeerHostSession(peerHost, session);
    }

    return decryptSecret(this.credentialSecret, session.accessTokenEncrypted);
  }

  clearSession(ownerUserId: string, peerHostId: string): void {
    this.peerHostSessionRepository.delete(peerHostId, ownerUserId);
  }

  private async fetchHandshake(baseUrl: string): Promise<HostHandshakeDto> {
    const response = await this.fetchJson(
      `${baseUrl}/api/public/host-handshake`,
      {
        method: "GET",
      },
    );

    if (!response.ok || !isHostHandshakeDto(response.payload)) {
      throw new AppError({
        statusCode: 502,
        errorCode: "PEER_HOST_HANDSHAKE_INVALID",
        detail: "目标地址不是可识别的 CodingNS HOST",
      });
    }

    return response.payload;
  }

  private resolveCheckStatus(handshake: HostHandshakeDto): {
    status: PeerHostStatus;
    errorCode: string | null;
    errorDetail: string | null;
  } {
    if (handshake.product !== HOST_HANDSHAKE_PRODUCT) {
      return {
        status: "unreachable",
        errorCode: "PEER_HOST_PRODUCT_MISMATCH",
        errorDetail: "目标地址不是 CodingNS HOST",
      };
    }

    if (
      handshake.version !== readHostPackageVersion() ||
      handshake.apiCompatibility !== PEER_HOST_API_COMPATIBILITY
    ) {
      return {
        status: "version_mismatch",
        errorCode: "PEER_HOST_VERSION_MISMATCH",
        errorDetail: "目标 HOST 版本或 API 兼容标识不一致",
      };
    }

    return {
      status: "reachable",
      errorCode: null,
      errorDetail: null,
    };
  }

  private persistCheckResult(
    peerHostId: string,
    ownerUserId: string,
    input: Parameters<PeerHostRepository["updateCheckResult"]>[2],
  ): PeerHostRecord {
    const updated = this.peerHostRepository.updateCheckResult(
      peerHostId,
      ownerUserId,
      input,
    );

    if (!updated) {
      throwPeerHostNotFound();
    }

    return updated;
  }

  private async fetchJson(
    url: string,
    init: RequestInit,
  ): Promise<{ ok: boolean; status: number; payload: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);

    try {
      const response = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      return {
        ok: response.ok,
        status: response.status,
        payload,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async refreshPeerHostSession(
    peerHost: PeerHostRecord,
    session: PeerHostSessionRecord,
  ): Promise<string> {
    const refreshToken = decryptSecret(
      this.credentialSecret,
      session.refreshTokenEncrypted,
    );
    const response = await this.fetchJson(`${peerHost.baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ refreshToken }),
    });
    const payload = response.payload as RemoteAuthResponse;

    if (!response.ok || !isRemoteAuthResponse(payload)) {
      this.peerHostSessionRepository.delete(
        session.peerHostId,
        session.ownerUserId,
      );
      throw new AppError({
        statusCode: 409,
        errorCode: "PEER_HOST_SESSION_INVALID",
        detail: "目标 HOST 登录态已经失效，请重新登录该 HOST",
        data: { peerHostId: session.peerHostId },
      });
    }

    const now = new Date().toISOString();
    const refreshed: PeerHostSessionRecord = {
      ...session,
      accessTokenEncrypted: encryptSecret(
        this.credentialSecret,
        payload.accessToken,
      ),
      refreshTokenEncrypted: encryptSecret(
        this.credentialSecret,
        payload.refreshToken,
      ),
      expiresAt: new Date(Date.now() + payload.expiresIn * 1000).toISOString(),
      remoteUserId: payload.user.userId,
      remoteUsername: payload.user.username,
      remoteHostFingerprint: peerHost.remoteHostFingerprint,
      updatedAt: now,
    };

    this.peerHostSessionRepository.upsert(refreshed);
    return payload.accessToken;
  }

  private requirePeerHost(
    ownerUserId: string,
    peerHostId: string,
  ): PeerHostRecord {
    const peerHost = this.peerHostRepository.findByIdForOwner(
      peerHostId,
      ownerUserId,
    );

    if (!peerHost) {
      throwPeerHostNotFound();
    }

    return peerHost;
  }

  private ensureBaseUrlUnused(
    ownerUserId: string,
    normalizedBaseUrl: string,
  ): void {
    const existing = this.peerHostRepository.findByNormalizedBaseUrlForOwner(
      normalizedBaseUrl,
      ownerUserId,
    );

    if (existing) {
      throw new AppError({
        statusCode: 409,
        errorCode: "PEER_HOST_BASE_URL_EXISTS",
        detail: "这个 HOST 地址已经保存过了",
        field: "baseUrl",
      });
    }
  }

  private requireWorkspaceBindingRepository(): PeerHostWorkspaceBindingRepository {
    if (!this.peerHostWorkspaceBindingRepository) {
      throw new AppError({
        statusCode: 500,
        errorCode: "PEER_HOST_WORKSPACE_BINDING_REPOSITORY_MISSING",
        detail: "Peer HOST 工作区绑定存储未初始化",
      });
    }

    return this.peerHostWorkspaceBindingRepository;
  }
}

export function normalizeBaseUrl(value: unknown): string {
  const raw = normalizeRequiredText(value, "baseUrl", "缺少目标 HOST 地址");

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AppError({
      statusCode: 400,
      errorCode: "PEER_HOST_BASE_URL_INVALID",
      detail: "目标 HOST 地址格式无效",
      field: "baseUrl",
    });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError({
      statusCode: 400,
      errorCode: "PEER_HOST_BASE_URL_INVALID",
      detail: "目标 HOST 地址只支持 http 或 https",
      field: "baseUrl",
    });
  }

  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/+$/, "");
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeAlias(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new AppError({
      statusCode: 400,
      errorCode: "PEER_HOST_ALIAS_INVALID",
      detail: "HOST 简写必须是最多 4 个英文字母",
      field: "alias",
    });
  }

  const normalized = value.trim().toUpperCase();
  if (normalized.length === 0) {
    return null;
  }

  if (!/^[A-Z]{1,4}$/.test(normalized)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PEER_HOST_ALIAS_INVALID",
      detail: "HOST 简写必须是最多 4 个英文字母",
      field: "alias",
    });
  }

  return normalized;
}

function normalizeTagColor(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "标签颜色必须是字符串",
      field: "tagColor",
    });
  }

  const normalizedColor = value.trim().toUpperCase();

  if (!normalizedColor) {
    return null;
  }

  if (!/^#[0-9A-F]{6}$/.test(normalizedColor)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "标签颜色必须是 #RRGGBB 格式",
      field: "tagColor",
    });
  }

  return normalizedColor;
}

function toWorkspaceBindingView(
  record: PeerHostWorkspaceBindingRecord,
): PeerHostWorkspaceBindingView {
  return {
    activeHostId: record.activeHostId,
    workspaceKey: record.workspaceKey,
    selectedHostId: record.selectedHostId,
    remoteWorkspaceId: record.remoteWorkspaceId,
    remoteWorkspacePath: record.remoteWorkspacePath,
    remoteWorkspaceName: record.remoteWorkspaceName,
    updatedAt: record.updatedAt,
  };
}

function normalizeOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeRequiredText(
  value: unknown,
  field: string,
  detail: string,
): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail,
    field,
  });
}

function throwPeerHostNotFound(): never {
  throw new AppError({
    statusCode: 404,
    errorCode: "PEER_HOST_NOT_FOUND",
    detail: "未找到目标 Peer HOST",
  });
}

function isHostHandshakeDto(value: unknown): value is HostHandshakeDto {
  const candidate = value as Partial<HostHandshakeDto> | null;
  return (
    Boolean(candidate) &&
    candidate?.product === HOST_HANDSHAKE_PRODUCT &&
    typeof candidate.version === "string" &&
    typeof candidate.apiCompatibility === "string" &&
    (typeof candidate.hostFingerprint === "string" ||
      candidate.hostFingerprint === null) &&
    typeof candidate.time === "string"
  );
}

interface RemoteAuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    userId: string;
    username: string;
    role: "admin";
  };
}

function isRemoteAuthResponse(value: unknown): value is RemoteAuthResponse {
  const candidate = value as Partial<RemoteAuthResponse> | null;
  const user = candidate?.user as
    | Partial<RemoteAuthResponse["user"]>
    | undefined;
  return (
    Boolean(candidate) &&
    typeof candidate?.accessToken === "string" &&
    typeof candidate.refreshToken === "string" &&
    typeof candidate.expiresIn === "number" &&
    Boolean(user) &&
    typeof user?.userId === "string" &&
    typeof user.username === "string"
  );
}

function readErrorCode(error: unknown, fallback: string): string {
  if (error instanceof AppError) {
    return error.errorCode;
  }

  return fallback;
}

function readErrorDetail(error: unknown, fallback: string): string {
  if (error instanceof AppError) {
    return error.message;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return "目标 HOST 探活超时";
  }

  return fallback;
}

function shouldRefreshPeerHostSession(session: PeerHostSessionRecord): boolean {
  if (!session.expiresAt) {
    return false;
  }

  const expiresAt = new Date(session.expiresAt).getTime();

  if (!Number.isFinite(expiresAt)) {
    return true;
  }

  return expiresAt <= Date.now() + 15_000;
}

function resolveReconnectFailureStatus(error: unknown): PeerHostStatus {
  if (error instanceof AppError) {
    if (
      error.errorCode === "PEER_HOST_VERSION_MISMATCH"
      || error.errorCode === "PEER_HOST_IDENTITY_CHANGED"
    ) {
      return "version_mismatch";
    }

    if (
      error.errorCode === "PEER_HOST_SESSION_REQUIRED"
      || error.errorCode === "PEER_HOST_SESSION_INVALID"
    ) {
      return "unauthorized";
    }
  }

  return "unreachable";
}

function toSessionView(record: PeerHostSessionRecord): PeerHostSessionView {
  return {
    exists: true,
    username: record.username,
    remoteUserId: record.remoteUserId,
    remoteUsername: record.remoteUsername,
    expiresAt: record.expiresAt,
    savedAt: record.savedAt,
    updatedAt: record.updatedAt,
  };
}
