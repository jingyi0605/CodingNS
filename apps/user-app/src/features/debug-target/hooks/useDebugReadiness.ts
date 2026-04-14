import { useEffect, useMemo, useState } from "react";

import {
  analyzeDebugTarget,
  getFrameworkCompatibilityMatrix,
  getRecentDebugRuntimes,
  type DebugRuntimeHistoryEnvelopeDto,
  type DebugRuntimeDetailDto,
  type DebugServiceSpecDto,
  type FrameworkCompatibilityMatrixItemDto,
  type FrameworkAnalysisResultDto
} from "../../conversation/api/conversation-api";
import { t } from "../../../shared/i18n";

export interface DebugReadinessWorkspaceTarget {
  id: string;
  path: string;
  name?: string | null;
}

export interface DebugReadinessState {
  loading: boolean;
  error: string | null;
  targetId: string | null;
  targetSourceType: "repo" | "worktree" | null;
  autoInjectionEligible: boolean;
  services: DebugServiceSpecDto[];
  analyses: FrameworkAnalysisResultDto[];
  primaryAnalysis: FrameworkAnalysisResultDto | null;
  runtime: DebugRuntimeDetailDto | null;
  runtimeHistory: DebugRuntimeDetailDto[];
  matrixItems: FrameworkCompatibilityMatrixItemDto[];
  currentCompatibilityItem: FrameworkCompatibilityMatrixItemDto | null;
}

export function useDebugReadiness(
  workspace: DebugReadinessWorkspaceTarget | null
): DebugReadinessState {
  const [state, setState] = useState<Omit<DebugReadinessState, "primaryAnalysis" | "currentCompatibilityItem">>({
    loading: false,
    error: null,
    targetId: null,
    targetSourceType: null,
    autoInjectionEligible: false,
    services: [],
    analyses: [],
    runtime: null,
    runtimeHistory: [],
    matrixItems: []
  });

  useEffect(() => {
    if (!workspace?.id || !workspace.path) {
      setState({
        loading: false,
        error: null,
        targetId: null,
        targetSourceType: null,
        autoInjectionEligible: false,
        services: [],
        analyses: [],
        runtime: null,
        runtimeHistory: [],
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
        const analysisEnvelope = await analyzeDebugTarget({
          workspaceId: workspace.id,
          rootPath: workspace.path
        });
        const [runtimeHistoryEnvelope, matrix] = await Promise.all([
          getRecentDebugRuntimes(analysisEnvelope.target.id, 5),
          getFrameworkCompatibilityMatrix()
        ]);
        const runtime = pickLatestRuntime(runtimeHistoryEnvelope);

        if (disposed) {
          return;
        }

        setState({
          loading: false,
          error: null,
          targetId: analysisEnvelope.target.id,
          targetSourceType: analysisEnvelope.target.sourceType,
          autoInjectionEligible: analysisEnvelope.autoInjectionEligible,
          services: analysisEnvelope.services,
          analyses: analysisEnvelope.analyses,
          runtime,
          runtimeHistory: runtimeHistoryEnvelope.items,
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
          autoInjectionEligible: false,
          services: [],
          analyses: [],
          runtime: null,
          runtimeHistory: [],
          matrixItems: []
        });
      }
    })();

    return () => {
      disposed = true;
    };
  }, [workspace?.id, workspace?.path]);

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

  return {
    ...state,
    primaryAnalysis,
    currentCompatibilityItem
  };
}

function pickLatestRuntime(runtimeHistoryEnvelope: DebugRuntimeHistoryEnvelopeDto): DebugRuntimeDetailDto | null {
  return runtimeHistoryEnvelope.items[0] ?? null;
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
