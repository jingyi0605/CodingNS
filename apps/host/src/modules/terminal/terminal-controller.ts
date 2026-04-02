import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { TerminalRuntimeType } from "../../types/domain.js";
import { listTerminalShellOptions } from "./terminal-shell.js";
import type { CommandTemplateService } from "./command-template-service.js";
import type { TerminalService } from "./terminal-service.js";

interface TerminalListQuery {
  workspaceId?: string;
}

interface TerminalParams {
  terminalId: string;
}

interface TerminalHistoryQuery {
  beforeSeq?: string;
  limit?: string;
}

interface CommandTemplateParams {
  templateId: string;
}

interface CreateTerminalBody {
  workspaceId?: string;
  name?: string;
  cwd?: string;
  shell?: string;
  runtimeType?: string;
}

interface TerminalInputBody {
  content?: string;
}

interface CommandTemplateBody {
  workspaceId?: string;
  name?: string;
  cwd?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  port?: number | null;
  proxyEnabled?: boolean;
  runtimeType?: string | null;
}

interface TemplateListQuery {
  workspaceId?: string;
}

interface RunTemplateBody {
  terminalId?: string;
  shell?: string;
  runtimeType?: string;
}

export class TerminalController {
  constructor(
    private readonly terminalService: TerminalService,
    private readonly commandTemplateService: CommandTemplateService
  ) {}

  readonly listTerminals = async (
    request: FastifyRequest<{ Querystring: TerminalListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = request.query.workspaceId?.trim();

    if (!workspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "查询终端必须提供 workspaceId",
        field: "workspaceId"
      });
    }

    reply.send({
      items: await this.terminalService.listTerminals(workspaceId)
    });
  };

  readonly createTerminal = async (
    request: FastifyRequest<{ Body: CreateTerminalBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = request.body.workspaceId?.trim();

    if (!workspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "创建终端必须提供 workspaceId",
        field: "workspaceId"
      });
    }

    const terminal = await this.terminalService.createTerminal({
      workspaceId,
      name: request.body.name?.trim(),
      cwd: request.body.cwd?.trim(),
      shell: request.body.shell?.trim(),
      runtimeType: normalizeRuntimeType(request.body.runtimeType),
      createdByUserId: request.auth!.user.userId
    });

    reply.status(201).send(terminal);
  };

  readonly listShellOptions = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.send({
      items: listTerminalShellOptions()
    });
  };

  readonly closeTerminal = async (
    request: FastifyRequest<{ Params: TerminalParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.terminalService.closeTerminal(request.params.terminalId));
  };

  readonly deleteTerminal = async (
    request: FastifyRequest<{ Params: TerminalParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.terminalService.deleteTerminal(request.params.terminalId));
  };

  readonly readHistory = async (
    request: FastifyRequest<{ Params: TerminalParams; Querystring: TerminalHistoryQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const beforeSeq = normalizeOptionalInteger(request.query.beforeSeq, "beforeSeq");
    const limit = normalizePositiveInteger(request.query.limit, 20, 100, "limit");

    reply.send(await this.terminalService.readTerminalHistory(request.params.terminalId, beforeSeq, limit));
  };

  readonly writeInput = async (
    request: FastifyRequest<{ Params: TerminalParams; Body: TerminalInputBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const content = request.body.content;

    if (typeof content !== "string") {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "终端输入必须提供 content",
        field: "content"
      });
    }

    reply.send(await this.terminalService.writeInput(request.params.terminalId, content));
  };

  readonly listTemplates = async (
    request: FastifyRequest<{ Querystring: TemplateListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = request.query.workspaceId?.trim();

    if (!workspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "查询命令模板必须提供 workspaceId",
        field: "workspaceId"
      });
    }

    reply.send({
      items: this.commandTemplateService.listTemplates(workspaceId)
    });
  };

  readonly listTemplateRuntimeStatuses = async (
    request: FastifyRequest<{ Querystring: TemplateListQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = request.query.workspaceId?.trim();

    if (!workspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "查询命令模板运行状态必须提供 workspaceId",
        field: "workspaceId"
      });
    }

    reply.send({
      items: await this.commandTemplateService.listTemplateRuntimeStatuses(workspaceId)
    });
  };

  readonly createTemplate = async (
    request: FastifyRequest<{ Body: CommandTemplateBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = request.body.workspaceId?.trim();

    if (!workspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "创建命令模板必须提供 workspaceId",
        field: "workspaceId"
      });
    }

    const template = this.commandTemplateService.createTemplate({
      workspaceId,
      name: request.body.name,
      cwd: request.body.cwd,
      command: request.body.command,
      args: normalizeArgs(request.body.args),
      env: request.body.env,
      port: normalizePort(request.body.port),
      proxyEnabled: normalizeProxyEnabled(request.body.proxyEnabled),
      runtimeType: normalizeRuntimeType(request.body.runtimeType)
    });

    reply.status(201).send(template);
  };

  readonly updateTemplate = async (
    request: FastifyRequest<{ Params: CommandTemplateParams; Body: CommandTemplateBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.commandTemplateService.updateTemplate(request.params.templateId, {
        workspaceId: request.body.workspaceId,
        name: request.body.name,
        cwd: request.body.cwd,
        command: request.body.command,
        args: normalizeArgs(request.body.args),
        env: request.body.env,
        port: normalizePort(request.body.port),
        proxyEnabled: normalizeProxyEnabled(request.body.proxyEnabled),
        runtimeType: normalizeRuntimeType(request.body.runtimeType)
      })
    );
  };

  readonly deleteTemplate = async (
    request: FastifyRequest<{ Params: CommandTemplateParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.commandTemplateService.deleteTemplate(request.params.templateId));
  };

  readonly runTemplate = async (
    request: FastifyRequest<{ Params: CommandTemplateParams; Body: RunTemplateBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      await this.commandTemplateService.runTemplate({
        templateId: request.params.templateId,
        terminalId: request.body.terminalId?.trim(),
        shell: request.body.shell?.trim(),
        runtimeType: normalizeRuntimeType(request.body.runtimeType),
        userId: request.auth!.user.userId
      })
    );
  };

  readonly stopTemplateRuntimeProcess = async (
    request: FastifyRequest<{ Params: CommandTemplateParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(await this.commandTemplateService.stopTemplateRuntimeProcess(request.params.templateId));
  };
}

function normalizeArgs(input?: string[]): string[] {
  if (!input) {
    return [];
  }

  if (!Array.isArray(input) || input.some((item) => typeof item !== "string")) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "args 必须是字符串数组",
      field: "args"
    });
  }

  return input;
}

function normalizeRuntimeType(
  input?: string | null
): TerminalRuntimeType | null | undefined {
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

function normalizePort(input?: number | null): number | null | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (input === null) {
    return null;
  }

  if (!Number.isInteger(input)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "port 必须是整数",
      field: "port"
    });
  }

  return input;
}

function normalizeProxyEnabled(input?: boolean): boolean | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input !== "boolean") {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "proxyEnabled 必须是布尔值",
      field: "proxyEnabled"
    });
  }

  return input;
}

function normalizeOptionalInteger(input: string | undefined, field: string): number | null {
  if (input === undefined || input.trim() === "") {
    return null;
  }

  const value = Number(input);

  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 必须是正整数`,
      field
    });
  }

  return value;
}

function normalizePositiveInteger(
  input: string | undefined,
  fallback: number,
  max: number,
  field: string
): number {
  if (input === undefined || input.trim() === "") {
    return fallback;
  }

  const value = Number(input);

  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 必须是正整数`,
      field
    });
  }

  return Math.min(value, max);
}
