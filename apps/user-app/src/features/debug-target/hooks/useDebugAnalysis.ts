import { useCallback, useEffect, useMemo, useState } from "react";

import {
  analyzeDebugTarget,
  getFrameworkCompatibilityMatrix,
  type DebugServiceSpecDto,
  type FrameworkAnalysisResultDto,
  type FrameworkCompatibilityMatrixItemDto
} from "../../conversation/api/conversation-api";
import { t } from "../../../shared/i18n";

export interface DebugAnalysisWorkspaceTarget {
  id: string;
  path: string;
  name?: string | null;
  targetHostId?: string | null;
}

export interface DebugAnalysisState {
  loading: boolean;
  error: string | null;
  targetId: string | null;
  targetSourceType: "repo" | "worktree" | null;
  services: DebugServiceSpecDto[];
  analyses: FrameworkAnalysisResultDto[];
  matrixItems: FrameworkCompatibilityMatrixItemDto[];
  primaryAnalysis: FrameworkAnalysisResultDto | null;
  currentCompatibilityItem: FrameworkCompatibilityMatrixItemDto | null;
  lastAnalyzedAt: string | null;
  refresh: () => void;
}

type InternalDebugAnalysisState = Omit<
  DebugAnalysisState,
  "primaryAnalysis" | "currentCompatibilityItem" | "lastAnalyzedAt" | "refresh"
>;

export function useDebugAnalysis(
  workspace: DebugAnalysisWorkspaceTarget | null
): DebugAnalysisState {
  const [state, setState] = useState<InternalDebugAnalysisState>({
    loading: false,
    error: null,
    targetId: null,
    targetSourceType: null,
    services: [],
    analyses: [],
    matrixItems: []
  });
  const [refreshVersion, setRefreshVersion] = useState(0);

  const refresh = useCallback(() => {
    setRefreshVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!workspace?.id || !workspace.path) {
      setState({
        loading: false,
        error: null,
        targetId: null,
        targetSourceType: null,
        services: [],
        analyses: [],
        matrixItems: []
      });
      return;
    }

    let disposed = false;

    setState((current) => ({
      ...current,
      loading: true,
      error: null
    }));

    void (async () => {
      try {
        const [analysisEnvelope, matrix] = await Promise.all([
          analyzeDebugTarget({
            workspaceId: workspace.id,
            rootPath: workspace.path
          }, {
            targetHostId: workspace.targetHostId
          }),
          getFrameworkCompatibilityMatrix()
        ]);

        if (disposed) {
          return;
        }

        setState({
          loading: false,
          error: null,
          targetId: analysisEnvelope.target.id,
          targetSourceType: analysisEnvelope.target.sourceType,
          services: analysisEnvelope.services,
          analyses: analysisEnvelope.analyses,
          matrixItems: matrix.items
        });
      } catch (error) {
        if (disposed) {
          return;
        }

        setState({
          loading: false,
          error: error instanceof Error ? error.message : t("shell.workspaceDetailDebugAnalyzeFailed"),
          targetId: null,
          targetSourceType: null,
          services: [],
          analyses: [],
          matrixItems: []
        });
      }
    })();

    return () => {
      disposed = true;
    };
  }, [refreshVersion, workspace?.id, workspace?.path, workspace?.targetHostId]);

  const primaryAnalysis = useMemo(
    () => pickPrimaryAnalysis(state.services, state.analyses),
    [state.analyses, state.services]
  );
  const currentCompatibilityItem = useMemo(
    () =>
      state.matrixItems.find((item) => item.framework === (primaryAnalysis?.primaryFramework ?? "unknown"))
      ?? null,
    [primaryAnalysis?.primaryFramework, state.matrixItems]
  );
  const lastAnalyzedAt = useMemo(
    () => state.analyses[0]?.createdAt ?? null,
    [state.analyses]
  );

  return {
    ...state,
    primaryAnalysis,
    currentCompatibilityItem,
    lastAnalyzedAt,
    refresh
  };
}

function pickPrimaryAnalysis(
  services: DebugServiceSpecDto[],
  analyses: FrameworkAnalysisResultDto[]
): FrameworkAnalysisResultDto | null {
  if (analyses.length === 0) {
    return null;
  }

  const analysisByServiceId = new Map(
    analyses
      .filter((analysis) => analysis.serviceId)
      .map((analysis) => [analysis.serviceId as string, analysis] as const)
  );
  const prioritizedServiceAnalysis = [...services]
    .sort((left, right) => compareServicePriority(left, right))
    .map((service) => analysisByServiceId.get(service.id) ?? null)
    .find((analysis) => analysis !== null);

  return prioritizedServiceAnalysis ?? analyses[0] ?? null;
}

function compareServicePriority(left: DebugServiceSpecDto, right: DebugServiceSpecDto) {
  const roleDelta = resolveServicePriority(left.role) - resolveServicePriority(right.role);

  if (roleDelta !== 0) {
    return roleDelta;
  }

  return left.name.localeCompare(right.name);
}

function resolveServicePriority(role: DebugServiceSpecDto["role"]): number {
  switch (role) {
    case "frontend":
      return 0;
    case "backend":
      return 1;
    case "worker":
      return 2;
    case "mock":
      return 3;
    default:
      return 4;
  }
}
