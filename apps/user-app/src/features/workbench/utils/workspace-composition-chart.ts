import type { CSSProperties } from "react";

import type { WorkspaceCodeCompositionItemDto } from "../../conversation/api/conversation-api";

const WORKSPACE_COMPOSITION_CHART_MAX_ITEMS = 5;
const WORKSPACE_COMPOSITION_CHART_COLORS = [
  "#2563eb",
  "#0891b2",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#64748b"
] as const;

export interface WorkspaceCompositionChartItem extends WorkspaceCodeCompositionItemDto {
  key: string;
  color: string;
}

export function formatWorkspaceCompositionRatio(item: WorkspaceCodeCompositionItemDto) {
  const percent = Math.round(item.ratio * 1000) / 10;
  return `${percent.toFixed(percent % 1 === 0 ? 0 : 1)}%`;
}

export function buildWorkspaceCompositionChartItems(
  items: WorkspaceCodeCompositionItemDto[],
  otherLabel: string
): WorkspaceCompositionChartItem[] {
  const totalCount = items.reduce((sum, item) => sum + item.count, 0);

  if (totalCount <= 0) {
    return [];
  }

  const topItems = items.slice(0, WORKSPACE_COMPOSITION_CHART_MAX_ITEMS);
  const chartItems = topItems.map((item, index) => ({
    ...item,
    key: item.type,
    ratio: item.count / totalCount,
    color: WORKSPACE_COMPOSITION_CHART_COLORS[index] ?? WORKSPACE_COMPOSITION_CHART_COLORS[0]
  }));
  const remainingItems = items.slice(WORKSPACE_COMPOSITION_CHART_MAX_ITEMS);

  if (remainingItems.length === 0) {
    return chartItems;
  }

  const otherCount = remainingItems.reduce((sum, item) => sum + item.count, 0);

  chartItems.push({
    key: "other",
    type: otherLabel,
    count: otherCount,
    ratio: otherCount / totalCount,
    color:
      WORKSPACE_COMPOSITION_CHART_COLORS[WORKSPACE_COMPOSITION_CHART_MAX_ITEMS] ??
      WORKSPACE_COMPOSITION_CHART_COLORS[WORKSPACE_COMPOSITION_CHART_COLORS.length - 1]
  });

  return chartItems;
}

export function buildWorkspaceCompositionChartBackground(items: WorkspaceCompositionChartItem[]): string {
  if (items.length === 0) {
    return "conic-gradient(color-mix(in srgb, var(--border-primary) 78%, transparent) 0% 100%)";
  }

  let offset = 0;
  const segments = items.map((item, index) => {
    const start = offset;
    const end = index === items.length - 1 ? 1 : Math.min(1, offset + item.ratio);

    offset = end;

    return `${item.color} ${formatWorkspaceCompositionChartPercent(start)} ${formatWorkspaceCompositionChartPercent(end)}`;
  });

  return `conic-gradient(${segments.join(", ")})`;
}

export function createWorkspaceCompositionChartStyle(
  items: WorkspaceCompositionChartItem[]
): CSSProperties {
  return {
    "--workbench-manage-chart-background": buildWorkspaceCompositionChartBackground(items)
  } as CSSProperties;
}

function formatWorkspaceCompositionChartPercent(value: number) {
  const percent = Math.round(value * 1000) / 10;
  return `${percent.toFixed(percent % 1 === 0 ? 0 : 1)}%`;
}
