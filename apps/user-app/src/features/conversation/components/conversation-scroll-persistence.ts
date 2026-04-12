const STORAGE_KEY = "codingns.user-app.conversation-scroll";
const STORAGE_SCHEMA_VERSION = 1;
const MAX_TRACKED_SESSIONS = 200;
const MAX_SCROLL_TOP = 10_000_000;

interface PersistedConversationScrollEnvelope {
  schemaVersion: number;
  bySessionId: Record<string, PersistedConversationScrollRecord>;
}

interface PersistedConversationScrollRecord {
  scrollTop: number;
  stickToBottom: boolean;
  lastMessageSignature: string | null;
  updatedAt: number;
}

export interface PersistedConversationScrollState {
  scrollTop: number;
  stickToBottom: boolean;
  lastMessageSignature: string | null;
}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeSessionId(sessionId: string): string {
  return sessionId.trim();
}

function clampScrollTop(scrollTop: number): number {
  if (!Number.isFinite(scrollTop)) {
    return 0;
  }

  if (scrollTop <= 0) {
    return 0;
  }

  return Math.min(Math.round(scrollTop), MAX_SCROLL_TOP);
}

function normalizeRecord(
  record: PersistedConversationScrollRecord | null | undefined
): PersistedConversationScrollRecord | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  return {
    scrollTop: clampScrollTop(record.scrollTop),
    stickToBottom: record.stickToBottom === true,
    lastMessageSignature:
      typeof record.lastMessageSignature === "string" ? record.lastMessageSignature : null,
    updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : 0
  };
}

function readEnvelope(): PersistedConversationScrollEnvelope {
  if (!canUseLocalStorage()) {
    return {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      bySessionId: {}
    };
  }

  const rawValue = window.localStorage.getItem(STORAGE_KEY);

  if (!rawValue) {
    return {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      bySessionId: {}
    };
  }

  try {
    const parsed = JSON.parse(rawValue) as PersistedConversationScrollEnvelope;

    if (
      !parsed
      || typeof parsed !== "object"
      || parsed.schemaVersion !== STORAGE_SCHEMA_VERSION
      || !parsed.bySessionId
      || typeof parsed.bySessionId !== "object"
      || Array.isArray(parsed.bySessionId)
    ) {
      return {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        bySessionId: {}
      };
    }

    const bySessionId = Object.fromEntries(
      Object.entries(parsed.bySessionId)
        .map(([sessionId, record]) => {
          const normalizedRecord = normalizeRecord(record);
          return normalizedRecord ? [sessionId, normalizedRecord] : null;
        })
        .filter((entry): entry is [string, PersistedConversationScrollRecord] => Boolean(entry))
    );

    return {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      bySessionId
    };
  } catch {
    return {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      bySessionId: {}
    };
  }
}

function writeEnvelope(envelope: PersistedConversationScrollEnvelope): void {
  if (!canUseLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // 本地滚动进度丢了不影响主流程，写失败直接忽略。
  }
}

export function readPersistedConversationScrollState(
  sessionId: string
): PersistedConversationScrollState | null {
  const normalizedSessionId = normalizeSessionId(sessionId);

  if (!normalizedSessionId) {
    return null;
  }

  const record = readEnvelope().bySessionId[normalizedSessionId];
  const normalizedRecord = normalizeRecord(record);

  if (!normalizedRecord) {
    return null;
  }

  return {
    scrollTop: normalizedRecord.scrollTop,
    stickToBottom: normalizedRecord.stickToBottom,
    lastMessageSignature: normalizedRecord.lastMessageSignature
  };
}

export function persistConversationScrollState(
  sessionId: string,
  state: PersistedConversationScrollState
): void {
  const normalizedSessionId = normalizeSessionId(sessionId);

  if (!normalizedSessionId) {
    return;
  }

  const nextEnvelope = readEnvelope();
  nextEnvelope.bySessionId[normalizedSessionId] = {
    scrollTop: clampScrollTop(state.scrollTop),
    stickToBottom: state.stickToBottom,
    lastMessageSignature: state.lastMessageSignature,
    updatedAt: Date.now()
  };

  const prunedEntries = Object.entries(nextEnvelope.bySessionId)
    .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
    .slice(0, MAX_TRACKED_SESSIONS);

  nextEnvelope.bySessionId = Object.fromEntries(prunedEntries);
  writeEnvelope(nextEnvelope);
}
