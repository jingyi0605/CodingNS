import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type { SessionIndexRepository } from "../../storage/repositories/session-index-repository.js";
import type { SessionStateRepository } from "../../storage/repositories/session-state-repository.js";
import type { ProviderMessagePage } from "../../types/domain.js";
import type { ProviderMessageGateway } from "../provider/provider-message-gateway.js";

export class SessionReadService {
  constructor(
    private readonly sessionIndexRepository: SessionIndexRepository,
    private readonly sessionStateRepository: SessionStateRepository,
    private readonly providerMessageGateway: ProviderMessageGateway
  ) {}

  async readMessages(
    sessionId: string,
    cursor: string | null,
    limit: number
  ): Promise<ProviderMessagePage> {
    const session = this.sessionIndexRepository.findById(sessionId);

    if (!session) {
      throw new AppError({
        statusCode: 404,
        errorCode: "SESSION_NOT_FOUND",
        detail: "会话不存在"
      });
    }

    const safeLimit = clampLimit(limit);
    const currentState = this.sessionStateRepository.findBySessionId(sessionId);

    try {
      const page = await this.providerMessageGateway.readHistory(session, cursor, safeLimit);

      this.sessionStateRepository.upsert({
        sessionId,
        syncCursor: page.nextCursor,
        lastSyncAt: nowIso(),
        syncErrorCode: null,
        syncErrorMessage: null,
        updatedAt: nowIso()
      });

      return page;
    } catch (error) {
      const appError =
        error instanceof AppError
          ? error
          : new AppError({
              statusCode: 502,
              errorCode: "PROVIDER_READ_FAILED",
              detail: "读取 provider 原始消息失败"
            });

      this.sessionStateRepository.upsert({
        sessionId,
        syncCursor: currentState?.syncCursor ?? cursor,
        lastSyncAt: currentState?.lastSyncAt ?? null,
        syncErrorCode: appError.errorCode,
        syncErrorMessage: appError.message,
        updatedAt: nowIso()
      });

      throw appError;
    }
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.max(1, Math.min(Math.trunc(limit), 100));
}
