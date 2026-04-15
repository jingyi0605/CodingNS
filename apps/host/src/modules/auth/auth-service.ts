import { randomInt } from "node:crypto";

import type { HostConfig } from "../../config/env.js";
import type { DemoCleanupService, DemoOnlineTracker } from "../demo/demo-cleanup-service.js";
import { AppError } from "../../shared/errors/app-error.js";
import { hashToken, verifyPassword } from "../../shared/utils/hash.js";
import { createId } from "../../shared/utils/id.js";
import { addSeconds, nowIso } from "../../shared/utils/time.js";
import { createOpaqueToken } from "../../shared/utils/tokens.js";
import type { AuthLoginAttemptRecord } from "../../types/domain.js";
import type { AuthLoginAttemptRepository } from "../../storage/repositories/auth-login-attempt-repository.js";
import type { AuthTokenRepository } from "../../storage/repositories/auth-token-repository.js";
import type { AuthUserRepository } from "../../storage/repositories/auth-user-repository.js";
import type { BootstrapStateRepository } from "../../storage/repositories/bootstrap-state-repository.js";

export interface AuthenticatedUser {
  userId: string;
  username: string;
  role: "admin";
}

export interface AuthContext {
  accessToken: string;
  user: AuthenticatedUser;
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

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthenticatedUser;
}

interface CaptchaChallengePayload {
  captchaId: string;
  imageDataUrl: string;
}

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
    private readonly authLoginAttemptRepository: AuthLoginAttemptRepository,
    private readonly config: HostConfig,
    demoServices?: { cleanupService: DemoCleanupService; onlineTracker: DemoOnlineTracker }
  ) {
    this.demoCleanupService = demoServices?.cleanupService;
    this.demoOnlineTracker = demoServices?.onlineTracker;
  }

  login(input: LoginInput): AuthResponse {
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

    const result = {
      ...this.issueTokenPair(user.id),
      user: {
        userId: user.id,
        username: user.username,
        role: user.role
      }
    };

    // Demo 模式：追踪在线会话
    if (this.demoOnlineTracker) {
      this.demoOnlineTracker.trackLogin(user.id, hashToken(result.accessToken));
    }

    return result;
  }

  refresh(input: RefreshInput): AuthResponse {
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

    // Note: Refresh token is not revoked to allow long-term sessions
    // In a production environment, you may want to implement token rotation
    // this.authTokenRepository.revokeByHash(refreshTokenHash, nowIso());

    return {
      ...this.issueTokenPair(user.id),
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

    // 先查出用户 ID（用于 demo 在线追踪）
    const accessRecord = this.authTokenRepository.findByHash(accessHash, "access");
    const userId = accessRecord?.userId;

    this.authTokenRepository.revokeByHash(accessHash, revokedAt);

    if (input?.refreshToken) {
      this.authTokenRepository.revokeByHash(hashToken(input.refreshToken), revokedAt);
    }

    // Demo 模式：最后一个在线会话注销时清理所有业务数据
    if (userId && this.demoOnlineTracker && this.demoCleanupService) {
      const isLastSession = this.demoOnlineTracker.trackLogout(userId, accessHash);
      if (isLastSession) {
        this.demoCleanupService.cleanupAllUserData();
      }
    }

    return { success: true };
  }

  authenticateAccessToken(accessToken: string): AuthenticatedUser {
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

    return {
      userId: user.id,
      username: user.username,
      role: user.role
    };
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

  private issueTokenPair(userId: string): Omit<AuthResponse, "user"> {
    const now = new Date();
    const createdAt = nowIso(now);
    const accessToken = createOpaqueToken();
    const refreshToken = createOpaqueToken();

    this.authTokenRepository.create({
      id: createId(),
      userId,
      tokenType: "access",
      tokenHash: hashToken(accessToken),
      expiresAt: addSeconds(now, this.config.accessTokenTtlSeconds),
      revokedAt: null,
      createdAt
    });

    this.authTokenRepository.create({
      id: createId(),
      userId,
      tokenType: "refresh",
      tokenHash: hashToken(refreshToken),
      expiresAt: addSeconds(now, this.config.refreshTokenTtlSeconds),
      revokedAt: null,
      createdAt
    });

    return {
      accessToken,
      refreshToken,
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
