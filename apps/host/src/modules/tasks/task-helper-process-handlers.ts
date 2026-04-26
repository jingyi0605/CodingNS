import type { ProviderSessionDiscovery, ProviderSessionSummary } from "@codingns/session-sync-core";

import type { ProviderSessionDiscoveryHelperConfig } from "../provider/provider-discovery-helper-client.js";
import { discoverWorkspaceSessionsInRuntime } from "../provider/provider-discovery-runtime.js";
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
}

const TASK_HELPER_PROCESS_HANDLERS: TaskHelperProcessHandlerMap = {
  "workspace.code_composition_scan": ({ workspacePath }, signal) =>
    readWorkspaceCodeCompositionWithSignal(workspacePath, signal),
  "terminal.template_runtime_status_discovery": ({ items }, signal) =>
    discoverTemplateRuntimeStatuses(items, signal),
  "session.workspace_discovery": ({ config, workspacePath, knownSessions, enabledProviders }, signal) =>
    discoverWorkspaceSessionsInRuntime(config, workspacePath, knownSessions, enabledProviders, signal)
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
