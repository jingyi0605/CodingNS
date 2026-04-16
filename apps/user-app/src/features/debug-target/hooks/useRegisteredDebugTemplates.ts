import { useCallback, useEffect, useState } from "react";

import {
  listWorkspaceTemplates,
  listWorkspaceTemplateRuntimeStatuses,
  type TerminalTemplateDto,
  type TerminalTemplateRuntimeStatusDto
} from "../../terminal/api/terminal-api";
import { t } from "../../../shared/i18n";

export interface RegisteredDebugWorkspaceTarget {
  id: string;
  path: string;
  name?: string | null;
}

export interface RegisteredDebugTemplatesState {
  loading: boolean;
  error: string | null;
  templates: TerminalTemplateDto[];
  runtimeStatuses: TerminalTemplateRuntimeStatusDto[];
  lastRefreshedAt: string | null;
  refreshAll: () => Promise<void>;
  refreshRuntime: () => Promise<void>;
}

export function useRegisteredDebugTemplates(
  workspace: RegisteredDebugWorkspaceTarget | null
): RegisteredDebugTemplatesState {
  const [state, setState] = useState<{
    loading: boolean;
    error: string | null;
    templates: TerminalTemplateDto[];
    runtimeStatuses: TerminalTemplateRuntimeStatusDto[];
    lastRefreshedAt: string | null;
  }>({
    loading: false,
    error: null,
    templates: [],
    runtimeStatuses: [],
    lastRefreshedAt: null
  });

  const refreshAll = useCallback(async () => {
    if (!workspace?.id) {
      setState({
        loading: false,
        error: null,
        templates: [],
        runtimeStatuses: [],
        lastRefreshedAt: null
      });
      return;
    }

    setState((current) => ({
      ...current,
      loading: true,
      error: null
    }));

    try {
      const [templateResponse, runtimeResponse] = await Promise.all([
        listWorkspaceTemplates(workspace.id),
        listWorkspaceTemplateRuntimeStatuses(workspace.id)
      ]);

      setState({
        loading: false,
        error: null,
        templates: sortTemplates(templateResponse.items),
        runtimeStatuses: runtimeResponse.items,
        lastRefreshedAt: new Date().toISOString()
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : t("shell.workspaceDetailRegisteredDebugLoadFailed")
      }));
      throw error;
    }
  }, [workspace?.id]);

  const refreshRuntime = useCallback(async () => {
    if (!workspace?.id) {
      return;
    }

    setState((current) => ({
      ...current,
      loading: true,
      error: null
    }));

    try {
      const runtimeResponse = await listWorkspaceTemplateRuntimeStatuses(workspace.id);

      setState((current) => ({
        ...current,
        loading: false,
        error: null,
        runtimeStatuses: runtimeResponse.items,
        lastRefreshedAt: new Date().toISOString()
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : t("shell.workspaceDetailRegisteredDebugActionRefreshFailed")
      }));
      throw error;
    }
  }, [workspace?.id]);

  useEffect(() => {
    void refreshAll().catch(() => {});
  }, [refreshAll]);

  return {
    ...state,
    refreshAll,
    refreshRuntime
  };
}

function sortTemplates(items: TerminalTemplateDto[]): TerminalTemplateDto[] {
  return [...items].sort((left, right) => {
    const cwdDelta = left.cwd.localeCompare(right.cwd);

    if (cwdDelta !== 0) {
      return cwdDelta;
    }

    return left.name.localeCompare(right.name);
  });
}
