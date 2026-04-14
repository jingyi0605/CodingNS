import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { TerminalRuntimeType } from "../../types/domain.js";
import type { DebugTargetService } from "./debug-target-service.js";

interface AnalyzeDebugTargetBody {
  workspaceId?: string;
  rootPath?: string;
  commandHints?: unknown;
}

interface DebugTargetParams {
  targetId?: string;
}

interface DebugTargetRuntimeHistoryQuery {
  limit?: string;
}

interface RunDebugTargetBody {
  shell?: string;
  runtimeType?: string | null;
}

interface AiFallbackEditParams {
  editId?: string;
}

interface AiFallbackEditBody {
  patchRef?: string | null;
  rollbackRef?: string | null;
}

export class DebugTargetController {
  constructor(private readonly debugTargetService: DebugTargetService) {}

  readonly analyze = async (
    request: FastifyRequest<{ Body: AnalyzeDebugTargetBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = request.body.workspaceId?.trim();
    const rootPath = request.body.rootPath?.trim();

    if (!workspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "分析调试目标必须提供 workspaceId",
        field: "workspaceId"
      });
    }

    if (!rootPath) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "分析调试目标必须提供 rootPath",
        field: "rootPath"
      });
    }

    reply.send(
      this.debugTargetService.analyze({
        workspaceId,
        rootPath,
        commandHints: normalizeCommandHints(request.body.commandHints)
      })
    );
  };

  readonly getFrameworkAnalysis = async (
    request: FastifyRequest<{ Params: DebugTargetParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.debugTargetService.getFrameworkAnalysis(request.params.targetId?.trim() || "")
    );
  };

  readonly refreshFrameworkAnalysis = async (
    request: FastifyRequest<{ Params: DebugTargetParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.debugTargetService.refreshFrameworkAnalysis(request.params.targetId?.trim() || "")
    );
  };

  readonly createLaunchPlan = async (
    request: FastifyRequest<{ Params: DebugTargetParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.debugTargetService.createLaunchPlan(request.params.targetId?.trim() || "")
    );
  };

  readonly run = async (
    request: FastifyRequest<{ Params: DebugTargetParams; Body: RunDebugTargetBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.debugTargetService.run({
        targetId: request.params.targetId?.trim() || "",
        userId: request.auth!.user.userId,
        shell: request.body?.shell?.trim() || undefined,
        runtimeType: normalizeRuntimeType(request.body?.runtimeType)
      })
    );
  };

  readonly getRuntime = async (
    request: FastifyRequest<{ Params: { runtimeId?: string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.debugTargetService.getRuntimeDetail(request.params.runtimeId?.trim() || "")
    );
  };

  readonly getLatestRuntime = async (
    request: FastifyRequest<{ Params: DebugTargetParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.debugTargetService.getLatestRuntimeDetail(request.params.targetId?.trim() || "")
    );
  };

  readonly getRuntimeHistory = async (
    request: FastifyRequest<{ Params: DebugTargetParams; Querystring: DebugTargetRuntimeHistoryQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const rawLimit = request.query.limit?.trim();
    const limit = rawLimit ? Number.parseInt(rawLimit, 10) : 5;

    reply.send(
      await this.debugTargetService.getRecentRuntimeDetails(
        request.params.targetId?.trim() || "",
        Number.isNaN(limit) ? 5 : limit
      )
    );
  };

  readonly getCompatibilityMatrix = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.debugTargetService.getCompatibilityMatrix());
  };

  readonly applyAiFallbackEdit = async (
    request: FastifyRequest<{ Params: AiFallbackEditParams; Body: AiFallbackEditBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.debugTargetService.updateAiFallbackEdit(request.params.editId?.trim() || "", "apply", {
        patchRef: request.body?.patchRef ?? null,
        rollbackRef: request.body?.rollbackRef ?? null
      })
    );
  };

  readonly rejectAiFallbackEdit = async (
    request: FastifyRequest<{ Params: AiFallbackEditParams; Body: AiFallbackEditBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.debugTargetService.updateAiFallbackEdit(request.params.editId?.trim() || "", "reject", {
        patchRef: request.body?.patchRef ?? null,
        rollbackRef: request.body?.rollbackRef ?? null
      })
    );
  };

  readonly rollbackAiFallbackEdit = async (
    request: FastifyRequest<{ Params: AiFallbackEditParams; Body: AiFallbackEditBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.debugTargetService.updateAiFallbackEdit(request.params.editId?.trim() || "", "rollback", {
        patchRef: request.body?.patchRef ?? null,
        rollbackRef: request.body?.rollbackRef ?? null
      })
    );
  };
}

function normalizeCommandHints(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function normalizeRuntimeType(input?: string | null): TerminalRuntimeType | null | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (input === null) {
    return null;
  }

  const value = input.trim();

  if (!value) {
    return null;
  }

  if (
    value === "embedded-pty" ||
    value === "tmux" ||
    value === "conpty-powershell" ||
    value === "conpty-cmd" ||
    value === "conpty-git-bash"
  ) {
    return value;
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail: `不支持的终端 runtimeType：${value}`,
    field: "runtimeType"
  });
}
