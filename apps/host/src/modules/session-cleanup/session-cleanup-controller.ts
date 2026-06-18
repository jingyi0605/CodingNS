import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { SessionCleanupService } from "./session-cleanup-service.js";

interface SessionCleanupLatestQuery {
  provider?: string;
  startAt?: string;
  endAt?: string;
}

interface SessionCleanupScanBody {
  providers?: string[];
  startAt?: string;
  endAt?: string;
  force?: boolean;
}

interface SessionCleanupBackupBody {
  candidateIds?: string[];
  archivePath?: string;
}

interface SessionCleanupBackupInspectionBody {
  archivePath?: string;
}

interface SessionCleanupRestoreBody {
  archivePath?: string;
  entryIds?: string[];
}

interface SessionCleanupDeleteBody {
  candidateIds?: string[];
}

function requireUserId(request: FastifyRequest): string {
  const userId = request.auth?.user.userId;

  if (!userId) {
    throw new AppError({
      statusCode: 401,
      errorCode: "UNAUTHORIZED",
      detail: "当前请求缺少有效登录态"
    });
  }

  return userId;
}

export class SessionCleanupController {
  constructor(private readonly service: SessionCleanupService) {}

  readonly readLatestScan = async (
    request: FastifyRequest<{ Querystring: SessionCleanupLatestQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const userId = requireUserId(request);
    const latest = this.service.readLatestScan(userId);

    if (!latest) {
      reply.send({
        latestScan: null
      });
      return;
    }

    reply.send({
      latestScan: filterLatestScan(latest, request.query.provider, request.query.startAt, request.query.endAt)
    });
  };

  readonly triggerScan = async (
    request: FastifyRequest<{ Body: SessionCleanupScanBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const userId = requireUserId(request);
    const providers = Array.isArray(request.body.providers) ? request.body.providers : [];
    const handle = this.service.requestScan({
      userId,
      providers,
      startAt: request.body.startAt?.trim() || null,
      endAt: request.body.endAt?.trim() || null,
      force: request.body.force === true
    });
    observeBackgroundTask(handle, "session_cleanup.scan");

    reply.send({
      taskId: handle.taskId,
      taskType: handle.taskType,
      key: handle.key,
      deduped: handle.deduped
    });
  };

  readonly triggerBackup = async (
    request: FastifyRequest<{ Body: SessionCleanupBackupBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const userId = requireUserId(request);
    const candidateIds = Array.isArray(request.body.candidateIds) ? request.body.candidateIds : [];
    const archivePath = request.body.archivePath?.trim() || "";

    if (candidateIds.length === 0 || !archivePath) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "备份请求缺少候选或目标路径"
      });
    }

    const handle = this.service.requestBackup({
      userId,
      candidateIds,
      archivePath
    });
    observeBackgroundTask(handle, "session_cleanup.backup");

    reply.send({
      taskId: handle.taskId,
      taskType: handle.taskType,
      key: handle.key,
      deduped: handle.deduped
    });
  };

  readonly inspectBackup = async (
    request: FastifyRequest<{ Body: SessionCleanupBackupInspectionBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    const archivePath = request.body.archivePath?.trim() || "";

    if (!archivePath) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "缺少备份文件路径"
      });
    }

    const inspection = await this.service.inspectArchive(archivePath);
    reply.send(inspection);
  };

  readonly triggerRestore = async (
    request: FastifyRequest<{ Body: SessionCleanupRestoreBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const userId = requireUserId(request);
    const archivePath = request.body.archivePath?.trim() || "";
    const entryIds = Array.isArray(request.body.entryIds) ? request.body.entryIds : [];

    if (!archivePath || entryIds.length === 0) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "恢复请求缺少备份路径或条目"
      });
    }

    const handle = this.service.requestRestore({
      userId,
      archivePath,
      entryIds
    });
    observeBackgroundTask(handle, "session_cleanup.restore");

    reply.send({
      taskId: handle.taskId,
      taskType: handle.taskType,
      key: handle.key,
      deduped: handle.deduped
    });
  };

  readonly triggerDelete = async (
    request: FastifyRequest<{ Body: SessionCleanupDeleteBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const userId = requireUserId(request);
    const candidateIds = Array.isArray(request.body.candidateIds) ? request.body.candidateIds : [];

    if (candidateIds.length === 0) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "删除请求缺少候选条目"
      });
    }

    const handle = this.service.requestDelete({
      userId,
      candidateIds
    });
    observeBackgroundTask(handle, "session_cleanup.delete");

    reply.send({
      taskId: handle.taskId,
      taskType: handle.taskType,
      key: handle.key,
      deduped: handle.deduped
    });
  };

  readonly readLatestDeleteTask = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const userId = requireUserId(request);
    reply.send({
      latestDeleteTask: this.service.readLatestDeleteSummary(userId)
    });
  };

  readonly readDeleteTaskDetail = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const userId = requireUserId(request);
    reply.send({
      deleteTask: this.service.readDeleteTaskDetail(userId)
    });
  };

  readonly purgeButlerResidue = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    requireUserId(request);
    const result = await this.service.purgeButlerResidue();

    reply.send({
      success: true,
      deleted: result
    });
  };
}

function observeBackgroundTask(
  handle: {
    promise: Promise<unknown>;
    taskId: string;
    taskType: string;
    key: string;
  },
  source: string
): void {
  void handle.promise.catch((error) => {
    console.error(`[session-cleanup-controller] background task failed: ${source}`, {
      taskId: handle.taskId,
      taskType: handle.taskType,
      key: handle.key,
      error: error instanceof Error ? error.message : String(error)
    });
  });
}

function filterLatestScan(
  latest: NonNullable<ReturnType<SessionCleanupService["readLatestScan"]>>,
  provider: string | undefined,
  startAt: string | undefined,
  endAt: string | undefined
) {
  const summary = latest.summary;
  const candidates = Array.isArray(summary?.candidates) ? summary.candidates : [];
  const providerFilter = provider?.trim() || null;
  const startMs = parseOptionalDate(startAt?.trim() || null);
  const endMs = parseOptionalDate(endAt?.trim() || null);

  const filtered = candidates.filter((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return false;
    }

    const record = candidate as {
      provider?: string;
      startedAt?: string | null;
      lastMessageAt?: string | null;
    };

    if (providerFilter && record.provider !== providerFilter) {
      return false;
    }

    const pivot = parseOptionalDate(record.lastMessageAt ?? record.startedAt ?? null);

    if (startMs !== null && (pivot === null || pivot < startMs)) {
      return false;
    }

    if (endMs !== null && (pivot === null || pivot > endMs)) {
      return false;
    }

    return true;
  });

  return {
    ...latest,
    candidateCount: filtered.length,
    summary: {
      ...(summary ?? {}),
      candidates: filtered
    }
  };
}

function parseOptionalDate(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
