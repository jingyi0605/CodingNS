import type { TerminalTemplateRuntimeStatus } from "../../types/domain.js";
import { discoverTemplateRuntimeStatuses } from "../terminal/template-port-runtime.js";
import {
  readWorkspaceCodeComposition
} from "../workspace/workspace-code-composition.js";
import type { WorkspaceCodeCompositionSummary } from "../workspace/workspace-service.js";

interface TaskHelperProcessHandlerMap {
  "workspace.code_composition_scan": (
    input: { workspacePath: string }
  ) => WorkspaceCodeCompositionSummary | Promise<WorkspaceCodeCompositionSummary>;
  "terminal.template_runtime_status_discovery": (
    input: { items: Array<{ templateId: string; port: number }> }
  ) => TerminalTemplateRuntimeStatus[] | Promise<TerminalTemplateRuntimeStatus[]>;
}

const TASK_HELPER_PROCESS_HANDLERS: TaskHelperProcessHandlerMap = {
  "workspace.code_composition_scan": ({ workspacePath }) =>
    readWorkspaceCodeComposition(workspacePath),
  "terminal.template_runtime_status_discovery": ({ items }) =>
    discoverTemplateRuntimeStatuses(items)
};

export type TaskHelperProcessHandlerName = keyof TaskHelperProcessHandlerMap;

export async function runTaskHelperProcessHandler(
  handler: TaskHelperProcessHandlerName,
  input: unknown
): Promise<unknown> {
  const handlerFn = TASK_HELPER_PROCESS_HANDLERS[handler];

  if (!handlerFn) {
    throw new Error(`未知 helper_process 处理器: ${handler}`);
  }

  return await handlerFn(input as never);
}
