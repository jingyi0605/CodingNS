import type { ProviderSessionDiscovery, ProviderSessionSummary } from "@codingns/session-sync-core";

import type { ProviderSessionDiscoveryHelperConfig } from "../provider/provider-discovery-helper-client.js";
import { discoverWorkspaceSessionsInRuntime } from "../provider/provider-discovery-runtime.js";
import { runAffairsIndexerCommand, type AffairsIndexerCommandName, type AffairsIndexerCommandResult } from "../affairs-indexer/internal-command-runner.js";
import type { TerminalTemplateRuntimeStatus } from "../../types/domain.js";
import { discoverTemplateRuntimeStatuses } from "../terminal/template-port-runtime.js";
import {
  readWorkspaceCodeCompositionWithSignal
} from "../workspace/workspace-code-composition.js";
import type { WorkspaceCodeCompositionSummary } from "../workspace/workspace-service.js";

interface HelperTaskMetaPayload {
  taskId?: string;
  taskType?: string;
  key?: string;
  attempt?: number;
}

interface TaskHelperProcessHandlerMap {
  "workspace.code_composition_scan": (
    input: { workspacePath: string },
    signal?: AbortSignal
  ) => WorkspaceCodeCompositionSummary | Promise<WorkspaceCodeCompositionSummary>;
  "terminal.template_runtime_status_discovery": (
    input: { items: Array<{ templateId: string; port: number }> },
    signal?: AbortSignal
  ) => TerminalTemplateRuntimeStatus[] | Promise<TerminalTemplateRuntimeStatus[]>;
  "session.workspace_discovery": (
    input: {
      config: ProviderSessionDiscoveryHelperConfig;
      workspacePath: string;
      knownSessions: ProviderSessionSummary[];
      enabledProviders: string[];
      claudeExtraProjectRoots?: string[];
    },
    signal?: AbortSignal
  ) => ProviderSessionDiscovery | Promise<ProviderSessionDiscovery>;
  "affairs.library_apply_config": (
    input: { rootDir: string; reason?: string; __taskMeta?: HelperTaskMetaPayload },
    signal?: AbortSignal
  ) => AffairsIndexerCommandResult | Promise<AffairsIndexerCommandResult>;
  "affairs.library_index": (
    input: { rootDir: string; targetPath?: string; reason?: string; __taskMeta?: HelperTaskMetaPayload },
    signal?: AbortSignal
  ) => AffairsIndexerCommandResult | Promise<AffairsIndexerCommandResult>;
  "affairs.library_export": (
    input: { rootDir: string; __taskMeta?: HelperTaskMetaPayload },
    signal?: AbortSignal
  ) => AffairsIndexerCommandResult | Promise<AffairsIndexerCommandResult>;
  "affairs.library_directory_hint": (
    input: {
      rootDir: string;
      directoryPath: string;
      __taskMeta?: HelperTaskMetaPayload;
    },
    signal?: AbortSignal
  ) => unknown;
}

const TASK_HELPER_PROCESS_HANDLERS: TaskHelperProcessHandlerMap = {
  "workspace.code_composition_scan": ({ workspacePath }, signal) =>
    readWorkspaceCodeCompositionWithSignal(workspacePath, signal),
  "terminal.template_runtime_status_discovery": ({ items }, signal) =>
    discoverTemplateRuntimeStatuses(items, signal),
  "session.workspace_discovery": ({ config, workspacePath, knownSessions, enabledProviders, claudeExtraProjectRoots }, signal) =>
    discoverWorkspaceSessionsInRuntime(
      {
        ...config,
        claudeExtraProjectRoots
      },
      workspacePath,
      knownSessions,
      enabledProviders,
      signal
    ),
  "affairs.library_apply_config": ({ rootDir, reason, __taskMeta }, signal) =>
    runAffairsIndexerCommand(
      rootDir,
      "apply-config" satisfies AffairsIndexerCommandName,
      {
        reason,
        taskMeta: __taskMeta,
        signal
      }
    ),
  "affairs.library_index": ({ rootDir, targetPath, reason, __taskMeta }, signal) =>
    runAffairsIndexerCommand(
      rootDir,
      targetPath ? ("watch-touch" satisfies AffairsIndexerCommandName) : ("index" satisfies AffairsIndexerCommandName),
      {
        targetPath,
        reason,
        taskMeta: __taskMeta,
        signal
      }
    ),
  "affairs.library_export": ({ rootDir, __taskMeta }, signal) =>
    runAffairsIndexerCommand(rootDir, "export" satisfies AffairsIndexerCommandName, {
      taskMeta: __taskMeta,
      signal
    }),
  "affairs.library_directory_hint": async ({ rootDir, directoryPath }, signal) => {
    const module = await import("../workspace/affairs-library-service.js");
    return module.runAffairsLibraryDirectoryHintInHelper({
      rootDir,
      directoryPath,
      signal
    });
  }
};

export type TaskHelperProcessHandlerName = keyof TaskHelperProcessHandlerMap;

export async function runTaskHelperProcessHandler(
  handler: TaskHelperProcessHandlerName,
  input: unknown,
  signal?: AbortSignal
): Promise<unknown> {
  const handlerFn = TASK_HELPER_PROCESS_HANDLERS[handler];

  if (!handlerFn) {
    throw new Error(`未知 helper_process 处理器: ${handler}`);
  }

  return await handlerFn(input as never, signal);
}
