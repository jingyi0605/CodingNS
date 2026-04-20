import { AppError } from "../../shared/errors/app-error.js";
import type { SessionHistoryEnvelope, SessionHistoryService } from "./session-history-service.js";
import {
  normalizeProviderUsageLimit,
  type NormalizedProviderUsageLimit
} from "./session-provider-usage-limit.js";

const RECENT_HISTORY_LIMIT = 40;
const PROVIDER_USAGE_LIMIT_RESUME_BUFFER_MS = 5 * 60_000;

export interface SessionProviderUsageLimitCandidate {
  sessionId: string;
  userId: string;
  sourceLabel?: string | null;
}

export interface SessionProviderUsageLimitInspection {
  sessionId: string;
  providerId: string | null;
  sourceLabel: string | null;
  providerUsageLimit: NormalizedProviderUsageLimit;
  detectedAt: string;
  blockedUntil: string | null;
}

export interface SessionProviderUsageLimitBlock {
  inspection: SessionProviderUsageLimitInspection;
  blockedUntil: string;
}

export interface ProviderUsageLimitErrorData {
  providerUsageLimit: NormalizedProviderUsageLimit;
  blockedUntil: string | null;
  sessionId: string | null;
  sourceLabel: string | null;
}

export class SessionProviderUsageLimitGuardService {
  constructor(
    private readonly sessionHistoryService: Pick<
      SessionHistoryService,
      "getSession" | "readRecentHistoryEnvelope"
    >
  ) {}

  async inspectSession(
    candidate: SessionProviderUsageLimitCandidate
  ): Promise<SessionProviderUsageLimitInspection | null> {
    const session = this.sessionHistoryService.getSession(candidate.sessionId, candidate.userId);
    const envelope = await this.readRecentEnvelopeSafely(candidate.sessionId);
    const latestAssistantText = resolveLatestAssistantText(envelope);
    const detectedAt = normalizeNullableIso(session.lastMessageAt) ?? new Date().toISOString();
    const providerUsageLimit = resolveInspectionProviderUsageLimit(
      session.provider,
      session.lastErrorDetail,
      latestAssistantText,
      detectedAt
    );

    if (!providerUsageLimit) {
      return null;
    }

    return {
      sessionId: candidate.sessionId,
      providerId: session.provider,
      sourceLabel: normalizeNullableText(candidate.sourceLabel),
      providerUsageLimit,
      detectedAt,
      blockedUntil: resolveProviderUsageLimitBlockedUntil(providerUsageLimit, detectedAt)
    };
  }

  async resolveBlockingInspection(
    candidates: SessionProviderUsageLimitCandidate[],
    referenceAt: string
  ): Promise<SessionProviderUsageLimitBlock | null> {
    const inspections = await Promise.all(candidates.map(async (candidate) => await this.inspectSession(candidate)));
    const referenceAtMs = Date.parse(referenceAt);
    let blocked: SessionProviderUsageLimitBlock | null = null;

    for (const inspection of inspections) {
      if (!inspection?.blockedUntil) {
        continue;
      }

      const blockedUntilMs = Date.parse(inspection.blockedUntil);

      if (!Number.isFinite(blockedUntilMs) || blockedUntilMs <= referenceAtMs) {
        continue;
      }

      if (!blocked || blockedUntilMs > Date.parse(blocked.blockedUntil)) {
        blocked = {
          inspection,
          blockedUntil: inspection.blockedUntil
        };
      }
    }

    return blocked;
  }

  createBlockedAppError(block: SessionProviderUsageLimitBlock): AppError {
    const label = block.inspection.sourceLabel ?? "当前会话";
    const detail = `${label}检测到 provider 套餐限额，系统会在 ${block.blockedUntil} 后再继续尝试。`;

    return new AppError({
      statusCode: 429,
      errorCode: "PROVIDER_USAGE_LIMIT_EXCEEDED",
      detail,
      data: {
        providerUsageLimit: block.inspection.providerUsageLimit,
        blockedUntil: block.blockedUntil,
        sessionId: block.inspection.sessionId,
        sourceLabel: block.inspection.sourceLabel
      }
    });
  }

  private async readRecentEnvelopeSafely(sessionId: string): Promise<SessionHistoryEnvelope | null> {
    try {
      return await this.sessionHistoryService.readRecentHistoryEnvelope(sessionId, RECENT_HISTORY_LIMIT);
    } catch {
      return null;
    }
  }
}

export function resolveProviderUsageLimitFromError(
  error: unknown,
  providerId: string | null,
  referenceAt: string
): NormalizedProviderUsageLimit | null {
  if (error instanceof AppError) {
    const fromData = readProviderUsageLimitErrorData(error.data);

    if (fromData) {
      return fromData.providerUsageLimit;
    }
  }

  if (error instanceof Error) {
    return normalizeProviderUsageLimit({
      providerId,
      text: error.message,
      referenceAt,
      source: "error"
    });
  }

  return null;
}

export function readProviderUsageLimitErrorData(
  value: Record<string, unknown> | undefined
): ProviderUsageLimitErrorData | null {
  const providerUsageLimit = readProviderUsageLimitFromErrorData(value);

  if (!providerUsageLimit) {
    return null;
  }

  return {
    providerUsageLimit,
    blockedUntil: normalizeNullableIso(
      typeof value?.blockedUntil === "string" ? value.blockedUntil : null
    ),
    sessionId: normalizeNullableText(
      typeof value?.sessionId === "string" ? value.sessionId : null
    ),
    sourceLabel: normalizeNullableText(
      typeof value?.sourceLabel === "string" ? value.sourceLabel : null
    )
  };
}

export function resolveProviderUsageLimitBlockedUntil(
  providerUsageLimit: NormalizedProviderUsageLimit,
  referenceAt: string | null | undefined
): string | null {
  const normalizedReferenceAt = normalizeNullableIso(referenceAt) ?? new Date().toISOString();

  if (providerUsageLimit.retryAt) {
    const retryAtMs = Date.parse(providerUsageLimit.retryAt);

    if (Number.isFinite(retryAtMs)) {
      return new Date(retryAtMs + PROVIDER_USAGE_LIMIT_RESUME_BUFFER_MS).toISOString();
    }
  }

  if (providerUsageLimit.retryAfterSeconds && providerUsageLimit.retryAfterSeconds > 0) {
    const referenceAtMs = Date.parse(normalizedReferenceAt);

    if (Number.isFinite(referenceAtMs)) {
      return new Date(
        referenceAtMs
        + providerUsageLimit.retryAfterSeconds * 1000
        + PROVIDER_USAGE_LIMIT_RESUME_BUFFER_MS
      ).toISOString();
    }
  }

  return null;
}

function resolveInspectionProviderUsageLimit(
  providerId: string | null | undefined,
  lastErrorDetail: string | null | undefined,
  latestAssistantText: string | null | undefined,
  referenceAt: string | null | undefined
): NormalizedProviderUsageLimit | null {
  const normalizedReferenceAt = normalizeNullableIso(referenceAt) ?? undefined;
  const fromErrorDetail = normalizeProviderUsageLimit({
    providerId,
    text: lastErrorDetail,
    referenceAt: normalizedReferenceAt,
    source: "error_detail"
  });

  if (fromErrorDetail) {
    return fromErrorDetail;
  }

  return normalizeProviderUsageLimit({
    providerId,
    text: latestAssistantText,
    referenceAt: normalizedReferenceAt,
    source: "message"
  });
}

function readProviderUsageLimitFromErrorData(
  value: Record<string, unknown> | undefined
): NormalizedProviderUsageLimit | null {
  const candidate = value?.providerUsageLimit;

  if (!isRecord(candidate) || candidate.category !== "usage_limit") {
    return null;
  }

  return {
    category: "usage_limit",
    providerId: normalizeNullableText(
      typeof candidate.providerId === "string" ? candidate.providerId : null
    ),
    source: candidate.source === "error_detail" || candidate.source === "message" ? candidate.source : "error",
    retryAt: normalizeNullableIso(
      typeof candidate.retryAt === "string" ? candidate.retryAt : null
    ),
    retryAfterSeconds: typeof candidate.retryAfterSeconds === "number"
      && Number.isFinite(candidate.retryAfterSeconds)
      && candidate.retryAfterSeconds > 0
      ? candidate.retryAfterSeconds
      : null,
    rawText: typeof candidate.rawText === "string" ? candidate.rawText : "",
    summary: typeof candidate.summary === "string" && candidate.summary.trim().length > 0
      ? candidate.summary.trim()
      : "检测到 provider 额度已达上限，系统会按下一次可用时机自动重试。"
  };
}

function resolveLatestAssistantText(envelope: SessionHistoryEnvelope | null): string | null {
  if (!envelope || envelope.messages.length === 0) {
    return null;
  }

  const latestAssistant = [...envelope.messages]
    .sort((left, right) => right.sequence - left.sequence)
    .find((message) => message.role === "assistant" && message.content.trim().length > 0);

  return latestAssistant?.content?.trim() || null;
}

function normalizeNullableIso(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
