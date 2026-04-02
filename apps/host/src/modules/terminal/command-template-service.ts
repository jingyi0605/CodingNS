import { randomBytes } from "node:crypto";

import type Database from "better-sqlite3";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { TerminalCommandTemplate, TerminalRuntimeType } from "../../types/domain.js";
import type { TerminalCommandTemplateRepository } from "../../storage/repositories/terminal-command-template-repository.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import { resolveWorkspaceCwd } from "./terminal-paths.js";
import { buildTemplateCommandLine, getShellEnterSequence } from "./terminal-shell.js";
import type { TerminalService } from "./terminal-service.js";
import {
  discoverTemplateRuntimeStatuses,
  terminateRuntimeProcess
} from "./template-port-runtime.js";

interface UpsertCommandTemplateInput {
  workspaceId?: string;
  name?: string;
  cwd?: string | null;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  port?: number | null;
  proxyEnabled?: boolean;
  runtimeType?: TerminalRuntimeType | null;
}

interface RunCommandTemplateInput {
  templateId: string;
  terminalId?: string;
  shell?: string;
  runtimeType?: TerminalRuntimeType | null;
  userId: string;
}

interface CommandTemplateDraft
  extends Omit<TerminalCommandTemplate, "name" | "command"> {
  name?: string;
  command?: string;
}

export class CommandTemplateService {
  constructor(
    private readonly db: Database.Database,
    private readonly templateRepository: TerminalCommandTemplateRepository,
    private readonly workspaceService: WorkspaceService,
    private readonly terminalService: TerminalService
  ) {}

  listTemplates(workspaceId: string): TerminalCommandTemplate[] {
    this.workspaceService.getWorkspaceOrThrow(workspaceId);
    return this.templateRepository.listByWorkspace(workspaceId);
  }

  async listTemplateRuntimeStatuses(workspaceId: string) {
    const templates = this.listTemplates(workspaceId)
      .filter((template) => template.port !== null)
      .map((template) => ({
        templateId: template.id,
        port: template.port as number
      }));

    return await discoverTemplateRuntimeStatuses(templates);
  }

  async stopTemplateRuntimeProcess(templateId: string): Promise<{
    success: true;
    processId: number | null;
    alreadyStopped: boolean;
  }> {
    const template = this.getTemplateOrThrow(templateId);

    if (template.port === null) {
      throw new AppError({
        statusCode: 400,
        errorCode: "COMMAND_TEMPLATE_INVALID",
        detail: "当前启动项没有配置端口，无法自动结束进程",
        field: "port"
      });
    }

    const [runtimeStatus] = await discoverTemplateRuntimeStatuses([
      {
        templateId: template.id,
        port: template.port
      }
    ]);

    if (!runtimeStatus?.occupied || runtimeStatus.processId === null) {
      return {
        success: true,
        processId: null,
        alreadyStopped: true
      };
    }

    await terminateRuntimeProcess(runtimeStatus.processId);

    return {
      success: true,
      processId: runtimeStatus.processId,
      alreadyStopped: false
    };
  }

  getTemplateByProxySlug(proxySlug: string): TerminalCommandTemplate | null {
    const normalized = normalizeProxySlug(proxySlug);

    if (!normalized) {
      return null;
    }

    const template = this.templateRepository.findByProxySlug(normalized);

    if (!template?.proxyEnabled || !template.proxySlug) {
      return null;
    }

    return template;
  }

  createTemplate(input: UpsertCommandTemplateInput): TerminalCommandTemplate {
    const workspace = this.workspaceService.getWorkspaceOrThrow(input.workspaceId ?? "");
    const timestamp = nowIso();
    const port = normalizePort(input.port);
    const proxyEnabled = normalizeProxyEnabled(input.proxyEnabled);
    const proxySlug = this.resolveProxySlug({
      previousProxyEnabled: false,
      previousProxySlug: null,
      nextProxyEnabled: proxyEnabled,
      nextPort: port
    });
    const template = buildValidatedTemplate({
      id: createId(),
      workspaceId: workspace.id,
      name: input.name,
      cwd: resolveTemplateCwd(workspace.path, input.cwd),
      command: input.command,
      args: input.args ?? [],
      env: input.env ?? {},
      port,
      proxyEnabled,
      proxySlug,
      runtimeType: normalizeTemplateRuntimeType(input.runtimeType),
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const persist = this.db.transaction(() => {
      this.templateRepository.create(template);
    });

    try {
      persist();
    } catch (error) {
      throw mapTemplateStorageError(error);
    }

    return template;
  }

  updateTemplate(templateId: string, input: UpsertCommandTemplateInput): TerminalCommandTemplate {
    const current = this.getTemplateOrThrow(templateId);
    const workspace = this.workspaceService.getWorkspaceOrThrow(current.workspaceId);
    const nextPort = input.port === undefined ? current.port : normalizePort(input.port);
    const nextProxyEnabled =
      input.proxyEnabled === undefined ? current.proxyEnabled : normalizeProxyEnabled(input.proxyEnabled);
    const nextProxySlug = this.resolveProxySlug({
      previousProxyEnabled: current.proxyEnabled,
      previousProxySlug: current.proxySlug,
      nextProxyEnabled,
      nextPort
    });
    const next = buildValidatedTemplate({
      ...current,
      name: input.name ?? current.name,
      cwd: resolveTemplateCwd(workspace.path, input.cwd ?? current.cwd),
      command: input.command ?? current.command,
      args: input.args ?? current.args,
      env: input.env ?? current.env,
      port: nextPort,
      proxyEnabled: nextProxyEnabled,
      proxySlug: nextProxySlug,
      runtimeType:
        input.runtimeType === undefined
          ? current.runtimeType
          : normalizeTemplateRuntimeType(input.runtimeType),
      updatedAt: nowIso()
    });

    try {
      this.templateRepository.update(next);
    } catch (error) {
      throw mapTemplateStorageError(error);
    }

    return next;
  }

  deleteTemplate(templateId: string): { success: true } {
    this.getTemplateOrThrow(templateId);
    this.templateRepository.delete(templateId);
    return { success: true };
  }

  async runTemplate(input: RunCommandTemplateInput): Promise<{
    terminalId: string;
    templateId: string;
    createdTerminal: boolean;
  }> {
    const template = this.getTemplateOrThrow(input.templateId);
    let targetTerminalId = input.terminalId ?? null;
    let createdTerminal = false;

    if (targetTerminalId) {
      const terminal = this.terminalService.getTerminalOrThrow(targetTerminalId);

      if (terminal.workspaceId !== template.workspaceId) {
        throw new AppError({
          statusCode: 400,
          errorCode: "COMMAND_TEMPLATE_INVALID",
          detail: "命令模板只能在所属工作区的终端中执行",
          field: "terminalId"
        });
      }
    } else {
      const terminal = await this.terminalService.createTerminal({
        workspaceId: template.workspaceId,
        name: `${template.name} 运行`,
        cwd: template.cwd,
        shell: input.shell,
        runtimeType: input.runtimeType ?? template.runtimeType ?? undefined,
        createdByUserId: input.userId,
        env: template.env
      });

      targetTerminalId = terminal.id;
      createdTerminal = true;
    }

    const terminal = this.terminalService.getTerminalOrThrow(targetTerminalId);
    const commandLine = buildTemplateCommandLine(template, terminal.shell);

    await this.terminalService.writeInput(
      targetTerminalId,
      `${commandLine}${getShellEnterSequence(terminal.shell)}`
    );

    return {
      terminalId: targetTerminalId,
      templateId: template.id,
      createdTerminal
    };
  }

  private getTemplateOrThrow(templateId: string): TerminalCommandTemplate {
    const template = this.templateRepository.findById(templateId);

    if (!template) {
      throw new AppError({
        statusCode: 404,
        errorCode: "TEMPLATE_NOT_FOUND",
        detail: "指定命令模板不存在"
      });
    }

    return template;
  }

  private resolveProxySlug(input: {
    previousProxyEnabled: boolean;
    previousProxySlug: string | null;
    nextProxyEnabled: boolean;
    nextPort: number | null;
  }): string | null {
    if (!input.nextProxyEnabled) {
      return null;
    }

    if (input.nextPort === null) {
      throw new AppError({
        statusCode: 400,
        errorCode: "COMMAND_TEMPLATE_INVALID",
        detail: "开启反向代理时必须配置监听端口",
        field: "port"
      });
    }

    if (input.previousProxyEnabled && input.previousProxySlug) {
      return input.previousProxySlug;
    }

    return this.createUniqueProxySlug();
  }

  private createUniqueProxySlug(): string {
    for (let i = 0; i < 10; i += 1) {
      const slug = createProxySlug();
      const existed = this.templateRepository.findByProxySlug(slug);

      if (!existed) {
        return slug;
      }
    }

    throw new AppError({
      statusCode: 500,
      errorCode: "INTERNAL_ERROR",
      detail: "生成反向代理地址失败，请稍后重试"
    });
  }
}

function buildValidatedTemplate(input: CommandTemplateDraft): TerminalCommandTemplate {
  const name = input.name?.trim() ?? "";
  const command = input.command?.trim() ?? "";

  if (!name) {
    throw new AppError({
      statusCode: 400,
      errorCode: "COMMAND_TEMPLATE_INVALID",
      detail: "命令模板必须提供名称",
      field: "name"
    });
  }

  if (!command) {
    throw new AppError({
      statusCode: 400,
      errorCode: "COMMAND_TEMPLATE_INVALID",
      detail: "命令模板必须提供 command",
      field: "command"
    });
  }

  if (containsControlCharacter(command)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "COMMAND_TEMPLATE_INVALID",
      detail: "command 不能包含换行或空字符",
      field: "command"
    });
  }

  for (const arg of input.args) {
    if (containsControlCharacter(arg)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "COMMAND_TEMPLATE_INVALID",
        detail: "args 不能包含换行或空字符",
        field: "args"
      });
    }
  }

  for (const [key, value] of Object.entries(input.env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || containsControlCharacter(value)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "COMMAND_TEMPLATE_INVALID",
        detail: "环境变量名称或值不合法",
        field: "env"
      });
    }
  }

  return {
    ...input,
    name,
    command
  };
}

function normalizeTemplateRuntimeType(
  input?: TerminalRuntimeType | null
): TerminalRuntimeType | null {
  return input ?? null;
}

function normalizeProxyEnabled(input?: boolean): boolean {
  return input === true;
}

function normalizePort(input?: number | null): number | null {
  if (input === undefined || input === null) {
    return null;
  }

  if (!Number.isInteger(input) || input < 1 || input > 65535) {
    throw new AppError({
      statusCode: 400,
      errorCode: "COMMAND_TEMPLATE_INVALID",
      detail: "port 必须是 1 到 65535 之间的整数",
      field: "port"
    });
  }

  return input;
}

function containsControlCharacter(input: string): boolean {
  return input.includes("\0") || input.includes("\n") || input.includes("\r");
}

function mapTemplateStorageError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
    if (error.message.includes("terminal_command_templates.proxy_slug")) {
      return new AppError({
        statusCode: 409,
        errorCode: "COMMAND_TEMPLATE_CONFLICT",
        detail: "代理地址码冲突，请重试",
        field: "proxySlug"
      });
    }

    return new AppError({
      statusCode: 409,
      errorCode: "COMMAND_TEMPLATE_CONFLICT",
      detail: "同一工作区下命令模板名称不能重复",
      field: "name"
    });
  }

  return new AppError({
    statusCode: 500,
    errorCode: "INTERNAL_ERROR",
    detail: error instanceof Error ? error.message : "命令模板写入失败"
  });
}

function createProxySlug(length = 6): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  let result = "";

  for (const value of bytes) {
    result += alphabet[value % alphabet.length];
  }

  return result;
}

function normalizeProxySlug(proxySlug: string): string {
  return proxySlug.trim().toLowerCase();
}

function resolveTemplateCwd(workspacePath: string, cwd?: string | null): string {
  try {
    return resolveWorkspaceCwd(workspacePath, cwd);
  } catch (error) {
    if (error instanceof AppError && error.errorCode === "INVALID_CWD") {
      throw new AppError({
        statusCode: 400,
        errorCode: "COMMAND_TEMPLATE_INVALID",
        detail: "命令模板 cwd 必须位于工作区目录内",
        field: "cwd"
      });
    }

    throw error;
  }
}
