import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { TerminalRuntimeType } from "../../types/domain.js";
import type { DebugTargetPortRequest, DebugTargetService } from "./debug-target-service.js";

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

interface DebugTargetPortRequestBodyItem {
  serviceId?: string | null;
  role?: string | null;
  cwd?: string | null;
  name?: string | null;
  command?: string | null;
  port?: number | string | null;
}

interface DebugTargetLaunchPlanBody {
  portRequests?: DebugTargetPortRequestBodyItem[];
}

interface RunDebugTargetBody {
  shell?: string;
  runtimeType?: string | null;
  portRequests?: DebugTargetPortRequestBodyItem[];
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
    request: FastifyRequest<{ Params: DebugTargetParams; Body: DebugTargetLaunchPlanBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.debugTargetService.createLaunchPlan(
        request.params.targetId?.trim() || "",
        normalizePortRequests(request.body?.portRequests),
        request.auth?.user.userId ?? null
      )
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
        runtimeType: normalizeRuntimeType(request.body?.runtimeType),
        portRequests: normalizePortRequests(request.body?.portRequests)
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

function normalizeNullableText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function normalizePortRequests(input: unknown): DebugTargetPortRequest[] {
  if (input === undefined || input === null) {
    return [];
  }

  if (!Array.isArray(input)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "portRequests 必须是数组",
      field: "portRequests"
    });
  }

  return input.map((item, index) => normalizePortRequestItem(item, index));
}

function normalizePortRequestItem(input: unknown, index: number): DebugTargetPortRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `portRequests[${index}] 必须是对象`,
      field: "portRequests"
    });
  }

  const item = input as DebugTargetPortRequestBodyItem;
  const port = normalizePortRequestPort(item.port, index);

  return {
    serviceId: normalizeNullableText(item.serviceId),
    role: normalizePortRequestRole(item.role),
    cwd: normalizeNullableText(item.cwd),
    name: normalizeNullableText(item.name),
    command: normalizeNullableText(item.command),
    port
  };
}

function normalizePortRequestPort(value: number | string | null | undefined, index: number): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);

    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail: `portRequests[${index}].port 必须是整数`,
    field: "portRequests"
  });
}

function normalizePortRequestRole(value?: string | null): DebugTargetPortRequest["role"] {
  const normalized = normalizeNullableText(value);

  if (!normalized) {
    return null;
  }

  if (
    normalized === "frontend"
    || normalized === "backend"
    || normalized === "worker"
    || normalized === "mock"
    || normalized === "custom"
  ) {
    return normalized;
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail: `不支持的调试服务角色：${normalized}`,
    field: "portRequests"
  });
}
