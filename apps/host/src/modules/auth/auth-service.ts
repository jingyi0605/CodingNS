import { randomInt } from "node:crypto";

import type { HostConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { hashToken, verifyPassword } from "../../shared/utils/hash.js";
import { createId } from "../../shared/utils/id.js";
import { addSeconds, nowIso } from "../../shared/utils/time.js";
import { createOpaqueToken, isButlerRuntimeAccessToken } from "../../shared/utils/tokens.js";
import { resolveAuthDeviceInfo } from "./auth-device-display-name.js";
import type {
  AuthClientType,
  AuthDeviceRecord,
  AuthDeviceSessionRecord,
  AuthLoginAttemptRecord,
  AuthLoginEventRecord
} from "../../types/domain.js";
import type { AuthDeviceRepository } from "../../storage/repositories/auth-device-repository.js";
import type { AuthDeviceSessionRepository } from "../../storage/repositories/auth-device-session-repository.js";
import type { AuthLoginAttemptRepository } from "../../storage/repositories/auth-login-attempt-repository.js";
import type { AuthLoginEventRepository } from "../../storage/repositories/auth-login-event-repository.js";
import type { AuthTokenRepository } from "../../storage/repositories/auth-token-repository.js";
import type { AuthUserRepository } from "../../storage/repositories/auth-user-repository.js";
import type { BootstrapStateRepository } from "../../storage/repositories/bootstrap-state-repository.js";
import type { DemoCleanupService, DemoOnlineTracker } from "../demo/demo-cleanup-service.js";

export interface AuthenticatedUser {
  userId: string;
  username: string;
  role: "admin";
}

export type AuthCallerKind = "interactive_user" | "assistant_runtime" | "workspace_session";
export type AuthCapabilityProfile = "butler-full" | "butler-ui" | "workspace-scoped";

export interface AuthContext {
  accessToken: string;
  accessTokenId: string;
  deviceSessionId: string | null;
  deviceId: string | null;
  callerKind: AuthCallerKind;
  capabilityProfile: AuthCapabilityProfile | null;
  workspaceId: string | null;
  projectId: string | null;
  sessionId: string | null;
  user: AuthenticatedUser;
}

export interface AuthRequestMetadata {
  clientType: AuthClientType;
  clientInstanceId: string | null;
  displayName: string | null;
  sourceAddress: string | null;
  userAgent: string | null;
}

export interface LoginInput {
  username: string;
  password: string;
  captchaId?: string;
  captchaCode?: string;
}

export interface RefreshInput {
  refreshToken: string;
}

export interface LogoutInput {
  refreshToken?: string;
}

export interface UpdateCurrentDevicePrimaryInput {
  password: string;
  primary: boolean;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthenticatedUser;
}

export interface AuthDeviceView {
  deviceId: string | null;
  clientType: AuthClientType;
  clientInstanceId: string | null;
  displayName: string | null;
  browserName: string | null;
  browserVersion: string | null;
  osName: string | null;
  osVersion: string | null;
  lastSourceAddress: string | null;
  lastSeenAt: string;
  isPrimary: boolean;
  isCurrent: boolean;
  isLegacy: boolean;
}

export interface RecentLoginRecordView {
  id: string;
  deviceId: string | null;
  clientType: AuthClientType;
  displayName: string | null;
  browserName: string | null;
  browserVersion: string | null;
  osName: string | null;
  osVersion: string | null;
  sourceAddress: string | null;
  occurredAt: string;
  isCurrentDevice: boolean;
  isLegacy: boolean;
}

export interface AuthDeviceManagementSnapshot {
  currentDevice: AuthDeviceView | null;
  otherActiveDevices: AuthDeviceView[];
  recentLoginRecords: RecentLoginRecordView[];
}

export interface LogoutOtherDevicesResult {
  success: true;
  revokedDeviceCount: number;
}

export interface LogoutDeviceResult {
  success: true;
  revokedSessionCount: number;
}

interface CaptchaChallengePayload {
  captchaId: string;
  imageDataUrl: string;
}

interface IssueTokenPairResult {
  accessToken: string;
  refreshToken: string;
  accessTokenId: string;
  refreshTokenId: string;
  expiresIn: number;
}

export interface IssueScopedAccessTokenInput {
  userId: string;
  callerKind: "workspace_session";
  capabilityProfile: "workspace-scoped";
  workspaceId: string;
  projectId?: string | null;
  sessionId: string;
  expiresInSeconds?: number;
}

const DEFAULT_AUTH_REQUEST_METADATA: AuthRequestMetadata = {
  clientType: "unknown",
  clientInstanceId: null,
  displayName: null,
  sourceAddress: null,
  userAgent: null
};
const MAX_RECENT_LOGIN_EVENTS = 10;
const LOGIN_CAPTCHA_THRESHOLD = 3;
const LOGIN_CAPTCHA_LENGTH = 4;
const LOGIN_CAPTCHA_TTL_SECONDS = 5 * 60;
const LOGIN_CAPTCHA_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOGIN_CAPTCHA_WIDTH = 136;
const LOGIN_CAPTCHA_HEIGHT = 48;

export class AuthService {
  private readonly demoCleanupService?: DemoCleanupService;
  private readonly demoOnlineTracker?: DemoOnlineTracker;

  constructor(
    private readonly bootstrapStateRepository: BootstrapStateRepository,
    private readonly authUserRepository: AuthUserRepository,
    private readonly authTokenRepository: AuthTokenRepository,
    private readonly authDeviceRepository: AuthDeviceRepository,
    private readonly authDeviceSessionRepository: AuthDeviceSessionRepository,
    private readonly authLoginEventRepository: AuthLoginEventRepository,
    private readonly authLoginAttemptRepository: AuthLoginAttemptRepository,
    private readonly config: HostConfig,
    demoServices?: { cleanupService: DemoCleanupService; onlineTracker: DemoOnlineTracker }
  ) {
    this.demoCleanupService = demoServices?.cleanupService;
    this.demoOnlineTracker = demoServices?.onlineTracker;
  }

  login(input: LoginInput, metadata: AuthRequestMetadata = DEFAULT_AUTH_REQUEST_METADATA): AuthResponse {
    this.ensureInitialized();
    const now = new Date();
    const username = this.normalizeUsername(input.username);
    const attempt = this.readLoginAttempt(username, now);

    this.ensureCaptchaSatisfied(input, attempt, now);

    const user = this.authUserRepository.findByUsername(username);

    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      const nextAttempt = this.recordFailedLogin(username, attempt, now);

      if (nextAttempt.challenge) {
        throw this.createInvalidCredentialsError(nextAttempt.challenge);
      }

      throw this.createInvalidCredentialsError();
    }

    this.authLoginAttemptRepository.deleteByUsername(username);

    const issuedAt = nowIso(now);
    const device = this.resolveOrCreateDevice(user.id, metadata, issuedAt);
    const deviceSession = this.createDeviceSession(user.id, device?.id ?? null, issuedAt);
    const result = this.issueTokenPair(user.id, "interactive_user", deviceSession.id, now);

    this.authDeviceSessionRepository.updateBinding(deviceSession.id, {
      deviceId: device?.id ?? null,
      accessTokenId: result.accessTokenId,
      refreshTokenId: result.refreshTokenId,
      updatedAt: issuedAt
    });

    this.recordLoginEvent(user.id, device?.id ?? null, metadata.clientType, metadata.sourceAddress, issuedAt);

    const response = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: {
        userId: user.id,
        username: user.username,
        role: user.role
      }
    };

    if (this.demoOnlineTracker) {
      this.demoOnlineTracker.trackLogin(user.id, hashToken(response.accessToken));
    }

    return response;
  }

  refresh(input: RefreshInput, metadata: AuthRequestMetadata = DEFAULT_AUTH_REQUEST_METADATA): AuthResponse {
    this.ensureInitialized();

    const refreshTokenHash = hashToken(input.refreshToken);
    const refreshRecord = this.authTokenRepository.findByHash(refreshTokenHash, "refresh");

    if (!refreshRecord || refreshRecord.revokedAt) {
      throw new AppError({
        statusCode: 401,
        errorCode: "TOKEN_INVALID",
        detail: "refresh token 无效"
      });
    }

    if (new Date(refreshRecord.expiresAt).getTime() <= Date.now()) {
      throw new AppError({
        statusCode: 401,
        errorCode: "TOKEN_EXPIRED",
        detail: "refresh token 已过期"
      });
    }

    const user = this.authUserRepository.findById(refreshRecord.userId);

    if (!user) {
      throw new AppError({
        statusCode: 401,
        errorCode: "UNAUTHORIZED",
        detail: "当前用户不存在"
      });
    }

    const now = new Date();
    const issuedAt = nowIso(now);
    const existingDeviceSession = refreshRecord.deviceSessionId
      ? this.authDeviceSessionRepository.findById(refreshRecord.deviceSessionId)
      : null;
    const device =
      this.resolveDeviceForRefresh(user.id, metadata, existingDeviceSession?.deviceId ?? null, issuedAt);
    const deviceSession =
      existingDeviceSession
      ?? this.createDeviceSession(user.id, device?.id ?? null, issuedAt);
    const result = this.issueTokenPair(
      user.id,
      refreshRecord.callerKind ?? "interactive_user",
      deviceSession.id,
      now
    );

    this.authDeviceSessionRepository.updateBinding(deviceSession.id, {
      deviceId: device?.id ?? existingDeviceSession?.deviceId ?? null,
      accessTokenId: result.accessTokenId,
      refreshTokenId: result.refreshTokenId,
      updatedAt: issuedAt
    });

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: {
        userId: user.id,
        username: user.username,
        role: user.role
      }
    };
  }

  logout(accessToken: string, input?: LogoutInput): { success: true } {
    const revokedAt = nowIso();
    const accessHash = hashToken(accessToken);
    const accessRecord = this.authTokenRepository.findByHash(accessHash, "access");
    const userId = accessRecord?.userId;

    this.authTokenRepository.revokeByHash(accessHash, revokedAt);

    if (input?.refreshToken) {
      this.authTokenRepository.revokeByHash(hashToken(input.refreshToken), revokedAt);
    }

    if (accessRecord?.deviceSessionId) {
      this.authTokenRepository.revokeByDeviceSessionIds([accessRecord.deviceSessionId], revokedAt);
      this.authDeviceSessionRepository.revokeById(accessRecord.deviceSessionId, revokedAt);
    }

    if (userId && this.demoOnlineTracker && this.demoCleanupService) {
      const isLastSession = this.demoOnlineTracker.trackLogout(userId, accessHash);
      if (isLastSession) {
        this.demoCleanupService.cleanupAllUserData();
      }
    }

    return { success: true };
  }

  listDeviceManagement(auth: AuthContext): AuthDeviceManagementSnapshot {
    const currentDevice = auth.deviceId ? this.authDeviceRepository.findById(auth.deviceId) : null;
    const activeDeviceSessions = this.authDeviceSessionRepository.listActiveByUser(auth.user.userId);
    const otherDeviceIds = Array.from(
      new Set(
        activeDeviceSessions
          .filter((session) => session.deviceId && session.deviceId !== auth.deviceId)
          .map((session) => session.deviceId as string)
      )
    );
    const otherDevices = this.authDeviceRepository.listByIds(otherDeviceIds).map((device) =>
      toAuthDeviceView(device, false)
    );
    const legacySessions = activeDeviceSessions
      .filter((session) => !session.deviceId && session.id !== auth.deviceSessionId)
      .map((session) => toLegacyDeviceView(session.updatedAt));
    const legacyRefreshTokens = this.authTokenRepository
      .listActiveLegacyRefreshTokensByUser(auth.user.userId, nowIso())
      .map((record) => toLegacyDeviceView(record.createdAt));
    const recentLoginRecords = this.authLoginEventRepository.listRecentByUser(
      auth.user.userId,
      MAX_RECENT_LOGIN_EVENTS
    );
    const recentDeviceIds = Array.from(
      new Set(recentLoginRecords.flatMap((event) => (event.deviceId ? [event.deviceId] : [])))
    );
    const recentDevices = this.authDeviceRepository.listByIds(recentDeviceIds);
    const recentDeviceMap = new Map(recentDevices.map((device) => [device.id, device]));

    return {
      currentDevice: currentDevice ? toAuthDeviceView(currentDevice, true) : null,
      otherActiveDevices: [...otherDevices, ...legacySessions, ...legacyRefreshTokens],
      recentLoginRecords: recentLoginRecords.map((event) =>
        toRecentLoginRecordView(
          event,
          event.deviceId ? (recentDeviceMap.get(event.deviceId) ?? null) : null,
          auth.deviceId
        )
      )
    };
  }

  updateCurrentDevicePrimary(auth: AuthContext, input: UpdateCurrentDevicePrimaryInput): AuthDeviceView {
    if (!auth.deviceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "DEVICE_CONTEXT_REQUIRED",
        detail: "当前登录态缺少设备上下文，请重新登录后重试"
      });
    }

    const user = this.authUserRepository.findById(auth.user.userId);

    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      throw new AppError({
        statusCode: 401,
        errorCode: "INVALID_CREDENTIALS",
        detail: "管理员密码错误"
      });
    }

    const updatedAt = nowIso();
    this.authDeviceRepository.updatePrimary(auth.deviceId, {
      isPrimary: input.primary,
      primarySetAt: input.primary ? updatedAt : null,
      updatedAt
    });

    const nextDevice = this.authDeviceRepository.findById(auth.deviceId);

    if (!nextDevice) {
      throw new AppError({
        statusCode: 404,
        errorCode: "DEVICE_NOT_FOUND",
        detail: "当前设备不存在"
      });
    }

    return toAuthDeviceView(nextDevice, true);
  }

  logoutOtherDevices(auth: AuthContext): LogoutOtherDevicesResult {
    this.ensurePrimaryDeviceAccess(auth);

    const revokedAt = nowIso();
    const activeSessions = this.authDeviceSessionRepository.listActiveByUser(auth.user.userId);
    const targetSessions = activeSessions.filter(
      (session) => session.deviceId !== auth.deviceId && session.id !== auth.deviceSessionId
    );
    const targetSessionIds = targetSessions.map((session) => session.id);
    const legacyRefreshTokens = this.authTokenRepository.listActiveLegacyRefreshTokensByUser(
      auth.user.userId,
      revokedAt
    );
    const revokedDeviceCount =
      new Set(targetSessions.map((session) => session.deviceId ?? `legacy-session:${session.id}`)).size
      + legacyRefreshTokens.length;

    this.authTokenRepository.revokeByDeviceSessionIds(targetSessionIds, revokedAt);
    this.authDeviceSessionRepository.revokeByIds(targetSessionIds, revokedAt);

    if (legacyRefreshTokens.length > 0) {
      this.authTokenRepository.revokeLegacyTokensByUser(auth.user.userId, revokedAt);
    }

    return {
      success: true,
      revokedDeviceCount
    };
  }

  logoutDevice(auth: AuthContext, deviceId: string): LogoutDeviceResult {
    this.ensurePrimaryDeviceAccess(auth);

    if (deviceId === auth.deviceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "CURRENT_DEVICE_NOT_ALLOWED",
        detail: "不能直接退出当前设备，请使用退出登录"
      });
    }

    const targetDevice = this.authDeviceRepository.findById(deviceId);

    if (!targetDevice || targetDevice.userId !== auth.user.userId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "DEVICE_NOT_FOUND",
        detail: "目标设备不存在"
      });
    }

    const revokedAt = nowIso();
    const activeSessions = this.authDeviceSessionRepository.listActiveByUser(auth.user.userId);
    const targetSessionIds = activeSessions
      .filter((session) => session.deviceId === deviceId)
      .map((session) => session.id);

    this.authTokenRepository.revokeByDeviceSessionIds(targetSessionIds, revokedAt);
    this.authDeviceSessionRepository.revokeByIds(targetSessionIds, revokedAt);

    return {
      success: true,
      revokedSessionCount: targetSessionIds.length
    };
  }

  authenticateAccessToken(accessToken: string): AuthContext {
    const accessRecord = this.authTokenRepository.findByHash(hashToken(accessToken), "access");

    if (!accessRecord || accessRecord.revokedAt) {
      throw new AppError({
        statusCode: 401,
        errorCode: "UNAUTHORIZED",
        detail: "access token 无效"
      });
    }

    if (new Date(accessRecord.expiresAt).getTime() <= Date.now()) {
      throw new AppError({
        statusCode: 401,
        errorCode: "TOKEN_EXPIRED",
        detail: "access token 已过期"
      });
    }

    const user = this.authUserRepository.findById(accessRecord.userId);

    if (!user) {
      throw new AppError({
        statusCode: 401,
        errorCode: "UNAUTHORIZED",
        detail: "当前用户不存在"
      });
    }

    const deviceSession = accessRecord.deviceSessionId
      ? this.authDeviceSessionRepository.findById(accessRecord.deviceSessionId)
      : null;

    return {
      accessToken,
      accessTokenId: accessRecord.id,
      deviceSessionId: accessRecord.deviceSessionId,
      deviceId: deviceSession?.deviceId ?? null,
      callerKind: accessRecord.callerKind ?? resolveAuthCallerKind(accessToken),
      capabilityProfile: normalizeAuthCapabilityProfile(accessRecord.capabilityProfile),
      workspaceId: accessRecord.workspaceId,
      projectId: accessRecord.projectId,
      sessionId: accessRecord.sessionId,
      user: {
        userId: user.id,
        username: user.username,
        role: user.role
      }
    };
  }

  private ensurePrimaryDeviceAccess(auth: AuthContext): AuthDeviceRecord {
    if (!auth.deviceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "DEVICE_CONTEXT_REQUIRED",
        detail: "当前登录态缺少设备上下文，请重新登录后重试"
      });
    }

    const currentDevice = this.authDeviceRepository.findById(auth.deviceId);

    if (!currentDevice?.isPrimary) {
      throw new AppError({
        statusCode: 403,
        errorCode: "PRIMARY_DEVICE_REQUIRED",
        detail: "只有主设备才能退出其他设备"
      });
    }

    return currentDevice;
  }

  ensureInitialized(): void {
    if (!this.bootstrapStateRepository.getState().initialized) {
      throw new AppError({
        statusCode: 403,
        errorCode: "BOOTSTRAP_REQUIRED",
        detail: "系统尚未初始化，请先完成 setup"
      });
    }
  }

  issueScopedAccessToken(input: IssueScopedAccessTokenInput): {
    accessToken: string;
    accessTokenId: string;
    expiresAt: string;
    issuedAt: string;
  } {
    const workspaceId = input.workspaceId.trim();
    const sessionId = input.sessionId.trim();

    if (!workspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "workspaceId 不能为空",
        field: "workspaceId"
      });
    }

    if (!sessionId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "sessionId 不能为空",
        field: "sessionId"
      });
    }

    const now = new Date();
    const issuedAt = nowIso(now);
    const expiresAt = addSeconds(now, input.expiresInSeconds ?? this.config.accessTokenTtlSeconds);
    const accessToken = createOpaqueToken("ws_");
    const accessTokenId = createId();

    this.authTokenRepository.create({
      id: accessTokenId,
      userId: input.userId,
      tokenType: "access",
      tokenHash: hashToken(accessToken),
      deviceSessionId: null,
      callerKind: input.callerKind,
      capabilityProfile: input.capabilityProfile,
      workspaceId,
      projectId: input.projectId?.trim() || null,
      sessionId,
      expiresAt,
      revokedAt: null,
      createdAt: issuedAt
    });

    return {
      accessToken,
      accessTokenId,
      expiresAt,
      issuedAt
    };
  }

  private createDeviceSession(userId: string, deviceId: string | null, timestamp: string): AuthDeviceSessionRecord {
    const record: AuthDeviceSessionRecord = {
      id: createId(),
      userId,
      deviceId,
      accessTokenId: null,
      refreshTokenId: null,
      revokedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.authDeviceSessionRepository.create(record);
    return record;
  }

  private resolveDeviceForRefresh(
    userId: string,
    metadata: AuthRequestMetadata,
    currentDeviceId: string | null,
    timestamp: string
  ): AuthDeviceRecord | null {
    if (currentDeviceId) {
      const currentDevice = this.authDeviceRepository.findById(currentDeviceId);

      if (currentDevice) {
        this.authDeviceRepository.updateActivity(currentDevice.id, {
          displayName: metadata.displayName ?? currentDevice.displayName,
          userAgent: metadata.userAgent ?? currentDevice.userAgent,
          lastSourceAddress: metadata.sourceAddress ?? currentDevice.lastSourceAddress,
          lastSeenAt: timestamp,
          updatedAt: timestamp
        });
        return this.authDeviceRepository.findById(currentDevice.id);
      }
    }

    return this.resolveOrCreateDevice(userId, metadata, timestamp);
  }

  private resolveOrCreateDevice(
    userId: string,
    metadata: AuthRequestMetadata,
    timestamp: string
  ): AuthDeviceRecord | null {
    if (!metadata.clientInstanceId) {
      return null;
    }

    const existing = this.authDeviceRepository.findByClientIdentity(
      userId,
      metadata.clientType,
      metadata.clientInstanceId
    );

    if (existing) {
      this.authDeviceRepository.updateActivity(existing.id, {
        displayName: metadata.displayName ?? existing.displayName,
        userAgent: metadata.userAgent ?? existing.userAgent,
        lastSourceAddress: metadata.sourceAddress ?? existing.lastSourceAddress,
        lastSeenAt: timestamp,
        updatedAt: timestamp
      });
      return this.authDeviceRepository.findById(existing.id);
    }

    const record: AuthDeviceRecord = {
      id: createId(),
      userId,
      clientType: metadata.clientType,
      clientInstanceId: metadata.clientInstanceId,
      displayName: metadata.displayName,
      userAgent: metadata.userAgent,
      isPrimary: false,
      lastSourceAddress: metadata.sourceAddress,
      lastSeenAt: timestamp,
      primarySetAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.authDeviceRepository.create(record);
    return record;
  }

  private recordLoginEvent(
    userId: string,
    deviceId: string | null,
    clientType: AuthClientType,
    sourceAddress: string | null,
    occurredAt: string
  ): void {
    const record: AuthLoginEventRecord = {
      id: createId(),
      userId,
      deviceId,
      clientType,
      sourceAddress,
      occurredAt
    };

    this.authLoginEventRepository.create(record);
    this.authLoginEventRepository.trimToLatest(userId, MAX_RECENT_LOGIN_EVENTS);
  }

  private issueTokenPair(
    userId: string,
    callerKind: AuthCallerKind,
    deviceSessionId: string | null,
    now: Date
  ): IssueTokenPairResult {
    const createdAt = nowIso(now);
    const accessToken = createOpaqueToken(callerKind === "assistant_runtime" ? "butler_" : "");
    const refreshToken = createOpaqueToken();
    const accessTokenId = createId();
    const refreshTokenId = createId();

    this.authTokenRepository.create({
      id: accessTokenId,
      userId,
      tokenType: "access",
      tokenHash: hashToken(accessToken),
      deviceSessionId,
      callerKind,
      capabilityProfile: callerKind === "assistant_runtime" ? "butler-full" : null,
      workspaceId: null,
      projectId: null,
      sessionId: null,
      expiresAt: addSeconds(now, this.config.accessTokenTtlSeconds),
      revokedAt: null,
      createdAt
    });

    this.authTokenRepository.create({
      id: refreshTokenId,
      userId,
      tokenType: "refresh",
      tokenHash: hashToken(refreshToken),
      deviceSessionId,
      callerKind,
      capabilityProfile: callerKind === "assistant_runtime" ? "butler-full" : null,
      workspaceId: null,
      projectId: null,
      sessionId: null,
      expiresAt: addSeconds(now, this.config.refreshTokenTtlSeconds),
      revokedAt: null,
      createdAt
    });

    return {
      accessToken,
      refreshToken,
      accessTokenId,
      refreshTokenId,
      expiresIn: this.config.accessTokenTtlSeconds
    };
  }

  private normalizeUsername(username: string): string {
    return username.trim();
  }

  private normalizeCaptchaCode(code: string | undefined): string {
    return code?.trim().replace(/\s+/g, "").toUpperCase() ?? "";
  }

  private readLoginAttempt(username: string, now: Date): AuthLoginAttemptRecord | null {
    const attempt = this.authLoginAttemptRepository.findByUsername(username);

    if (!attempt) {
      return null;
    }

    if (!attempt.captchaExpiresAt || Date.parse(attempt.captchaExpiresAt) > now.getTime()) {
      return attempt;
    }

    const nextAttempt: AuthLoginAttemptRecord = {
      ...attempt,
      captchaId: null,
      captchaCodeHash: null,
      captchaExpiresAt: null,
      updatedAt: nowIso(now)
    };
    this.authLoginAttemptRepository.upsert(nextAttempt);

    return nextAttempt;
  }

  private ensureCaptchaSatisfied(
    input: LoginInput,
    attempt: AuthLoginAttemptRecord | null,
    now: Date
  ): void {
    if (!attempt || !this.isCaptchaRequired(attempt)) {
      return;
    }

    const normalizedCaptchaCode = this.normalizeCaptchaCode(input.captchaCode);

    if (!input.captchaId || normalizedCaptchaCode.length === 0) {
      const nextChallenge = this.rotateCaptchaChallenge(attempt, now);

      throw this.createCaptchaError("CAPTCHA_REQUIRED", "请先完成图形验证码", nextChallenge.challenge);
    }

    if (
      !attempt.captchaId ||
      !attempt.captchaCodeHash ||
      input.captchaId !== attempt.captchaId ||
      hashToken(normalizedCaptchaCode) !== attempt.captchaCodeHash
    ) {
      const nextChallenge = this.rotateCaptchaChallenge(attempt, now);

      throw this.createCaptchaError(
        "CAPTCHA_INVALID",
        "图形验证码错误，请重试",
        nextChallenge.challenge
      );
    }
  }

  private recordFailedLogin(
    username: string,
    attempt: AuthLoginAttemptRecord | null,
    now: Date
  ): { record: AuthLoginAttemptRecord; challenge: CaptchaChallengePayload | null } {
    const timestamp = nowIso(now);
    const nextAttempt: AuthLoginAttemptRecord = {
      username,
      failedAttemptCount: Math.min(
        (attempt?.failedAttemptCount ?? 0) + 1,
        LOGIN_CAPTCHA_THRESHOLD
      ),
      captchaId: attempt?.captchaId ?? null,
      captchaCodeHash: attempt?.captchaCodeHash ?? null,
      captchaExpiresAt: attempt?.captchaExpiresAt ?? null,
      createdAt: attempt?.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    if (!this.isCaptchaRequired(nextAttempt)) {
      nextAttempt.captchaId = null;
      nextAttempt.captchaCodeHash = null;
      nextAttempt.captchaExpiresAt = null;
      this.authLoginAttemptRepository.upsert(nextAttempt);

      return {
        record: nextAttempt,
        challenge: null
      };
    }

    return this.rotateCaptchaChallenge(nextAttempt, now);
  }

  private rotateCaptchaChallenge(
    attempt: AuthLoginAttemptRecord,
    now: Date
  ): { record: AuthLoginAttemptRecord; challenge: CaptchaChallengePayload } {
    const captchaCode = this.createCaptchaCode();
    const timestamp = nowIso(now);
    const nextAttempt: AuthLoginAttemptRecord = {
      username: attempt.username,
      failedAttemptCount: Math.max(attempt.failedAttemptCount, LOGIN_CAPTCHA_THRESHOLD),
      captchaId: createId(),
      captchaCodeHash: hashToken(captchaCode),
      captchaExpiresAt: addSeconds(now, LOGIN_CAPTCHA_TTL_SECONDS),
      createdAt: attempt.createdAt,
      updatedAt: timestamp
    };

    this.authLoginAttemptRepository.upsert(nextAttempt);

    return {
      record: nextAttempt,
      challenge: this.toCaptchaChallenge(nextAttempt, captchaCode)
    };
  }

  private toCaptchaChallenge(attempt: AuthLoginAttemptRecord, captchaCode: string): CaptchaChallengePayload {
    return {
      captchaId: attempt.captchaId ?? "",
      imageDataUrl: this.buildCaptchaImageDataUrl(captchaCode)
    };
  }

  private createInvalidCredentialsError(challenge?: CaptchaChallengePayload): AppError {
    return new AppError({
      statusCode: 401,
      errorCode: "INVALID_CREDENTIALS",
      detail: challenge ? "用户名或密码错误，请完成图形验证码后重试" : "用户名或密码错误",
      data: challenge
        ? {
            captcha: challenge
          }
        : undefined
    });
  }

  private createCaptchaError(
    errorCode: "CAPTCHA_REQUIRED" | "CAPTCHA_INVALID",
    detail: string,
    challenge: CaptchaChallengePayload
  ): AppError {
    return new AppError({
      statusCode: 400,
      errorCode,
      detail,
      field: "captchaCode",
      data: {
        captcha: challenge
      }
    });
  }

  private isCaptchaRequired(attempt: Pick<AuthLoginAttemptRecord, "failedAttemptCount"> | null): boolean {
    return (attempt?.failedAttemptCount ?? 0) >= LOGIN_CAPTCHA_THRESHOLD;
  }

  private createCaptchaCode(): string {
    let code = "";

    for (let index = 0; index < LOGIN_CAPTCHA_LENGTH; index += 1) {
      code += LOGIN_CAPTCHA_CHARS[randomInt(0, LOGIN_CAPTCHA_CHARS.length)];
    }

    return code;
  }

  private buildCaptchaImageDataUrl(code: string): string {
    const svg = this.buildCaptchaSvg(code);
    return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
  }

  private buildCaptchaSvg(code: string): string {
    const lines = Array.from({ length: 4 }, () =>
      `<line x1="${randomInt(0, LOGIN_CAPTCHA_WIDTH)}" y1="${randomInt(0, LOGIN_CAPTCHA_HEIGHT)}" x2="${randomInt(0, LOGIN_CAPTCHA_WIDTH)}" y2="${randomInt(0, LOGIN_CAPTCHA_HEIGHT)}" stroke="rgba(14,165,233,0.45)" stroke-width="${randomInt(1, 3)}" />`
    ).join("");
    const dots = Array.from({ length: 16 }, () =>
      `<circle cx="${randomInt(4, LOGIN_CAPTCHA_WIDTH - 4)}" cy="${randomInt(4, LOGIN_CAPTCHA_HEIGHT - 4)}" r="${randomInt(1, 3)}" fill="rgba(148,163,184,0.45)" />`
    ).join("");
    const chars = code
      .split("")
      .map((char, index) => {
        const x = 18 + index * 26 + randomInt(-2, 3);
        const y = 31 + randomInt(-2, 4);
        const rotate = randomInt(-22, 23);

        return `<text x="${x}" y="${y}" transform="rotate(${rotate} ${x} ${y})" font-size="25" font-family="monospace" font-weight="700" fill="#f8fafc">${char}</text>`;
      })
      .join("");

    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${LOGIN_CAPTCHA_WIDTH}" height="${LOGIN_CAPTCHA_HEIGHT}" viewBox="0 0 ${LOGIN_CAPTCHA_WIDTH} ${LOGIN_CAPTCHA_HEIGHT}" role="img" aria-label="login captcha">
        <rect width="100%" height="100%" rx="8" fill="#0f172a" />
        <rect x="1" y="1" width="${LOGIN_CAPTCHA_WIDTH - 2}" height="${LOGIN_CAPTCHA_HEIGHT - 2}" rx="7" fill="none" stroke="rgba(56,189,248,0.35)" />
        ${lines}
        ${dots}
        ${chars}
      </svg>
    `.trim();
  }
}

export function resolveAuthCallerKind(accessToken: string): AuthCallerKind {
  return isButlerRuntimeAccessToken(accessToken) ? "assistant_runtime" : "interactive_user";
}

function normalizeAuthCapabilityProfile(value: string | null): AuthCapabilityProfile | null {
  if (value === "butler-full" || value === "butler-ui" || value === "workspace-scoped") {
    return value;
  }

  return null;
}

function toAuthDeviceView(device: AuthDeviceRecord, isCurrent: boolean): AuthDeviceView {
  const deviceInfo = resolveAuthDeviceInfo(device.clientType, device.userAgent);

  return {
    deviceId: device.id,
    clientType: device.clientType,
    clientInstanceId: device.clientInstanceId,
    displayName: deviceInfo.displayName ?? device.displayName,
    browserName: deviceInfo.browserName,
    browserVersion: deviceInfo.browserVersion,
    osName: deviceInfo.osName,
    osVersion: deviceInfo.osVersion,
    lastSourceAddress: device.lastSourceAddress,
    lastSeenAt: device.lastSeenAt,
    isPrimary: device.isPrimary,
    isCurrent,
    isLegacy: false
  };
}

function toLegacyDeviceView(timestamp: string): AuthDeviceView {
  return {
    deviceId: null,
    clientType: "unknown",
    clientInstanceId: null,
    displayName: null,
    browserName: null,
    browserVersion: null,
    osName: null,
    osVersion: null,
    lastSourceAddress: null,
    lastSeenAt: timestamp,
    isPrimary: false,
    isCurrent: false,
    isLegacy: true
  };
}

function toRecentLoginRecordView(
  event: AuthLoginEventRecord,
  device: AuthDeviceRecord | null,
  currentDeviceId: string | null
): RecentLoginRecordView {
  const deviceInfo = device ? resolveAuthDeviceInfo(device.clientType, device.userAgent) : null;

  return {
    id: event.id,
    deviceId: event.deviceId,
    clientType: event.clientType,
    displayName: deviceInfo?.displayName ?? device?.displayName ?? null,
    browserName: deviceInfo?.browserName ?? null,
    browserVersion: deviceInfo?.browserVersion ?? null,
    osName: deviceInfo?.osName ?? null,
    osVersion: deviceInfo?.osVersion ?? null,
    sourceAddress: event.sourceAddress,
    occurredAt: event.occurredAt,
    isCurrentDevice: event.deviceId !== null && event.deviceId === currentDeviceId,
    isLegacy: event.deviceId === null
  };
}
