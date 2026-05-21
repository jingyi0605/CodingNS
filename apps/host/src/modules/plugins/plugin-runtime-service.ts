import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { PluginAuditEventRepository } from "../../storage/repositories/plugin-audit-event-repository.js";
import type { PluginRunRepository } from "../../storage/repositories/plugin-run-repository.js";
import type {
  PluginActionDefinition,
  PluginDesktopPermission,
  PluginManifest,
  PluginRun
} from "../../types/domain.js";
import type { FileAccessGuard } from "../file/file-access-guard.js";
import type { TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../tasks/task-types.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import { PluginPermissionService } from "./plugin-permission-service.js";
import type { PluginRegistryService } from "./plugin-registry-service.js";
import {
  PluginProcessRunner,
  type PluginProcessRunResult
} from "./plugin-process-runner.js";

export interface PluginActionInvokeInput {
  pluginId: string;
  actionId: string;
  workspaceId: string;
  input: unknown;
  triggerKind: PluginRun["triggerKind"];
  actorUserId: string | null;
}

export interface PluginActionInvokeResult {
  run: PluginRun;
  output: unknown;
}

export interface PluginDesktopActionInput {
  pluginId: string;
  workspaceId: string;
  requestedPath: string;
  permission: PluginDesktopPermission;
  actorUserId: string | null;
}

export interface PluginDesktopActionResult {
  workspaceId: string;
  relativePath: string;
  absolutePath: string;
}

interface PluginTaskInput {
  runId: string;
  pluginId: string;
  actionId: string;
  workspaceId: string;
  input: unknown;
}

export class PluginRuntimeService {
  constructor(
    private readonly pluginRegistryService: PluginRegistryService,
    private readonly pluginRunRepository: PluginRunRepository,
    private readonly pluginAuditEventRepository: PluginAuditEventRepository,
    private readonly workspaceService: WorkspaceService,
    private readonly fileAccessGuard: FileAccessGuard,
    private readonly pluginPermissionService: PluginPermissionService,
    private readonly pluginProcessRunner: PluginProcessRunner,
    private readonly taskManager: TaskManager
  ) {
    this.registerPluginActionTask();
  }

  listRuns(pluginId: string): PluginRun[] {
    this.pluginRegistryService.getPlugin(pluginId);
    return this.pluginRunRepository.listByPluginId(pluginId);
  }

  async callAction(input: PluginActionInvokeInput): Promise<PluginActionInvokeResult> {
    const detail = this.pluginRegistryService.getPlugin(input.pluginId);
    this.assertEnabled(detail.enablement.enabled);

    const workspaceId = this.pluginPermissionService.assertWorkspaceScopedContext(input.workspaceId);
    this.workspaceService.getWorkspaceOrThrow(workspaceId);
    this.pluginPermissionService.assertWorkspaceRead(detail.manifest);
    const action = requirePluginAction(detail.manifest, input.actionId);

    const run = this.pluginRunRepository.create({
      id: createId(),
      pluginId: input.pluginId,
      workspaceId,
      triggerKind: input.triggerKind,
      actionId: action.id,
      status: "running",
      inputSummaryJson: JSON.stringify(summarizeForAudit(input.input)),
      outputSummaryJson: null,
      errorCode: null,
      errorMessage: null,
      startedAt: nowIso(),
      finishedAt: null,
      createdAt: nowIso()
    });

    try {
      const handle = this.taskManager.enqueue<PluginTaskInput, PluginProcessRunResult>(
        HOST_TASK_TYPES.pluginActionExecute,
        {
          key: `${input.pluginId}:${workspaceId}:${action.id}`,
          source: `plugin_runtime.${action.id}`,
          input: {
            runId: run.id,
            pluginId: input.pluginId,
            actionId: action.id,
            workspaceId,
            input: input.input
          }
        }
      );
      const result = await handle.promise;

      if (result.exitCode !== 0) {
        throw new AppError({
          statusCode: 500,
          errorCode: "PLUGIN_ACTION_FAILED",
          detail: result.stderr.trim() || `插件动作退出码非 0：${result.exitCode}`
        });
      }

      let output: unknown = null;
      try {
        output = result.stdout.trim() ? JSON.parse(result.stdout) : null;
      } catch {
        output = result.stdout;
      }

      const succeededRun: PluginRun = {
        ...run,
        status: "succeeded",
        outputSummaryJson: JSON.stringify(summarizeForAudit(output)),
        finishedAt: nowIso()
      };
      this.pluginRunRepository.update(succeededRun);
      this.pluginAuditEventRepository.create({
        id: createId(),
        pluginId: input.pluginId,
        workspaceId,
        eventType: "plugin.action_invoked",
        actorUserId: input.actorUserId,
        payloadJson: JSON.stringify({
          actionId: action.id,
          runId: succeededRun.id,
          triggerKind: input.triggerKind
        }),
        createdAt: nowIso()
      });

      return {
        run: succeededRun,
        output
      };
    } catch (error) {
      const failedRun: PluginRun = {
        ...run,
        status: "failed",
        errorCode: error instanceof AppError ? error.errorCode : "PLUGIN_ACTION_FAILED",
        errorMessage: error instanceof Error ? error.message : "未知错误",
        finishedAt: nowIso()
      };
      this.pluginRunRepository.update(failedRun);
      this.pluginAuditEventRepository.create({
        id: createId(),
        pluginId: input.pluginId,
        workspaceId,
        eventType: "plugin.action_rejected",
        actorUserId: input.actorUserId,
        payloadJson: JSON.stringify({
          actionId: action.id,
          runId: failedRun.id,
          errorCode: failedRun.errorCode,
          errorMessage: failedRun.errorMessage
        }),
        createdAt: nowIso()
      });
      throw error;
    }
  }

  prepareDesktopAction(input: PluginDesktopActionInput): PluginDesktopActionResult {
    const detail = this.pluginRegistryService.getPlugin(input.pluginId);
    this.assertEnabled(detail.enablement.enabled);
    const workspaceId = this.pluginPermissionService.assertWorkspaceScopedContext(input.workspaceId);
    this.workspaceService.getWorkspaceOrThrow(workspaceId);
    this.pluginPermissionService.assertWorkspaceRead(detail.manifest);
    this.pluginPermissionService.assertDesktopPermission(detail.manifest, input.permission);
    const resolved = this.resolveWorkspaceRelativePath(workspaceId, input.requestedPath);

    this.pluginAuditEventRepository.create({
      id: createId(),
      pluginId: input.pluginId,
      workspaceId,
      eventType: "plugin.desktop_call",
      actorUserId: input.actorUserId,
      payloadJson: JSON.stringify({
        permission: input.permission,
        path: resolved.relativePath
      }),
      createdAt: nowIso()
    });

    return {
      workspaceId,
      relativePath: resolved.relativePath,
      absolutePath: resolved.absolutePath
    };
  }

  resolveWorkspaceRelativePath(workspaceId: string, requestedPath: string): {
    relativePath: string;
    absolutePath: string;
  } {
    const resolved = this.fileAccessGuard.resolvePath(workspaceId, requestedPath, {
      mustExist: true
    });

    return {
      relativePath: resolved.relativePath,
      absolutePath: resolved.absolutePath
    };
  }

  private registerPluginActionTask(): void {
    if (this.taskManager.has(HOST_TASK_TYPES.pluginActionExecute)) {
      return;
    }

    this.taskManager.register<PluginTaskInput, PluginProcessRunResult>({
      taskType: HOST_TASK_TYPES.pluginActionExecute,
      executionLane: "external_process",
      timeoutMs: 60_000,
      concurrency: 1,
      run: async (input, context) => {
        const detail = this.pluginRegistryService.getPlugin(input.pluginId);
        const action = requirePluginAction(detail.manifest, input.actionId);
        const entryAbsolutePath = resolvePluginActionPath(detail.definition.installRoot, action.entry);

        return await this.pluginProcessRunner.runNodeScript({
          entryAbsolutePath,
          installRoot: detail.definition.installRoot,
          payload: {
            pluginId: input.pluginId,
            actionId: action.id,
            workspaceId: input.workspaceId,
            input: input.input
          },
          timeoutMs: action.timeoutMs ?? 30_000,
          signal: context.signal
        });
      }
    });
  }

  private assertEnabled(enabled: boolean): void {
    if (enabled) {
      return;
    }

    throw new AppError({
      statusCode: 403,
      errorCode: "PLUGIN_DISABLED",
      detail: "当前插件已禁用"
    });
  }
}

function requirePluginAction(manifest: PluginManifest, actionId: string): PluginActionDefinition {
  const action = manifest.backend?.actions.find((item) => item.id === actionId);
  if (!action) {
    throw new AppError({
      statusCode: 404,
      errorCode: "PLUGIN_ACTION_NOT_FOUND",
      detail: "未找到对应插件动作"
    });
  }

  return action;
}

function resolvePluginActionPath(installRoot: string, entry: string): string {
  return path.resolve(installRoot, entry);
}

function summarizeForAudit(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }

  return value;
}
