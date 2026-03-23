import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { hashContent } from "../../shared/utils/hash.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { FileContextBinding, FileSnapshot } from "../../types/domain.js";
import type { FileContextBindingRepository } from "../../storage/repositories/file-context-binding-repository.js";
import type { SessionRuntimeService } from "../sessions/session-runtime-service.js";

interface AttachFileContextInput {
  sessionId: string;
  workspaceId: string;
  snapshot: FileSnapshot;
  userId: string;
  rangeStart?: number;
  rangeEnd?: number;
}

export class FileContextService {
  constructor(
    private readonly sessionRuntimeService: SessionRuntimeService,
    private readonly fileContextBindingRepository: FileContextBindingRepository
  ) {}

  async attach(input: AttachFileContextInput): Promise<FileContextBinding> {
    const session = await this.sessionRuntimeService.getSession(input.sessionId, input.userId);

    if (session.workspaceId !== input.workspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "SESSION_WORKSPACE_MISMATCH",
        detail: "会话和工作区不匹配，不能挂载文件上下文",
        field: "workspaceId"
      });
    }

    const normalizedRange = normalizeRange(input.snapshot.content, input.rangeStart, input.rangeEnd);
    const contentForHash = normalizedRange
      ? selectContentRange(input.snapshot.content, normalizedRange.rangeStart, normalizedRange.rangeEnd)
      : input.snapshot.content;

    return this.fileContextBindingRepository.create({
      id: createId(),
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      path: input.snapshot.path,
      displayName: path.posix.basename(input.snapshot.path),
      selected: true,
      pinned: false,
      rangeStart: normalizedRange?.rangeStart ?? null,
      rangeEnd: normalizedRange?.rangeEnd ?? null,
      contentHash: hashContent(contentForHash),
      fileVersion: input.snapshot.version,
      attachedBy: input.userId,
      attachedAt: nowIso()
    });
  }

  async list(sessionId: string, userId: string): Promise<FileContextBinding[]> {
    await this.sessionRuntimeService.getSession(sessionId, userId);
    return this.fileContextBindingRepository.listBySession(sessionId);
  }

  async detach(sessionId: string, bindingId: string, userId: string): Promise<{ success: true }> {
    await this.sessionRuntimeService.getSession(sessionId, userId);
    const binding = this.fileContextBindingRepository.findById(bindingId);

    if (!binding || binding.sessionId !== sessionId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "CONTEXT_BINDING_NOT_FOUND",
        detail: "指定文件上下文绑定不存在"
      });
    }

    this.fileContextBindingRepository.delete(bindingId);

    return {
      success: true
    };
  }
}

function normalizeRange(content: string, rangeStart?: number, rangeEnd?: number) {
  if (rangeStart == null && rangeEnd == null) {
    return null;
  }

  if (rangeStart == null || rangeEnd == null) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_RANGE",
      detail: "片段范围必须同时提供起始行和结束行",
      field: "rangeStart"
    });
  }

  const lines = content.split(/\r?\n/);

  if (rangeStart < 1 || rangeEnd < rangeStart || rangeEnd > lines.length) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_RANGE",
      detail: "文件片段范围不合法",
      field: "rangeStart"
    });
  }

  return { rangeStart, rangeEnd };
}

function selectContentRange(content: string, rangeStart: number, rangeEnd: number): string {
  const lines = content.split(/\r?\n/);
  return lines.slice(rangeStart - 1, rangeEnd).join("\n");
}
