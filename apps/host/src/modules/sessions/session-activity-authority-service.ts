import { nowIso } from "../../shared/utils/time.js";
import type {
  SessionActivityConfidence,
  SessionActivityResolutionSource,
  SessionListItem,
  SessionResolvedRunningState,
  SessionRunningState
} from "../../types/domain.js";

type ObservableRunningState =
  | SessionRunningState
  | "idle"
  | "unknown";

export interface SessionActivityObservation {
  sessionId: string;
  runId: string | null;
  runningState: ObservableRunningState;
  source: SessionActivityResolutionSource;
  confidence: SessionActivityConfidence;
  detail: string | null;
  errorCode: string | null;
  observedAt: string;
}

export interface SessionActivityResolution {
  sessionId: string;
  runId: string | null;
  runningState: SessionResolvedRunningState;
  activityResolutionSource: SessionActivityResolutionSource;
  activityConfidence: SessionActivityConfidence;
  detail: string | null;
  errorCode: string | null;
  lastObservedAt: string | null;
  terminalAt: string | null;
  watchdogTriggeredAt: string | null;
  updatedAt: string;
}

type SessionActivityResolutionListener = (resolution: SessionActivityResolution) => void | Promise<void>;

interface SessionActivityAuthorityOptions {
  staleAfterMs?: number;
  unknownAfterMs?: number;
}

const DEFAULT_STALE_AFTER_MS = 30_000;
const DEFAULT_UNKNOWN_AFTER_MS = 90_000;

export class SessionActivityAuthorityService {
  private readonly resolutions = new Map<string, SessionActivityResolution>();
  private readonly listeners = new Map<string, Set<SessionActivityResolutionListener>>();
  private readonly staleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly unknownTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly staleAfterMs: number;
  private readonly unknownAfterMs: number;

  constructor(options: SessionActivityAuthorityOptions = {}) {
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.unknownAfterMs = options.unknownAfterMs ?? DEFAULT_UNKNOWN_AFTER_MS;
  }

  observe(observation: SessionActivityObservation): SessionActivityResolution {
    const current = this.resolutions.get(observation.sessionId) ?? null;
    const next = mergeResolution(current, observation);

    this.resolutions.set(observation.sessionId, next);
    this.syncWatchdog(next);
    this.publishIfChanged(observation.sessionId, current, next);
    return next;
  }

  resolvePersistedSession(session: Pick<
    SessionListItem,
    "sessionId" | "runningState" | "activitySource" | "lastEventAt" | "completedAt" | "lastErrorCode" | "lastErrorDetail"
  >): SessionActivityResolution {
    const current = this.resolutions.get(session.sessionId) ?? null;

    if (current && isResolutionMoreTrustworthyThanPersisted(current, session)) {
      this.syncWatchdog(current);
      return current;
    }

    const next = createPersistedResolution(session);
    this.resolutions.set(session.sessionId, next);
    this.syncWatchdog(next);
    this.publishIfChanged(session.sessionId, current, next);
    return next;
  }

  getResolution(sessionId: string): SessionActivityResolution | null {
    return this.resolutions.get(sessionId) ?? null;
  }

  subscribe(
    sessionId: string,
    listener: SessionActivityResolutionListener
  ): { close(): void } {
    const listeners = this.listeners.get(sessionId) ?? new Set<SessionActivityResolutionListener>();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    let closed = false;

    return {
      close: () => {
        if (closed) {
          return;
        }

        closed = true;
        const currentListeners = this.listeners.get(sessionId);

        if (!currentListeners) {
          return;
        }

        currentListeners.delete(listener);

        if (currentListeners.size === 0) {
          this.listeners.delete(sessionId);
        }
      }
    };
  }

  clearSession(sessionId: string): void {
    this.clearWatchdogTimers(sessionId);
    this.resolutions.delete(sessionId);
    this.listeners.delete(sessionId);
  }

  dispose(): void {
    for (const sessionId of this.staleTimers.keys()) {
      this.clearWatchdogTimers(sessionId);
    }

    this.resolutions.clear();
    this.listeners.clear();
  }

  private syncWatchdog(resolution: SessionActivityResolution): void {
    this.clearWatchdogTimers(resolution.sessionId);

    if (
      resolution.activityResolutionSource !== "authoritative_runtime"
      || (resolution.runningState !== "starting" && resolution.runningState !== "running")
    ) {
      return;
    }

    const observedAtMs = Date.parse(resolution.lastObservedAt ?? resolution.updatedAt);

    if (!Number.isFinite(observedAtMs)) {
      return;
    }

    const staleDelayMs = Math.max(0, observedAtMs + this.staleAfterMs - Date.now());
    const unknownDelayMs = Math.max(0, observedAtMs + this.unknownAfterMs - Date.now());

    this.staleTimers.set(
      resolution.sessionId,
      setTimeout(() => {
        this.promoteWatchdogState(resolution.sessionId, resolution.runId, "stale");
      }, staleDelayMs)
    );
    this.unknownTimers.set(
      resolution.sessionId,
      setTimeout(() => {
        this.promoteWatchdogState(resolution.sessionId, resolution.runId, "unknown");
      }, unknownDelayMs)
    );
  }

  private promoteWatchdogState(
    sessionId: string,
    runId: string | null,
    runningState: Extract<SessionResolvedRunningState, "stale" | "unknown">
  ): void {
    const current = this.resolutions.get(sessionId);

    if (
      !current
      || current.activityResolutionSource !== "authoritative_runtime"
      || current.runId !== runId
      || (current.runningState !== "starting" && current.runningState !== "running" && current.runningState !== "stale")
    ) {
      return;
    }

    const watchdogTriggeredAt = nowIso();
    const next: SessionActivityResolution = {
      ...current,
      runningState,
      activityConfidence: runningState === "stale" ? "strong" : "weak",
      detail:
        runningState === "stale"
          ? "Host 仍持有这轮运行，但长时间没有收到新事件，状态待确认"
          : "当前无法确认这轮运行是否仍然活动",
      watchdogTriggeredAt,
      updatedAt: watchdogTriggeredAt
    };

    this.resolutions.set(sessionId, next);
    this.publishIfChanged(sessionId, current, next);

    if (runningState === "stale") {
      const unknownTimer = this.unknownTimers.get(sessionId);

      if (!unknownTimer) {
        this.unknownTimers.set(
          sessionId,
          setTimeout(() => {
            this.promoteWatchdogState(sessionId, runId, "unknown");
          }, Math.max(0, this.unknownAfterMs - this.staleAfterMs))
        );
      }

      return;
    }

    this.clearWatchdogTimers(sessionId);
  }

  private clearWatchdogTimers(sessionId: string): void {
    const staleTimer = this.staleTimers.get(sessionId);

    if (staleTimer) {
      clearTimeout(staleTimer);
      this.staleTimers.delete(sessionId);
    }

    const unknownTimer = this.unknownTimers.get(sessionId);

    if (unknownTimer) {
      clearTimeout(unknownTimer);
      this.unknownTimers.delete(sessionId);
    }
  }

  private publishIfChanged(
    sessionId: string,
    previous: SessionActivityResolution | null,
    next: SessionActivityResolution
  ): void {
    if (previous && areResolutionsEqual(previous, next)) {
      return;
    }

    const listeners = this.listeners.get(sessionId);

    if (!listeners || listeners.size === 0) {
      return;
    }

    for (const listener of listeners) {
      void listener(next);
    }
  }
}

function mergeResolution(
  current: SessionActivityResolution | null,
  observation: SessionActivityObservation
): SessionActivityResolution {
  const next = resolutionFromObservation(observation);

  if (!current) {
    return next;
  }

  if (isNewerRun(current.runId, next.runId)) {
    return next;
  }

  if (shouldPreferExplicitTerminalObservation(current, next)) {
    return next;
  }

  if (current.runId && !next.runId && isHigherPriority(current, next)) {
    return current;
  }

  if (sameRun(current.runId, next.runId)) {
    if (isTerminalResolvedState(current.runningState) && !isTerminalResolvedState(next.runningState)) {
      return current;
    }

    if (!isTerminalResolvedState(current.runningState) && isTerminalResolvedState(next.runningState)) {
      return next;
    }

    if (shouldPreserveWatchdogDegradedRuntimeState(current, next)) {
      return current;
    }

    if (shouldAllowUnknownIdleToClearInferredActivity(current, next)) {
      return pickLaterResolution(current, next);
    }

    if (isHigherPriority(current, next)) {
      return current;
    }

    if (isHigherPriority(next, current)) {
      return next;
    }
  }

  return pickLaterResolution(current, next);
}

function resolutionFromObservation(observation: SessionActivityObservation): SessionActivityResolution {
  const observedAt = observation.observedAt;
  const isTerminal = isTerminalObservedState(observation.runningState);

  return {
    sessionId: observation.sessionId,
    runId: observation.runId,
    runningState: observation.runningState,
    activityResolutionSource: observation.source,
    activityConfidence: observation.confidence,
    detail: observation.detail,
    errorCode: observation.errorCode,
    lastObservedAt: observedAt,
    terminalAt: isTerminal ? observedAt : null,
    watchdogTriggeredAt: null,
    updatedAt: observedAt
  };
}

function createPersistedResolution(
  session: Pick<
    SessionListItem,
    "sessionId" | "runningState" | "activitySource" | "lastEventAt" | "completedAt" | "lastErrorCode" | "lastErrorDetail"
  >
): SessionActivityResolution {
  const activityResolutionSource = mapLegacyActivitySource(session.activitySource, session.runningState);
  const activityConfidence = mapPersistedConfidence(activityResolutionSource, session.runningState);
  const runningState = mapPersistedRunningState(session.runningState, activityResolutionSource);
  const terminalAt =
    runningState === "completed" || runningState === "interrupted" || runningState === "failed"
      ? session.completedAt ?? session.lastEventAt
      : null;
  const detail = runningState === "failed" ? session.lastErrorDetail : null;
  const errorCode = runningState === "failed" ? session.lastErrorCode : null;
  const updatedAt = session.lastEventAt ?? terminalAt ?? nowIso();

  return {
    sessionId: session.sessionId,
    runId: null,
    runningState,
    activityResolutionSource,
    activityConfidence,
    detail,
    errorCode,
    lastObservedAt: session.lastEventAt,
    terminalAt,
    watchdogTriggeredAt: null,
    updatedAt
  };
}

function isResolutionMoreTrustworthyThanPersisted(
  current: SessionActivityResolution,
  session: Pick<SessionListItem, "activitySource" | "runningState" | "lastEventAt" | "completedAt">
): boolean {
  const persistedResolution = createPersistedResolution({
    sessionId: current.sessionId,
    runningState: session.runningState,
    activitySource: session.activitySource,
    lastEventAt: session.lastEventAt,
    completedAt: session.completedAt,
    lastErrorCode: null,
    lastErrorDetail: null
  });
  const persistedSource = mapLegacyActivitySource(session.activitySource, session.runningState);
  const persistedObservedAt = session.completedAt ?? session.lastEventAt ?? null;

  if (
    current.activityResolutionSource === "authoritative_provider_event"
    && persistedSource === "authoritative_runtime"
    && (!persistedObservedAt || current.updatedAt.localeCompare(persistedObservedAt) >= 0)
  ) {
    return true;
  }

  if (sourcePriority(current.activityResolutionSource) !== sourcePriority(persistedSource)) {
    return sourcePriority(current.activityResolutionSource) > sourcePriority(persistedSource);
  }

  if (confidencePriority(current.activityConfidence) !== confidencePriority(persistedResolution.activityConfidence)) {
    return confidencePriority(current.activityConfidence) > confidencePriority(persistedResolution.activityConfidence);
  }

  return compareIsoTimestamps(current.updatedAt, persistedResolution.updatedAt) >= 0;
}

function mapLegacyActivitySource(
  activitySource: SessionListItem["activitySource"],
  runningState: SessionListItem["runningState"]
): SessionActivityResolutionSource {
  if (activitySource === "runtime") {
    return "authoritative_runtime";
  }

  if (activitySource === "inferred") {
    return "inferred_log";
  }

  return runningState ? "unknown" : "unknown";
}

function mapPersistedRunningState(
  runningState: SessionListItem["runningState"],
  source: SessionActivityResolutionSource
): SessionResolvedRunningState {
  if (runningState) {
    return runningState;
  }

  return source === "unknown" ? "unknown" : "idle";
}

function mapPersistedConfidence(
  source: SessionActivityResolutionSource,
  runningState: SessionListItem["runningState"]
): SessionActivityConfidence {
  if (source === "authoritative_runtime") {
    return runningState === "completed" || runningState === "interrupted" || runningState === "failed"
      ? "strong"
      : "authoritative";
  }

  if (source === "inferred_log") {
    return "weak";
  }

  return "weak";
}

function mapPersistedConfidencePriority(source: SessionActivityResolutionSource): number {
  if (source === "authoritative_runtime") {
    return confidencePriority("authoritative");
  }

  if (source === "authoritative_provider_event") {
    return confidencePriority("strong");
  }

  return confidencePriority("weak");
}

function isNewerRun(currentRunId: string | null, nextRunId: string | null): boolean {
  if (!nextRunId || nextRunId === currentRunId) {
    return false;
  }

  if (!currentRunId) {
    return true;
  }

  return nextRunId.localeCompare(currentRunId) > 0;
}

function sameRun(left: string | null, right: string | null): boolean {
  return left === right;
}

function shouldAllowUnknownIdleToClearInferredActivity(
  current: SessionActivityResolution,
  next: SessionActivityResolution
): boolean {
  return current.activityResolutionSource === "inferred_log"
    && next.activityResolutionSource === "unknown"
    && current.runningState === "running"
    && next.runningState === "idle";
}

function shouldPreserveWatchdogDegradedRuntimeState(
  current: SessionActivityResolution,
  next: SessionActivityResolution
): boolean {
  return current.activityResolutionSource === "authoritative_runtime"
    && next.activityResolutionSource === "authoritative_runtime"
    && (current.runningState === "stale" || current.runningState === "unknown")
    && (next.runningState === "starting" || next.runningState === "running")
    && compareIsoTimestamps(next.lastObservedAt, current.lastObservedAt) <= 0;
}

function shouldPreferExplicitTerminalObservation(
  current: SessionActivityResolution,
  next: SessionActivityResolution
): boolean {
  if (isTerminalResolvedState(current.runningState) || !isTerminalResolvedState(next.runningState)) {
    return false;
  }

  if (
    current.activityResolutionSource !== "authoritative_runtime"
    && current.activityResolutionSource !== "authoritative_provider_event"
  ) {
    return false;
  }

  const currentObservedAt = current.lastObservedAt ?? current.updatedAt;
  const nextObservedAt = next.terminalAt ?? next.lastObservedAt ?? next.updatedAt;

  if (compareIsoTimestamps(nextObservedAt, currentObservedAt) < 0) {
    return false;
  }

  return next.activityResolutionSource === "authoritative_provider_event"
    || next.activityResolutionSource === "inferred_log";
}

function isHigherPriority(
  left: Pick<SessionActivityResolution, "activityResolutionSource" | "activityConfidence">,
  right: Pick<SessionActivityResolution, "activityResolutionSource" | "activityConfidence">
): boolean {
  const leftSourcePriority = sourcePriority(left.activityResolutionSource);
  const rightSourcePriority = sourcePriority(right.activityResolutionSource);

  if (leftSourcePriority !== rightSourcePriority) {
    return leftSourcePriority > rightSourcePriority;
  }

  return confidencePriority(left.activityConfidence) > confidencePriority(right.activityConfidence);
}

function pickLaterResolution(
  left: SessionActivityResolution,
  right: SessionActivityResolution
): SessionActivityResolution {
  return (left.updatedAt.localeCompare(right.updatedAt) >= 0) ? left : right;
}

function areResolutionsEqual(
  left: SessionActivityResolution,
  right: SessionActivityResolution
): boolean {
  return left.sessionId === right.sessionId
    && left.runId === right.runId
    && left.runningState === right.runningState
    && left.activityResolutionSource === right.activityResolutionSource
    && left.activityConfidence === right.activityConfidence
    && left.detail === right.detail
    && left.errorCode === right.errorCode
    && left.lastObservedAt === right.lastObservedAt
    && left.terminalAt === right.terminalAt
    && left.watchdogTriggeredAt === right.watchdogTriggeredAt
    && left.updatedAt === right.updatedAt;
}

function compareIsoTimestamps(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }

  if (!left) {
    return -1;
  }

  if (!right) {
    return 1;
  }

  return left.localeCompare(right);
}

function sourcePriority(source: SessionActivityResolutionSource): number {
  if (source === "authoritative_runtime") {
    return 4;
  }

  if (source === "authoritative_provider_event") {
    return 3;
  }

  if (source === "inferred_log") {
    return 2;
  }

  return 1;
}

function confidencePriority(confidence: SessionActivityConfidence): number {
  if (confidence === "authoritative") {
    return 3;
  }

  if (confidence === "strong") {
    return 2;
  }

  return 1;
}

function isTerminalObservedState(
  state: ObservableRunningState
): state is Extract<ObservableRunningState, "completed" | "interrupted" | "failed"> {
  return state === "completed" || state === "interrupted" || state === "failed";
}

function isTerminalResolvedState(
  state: SessionResolvedRunningState
): state is Extract<SessionResolvedRunningState, "completed" | "interrupted" | "failed"> {
  return state === "completed" || state === "interrupted" || state === "failed";
}
