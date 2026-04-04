import type { HostConfig } from "../../config/env.js";
import type { DemoCleanupService, DemoOnlineTracker } from "../demo/demo-cleanup-service.js";
import { AppError } from "../../shared/errors/app-error.js";
import { hashToken, verifyPassword } from "../../shared/utils/hash.js";
import { createId } from "../../shared/utils/id.js";
import { addSeconds, nowIso } from "../../shared/utils/time.js";
import { createOpaqueToken } from "../../shared/utils/tokens.js";
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

export class AuthService {
  private readonly demoCleanupService?: DemoCleanupService;
  private readonly demoOnlineTracker?: DemoOnlineTracker;

  constructor(
    private readonly bootstrapStateRepository: BootstrapStateRepository,
    private readonly authUserRepository: AuthUserRepository,
    private readonly authTokenRepository: AuthTokenRepository,
    private readonly config: HostConfig,
    demoServices?: { cleanupService: DemoCleanupService; onlineTracker: DemoOnlineTracker }
  ) {
    this.demoCleanupService = demoServices?.cleanupService;
    this.demoOnlineTracker = demoServices?.onlineTracker;
  }

  login(input: LoginInput): AuthResponse {
    this.ensureInitialized();

    const user = this.authUserRepository.findByUsername(input.username.trim());

    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      throw new AppError({
        statusCode: 401,
        errorCode: "INVALID_CREDENTIALS",
        detail: "用户名或密码错误"
      });
    }

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
}
