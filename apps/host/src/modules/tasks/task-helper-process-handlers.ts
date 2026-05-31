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
    },
    signal?: AbortSignal
  ) => ProviderSessionDiscovery | Promise<ProviderSessionDiscovery>;
  "affairs.library_apply_config": (
    input: { rootDir: string; reason?: string },
    signal?: AbortSignal
  ) => AffairsIndexerCommandResult | Promise<AffairsIndexerCommandResult>;
  "affairs.library_index": (
    input: { rootDir: string; targetPath?: string; reason?: string },
    signal?: AbortSignal
  ) => AffairsIndexerCommandResult | Promise<AffairsIndexerCommandResult>;
  "affairs.library_recompute_tags": (
    input: { rootDir: string; reason?: string },
    signal?: AbortSignal
  ) => AffairsIndexerCommandResult | Promise<AffairsIndexerCommandResult>;
  "affairs.library_export": (
    input: { rootDir: string },
    signal?: AbortSignal
  ) => AffairsIndexerCommandResult | Promise<AffairsIndexerCommandResult>;
}

const TASK_HELPER_PROCESS_HANDLERS: TaskHelperProcessHandlerMap = {
  "workspace.code_composition_scan": ({ workspacePath }, signal) =>
    readWorkspaceCodeCompositionWithSignal(workspacePath, signal),
  "terminal.template_runtime_status_discovery": ({ items }, signal) =>
    discoverTemplateRuntimeStatuses(items, signal),
  "session.workspace_discovery": ({ config, workspacePath, knownSessions, enabledProviders }, signal) =>
    discoverWorkspaceSessionsInRuntime(config, workspacePath, knownSessions, enabledProviders, signal),
  "affairs.library_apply_config": ({ rootDir, reason }) =>
    runAffairsIndexerCommand(
      rootDir,
      "apply-config" satisfies AffairsIndexerCommandName,
      {
        reason
      }
    ),
  "affairs.library_index": ({ rootDir, targetPath, reason }) =>
    runAffairsIndexerCommand(
      rootDir,
      targetPath ? ("watch-touch" satisfies AffairsIndexerCommandName) : ("index" satisfies AffairsIndexerCommandName),
      {
        targetPath,
        reason
      }
    ),
  "affairs.library_recompute_tags": ({ rootDir, reason }) =>
    runAffairsIndexerCommand(
      rootDir,
      "recompute-tags" satisfies AffairsIndexerCommandName,
      {
        reason
      }
    ),
  "affairs.library_export": ({ rootDir }) =>
    runAffairsIndexerCommand(rootDir, "export" satisfies AffairsIndexerCommandName)
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
