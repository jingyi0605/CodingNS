import type { CSSProperties } from "react";

import { t } from "../../shared/i18n";
import type {
  ParallelGroupSummaryDto,
  SessionIsolatedWorkspaceSummaryDto,
  SessionSummaryDto
} from "./api/conversation-api";

const PARALLEL_GROUP_COLOR_MAP: Record<
  string,
  {
    accent: string;
    soft: string;
    surface: string;
  }
> = {
  "parallel-group-1": {
    accent: "#0ea5e9",
    soft: "rgba(14, 165, 233, 0.16)",
    surface: "rgba(14, 165, 233, 0.08)"
  },
  "parallel-group-2": {
    accent: "#10b981",
    soft: "rgba(16, 185, 129, 0.16)",
    surface: "rgba(16, 185, 129, 0.08)"
  },
  "parallel-group-3": {
    accent: "#f59e0b",
    soft: "rgba(245, 158, 11, 0.16)",
    surface: "rgba(245, 158, 11, 0.08)"
  },
  "parallel-group-4": {
    accent: "#ec4899",
    soft: "rgba(236, 72, 153, 0.16)",
    surface: "rgba(236, 72, 153, 0.08)"
  },
  "parallel-group-5": {
    accent: "#8b5cf6",
    soft: "rgba(139, 92, 246, 0.16)",
    surface: "rgba(139, 92, 246, 0.08)"
  },
  "parallel-group-6": {
    accent: "#f97316",
    soft: "rgba(249, 115, 22, 0.16)",
    surface: "rgba(249, 115, 22, 0.08)"
  }
};

const PARALLEL_GROUP_TRANSITION_MAX_AGE_MS = 2_400;
const PARALLEL_PANE_PALETTE_STORAGE_KEY = "workbench.parallel.pane.palette";
let parallelGroupTransitionSignal: {
  groupId: string;
  createdAt: number;
} | null = null;

export const PARALLEL_PANE_COLOR_PRESETS = [
  "#34C759",
  "#22C55E",
  "#14B8A6",
  "#06B6D4",
  "#0EA5E9",
  "#3B82F6",
  "#6366F1",
  "#8B5CF6",
  "#A855F7",
  "#D946EF",
  "#EC4899",
  "#F43F5E",
  "#EF4444",
  "#F97316",
  "#F59E0B",
  "#EAB308",
  "#84CC16",
  "#10B981"
] as const;

export function resolveSessionDisplayParentSessionId(
  session: Pick<SessionSummaryDto, "displayParentSessionId" | "parentSessionId">
) {
  const displayParentSessionId = session.displayParentSessionId?.trim();

  if (displayParentSessionId) {
    return displayParentSessionId;
  }

  return session.parentSessionId?.trim() || null;
}

export function createParallelGroupStyle(
  parallelGroup?: Pick<ParallelGroupSummaryDto, "colorToken"> | null
): CSSProperties | undefined {
  const colorToken = parallelGroup?.colorToken?.trim();

  if (!colorToken) {
    return undefined;
  }

  const palette = PARALLEL_GROUP_COLOR_MAP[colorToken] ?? PARALLEL_GROUP_COLOR_MAP["parallel-group-1"];

  return {
    "--parallel-group-accent": palette.accent,
    "--parallel-group-soft": palette.soft,
    "--parallel-group-surface": palette.surface
  } as CSSProperties;
}

export function createParallelPaneStyle(input: {
  groupId: string;
  sessionId: string;
  ordinal: number;
  overrideColor?: string | null;
}): CSSProperties {
  const activeColor =
    normalizeColor(input.overrideColor)
    ?? resolveDefaultParallelPaneColor(input.groupId, input.ordinal);

  return {
    "--parallel-group-accent": activeColor,
    "--parallel-group-soft": toColorMixRgba(activeColor, 0.08),
    "--parallel-group-surface": toColorMixRgba(activeColor, 0.03)
  } as CSSProperties;
}

export function readParallelPaneColorOverride(sessionId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const normalizedSessionId = sessionId.trim();

  if (!normalizedSessionId) {
    return null;
  }

  const overrides = readParallelPanePaletteOverrides();
  return normalizeColor(overrides[normalizedSessionId] ?? null);
}

export function writeParallelPaneColorOverride(sessionId: string, color: string | null): string | null {
  if (typeof window === "undefined") {
    return normalizeColor(color);
  }

  const normalizedSessionId = sessionId.trim();

  if (!normalizedSessionId) {
    return null;
  }

  const overrides = readParallelPanePaletteOverrides();
  const normalizedColor = normalizeColor(color);

  if (normalizedColor) {
    overrides[normalizedSessionId] = normalizedColor;
  } else {
    delete overrides[normalizedSessionId];
  }

  window.localStorage.setItem(PARALLEL_PANE_PALETTE_STORAGE_KEY, JSON.stringify(overrides));
  return normalizedColor;
}

export function resolveDefaultParallelPaneColor(groupId: string, ordinal: number): string {
  const presetCount = PARALLEL_PANE_COLOR_PRESETS.length;
  const startIndex = Math.abs(hashString(groupId)) % presetCount;
  const step = 5;
  return PARALLEL_PANE_COLOR_PRESETS[(startIndex + ordinal * step) % presetCount];
}

export function resolveParallelRoleLabel(
  parallelGroup?: Pick<ParallelGroupSummaryDto, "role"> | null
) {
  if (!parallelGroup) {
    return null;
  }

  return parallelGroup.role === "anchor"
    ? t("shell.parallelGroupAnchorBadge")
    : t("shell.parallelGroupMemberBadge");
}

export function resolveParallelGroupLabel(
  parallelGroup?: Pick<ParallelGroupSummaryDto, "memberCount"> | null
) {
  if (!parallelGroup) {
    return null;
  }

  return t("shell.parallelGroupBadge", {
    count: parallelGroup.memberCount
  });
}

export function resolveSessionIsolatedWorkspaceBranchName(
  sessionIsolatedWorkspace?: Pick<SessionIsolatedWorkspaceSummaryDto, "branchName"> | null
) {
  const branchName = sessionIsolatedWorkspace?.branchName?.trim();
  return branchName || null;
}

export function shouldUseParallelConversationLayout(
  session?: Pick<SessionSummaryDto, "parallelGroup" | "sessionIsolatedWorkspace"> | null
) {
  const parallelGroupId = session?.parallelGroup?.groupId?.trim();

  if (!parallelGroupId) {
    return false;
  }

  return session?.sessionIsolatedWorkspace?.lifecycleStatus !== "promoted";
}

export function resolveSessionNavigationWorkspaceId(
  session: Pick<SessionSummaryDto, "workspaceId">,
  sessionIsolatedWorkspace?: Pick<
    SessionIsolatedWorkspaceSummaryDto,
    "sourceWorkspaceId" | "lifecycleStatus"
  > | null
) {
  if (
    sessionIsolatedWorkspace
    && (sessionIsolatedWorkspace.lifecycleStatus === "active"
      || sessionIsolatedWorkspace.lifecycleStatus === "removing")
  ) {
    return sessionIsolatedWorkspace.sourceWorkspaceId;
  }

  return session.workspaceId;
}

export function resolveSessionToolWorkspaceId(
  session: Pick<SessionSummaryDto, "workspaceId">,
  sessionIsolatedWorkspace?: Pick<
    SessionIsolatedWorkspaceSummaryDto,
    "workspaceId" | "lifecycleStatus"
  > | null
) {
  if (
    sessionIsolatedWorkspace
    && (sessionIsolatedWorkspace.lifecycleStatus === "active"
      || sessionIsolatedWorkspace.lifecycleStatus === "promoted")
  ) {
    return sessionIsolatedWorkspace.workspaceId;
  }

  return session.workspaceId;
}

export function writeParallelGroupTransitionSignal(groupId: string) {
  parallelGroupTransitionSignal = {
    groupId,
    createdAt: Date.now()
  };
}

export function consumeParallelGroupTransitionSignal(groupId: string) {
  if (!parallelGroupTransitionSignal) {
    return false;
  }

  if (parallelGroupTransitionSignal.groupId !== groupId) {
    return false;
  }

  if (Date.now() - parallelGroupTransitionSignal.createdAt > PARALLEL_GROUP_TRANSITION_MAX_AGE_MS) {
    parallelGroupTransitionSignal = null;
    return false;
  }

  parallelGroupTransitionSignal = null;
  return true;
}

function readParallelPanePaletteOverrides(): Record<string, string> {
  if (typeof window === "undefined") {
    return {};
  }

  const raw = window.localStorage.getItem(PARALLEL_PANE_PALETTE_STORAGE_KEY);

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, string>;

    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

function hashString(input: string): number {
  let hash = 0;

  for (const character of input) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }

  return hash;
}

function normalizeColor(color: string | null | undefined): string | null {
  const normalized = color?.trim().toUpperCase() ?? "";

  if (!/^#[0-9A-F]{6}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function toColorMixRgba(color: string, alpha: number): string {
  const normalizedAlpha = Math.max(0, Math.min(alpha, 1));
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);

  return `rgba(${red}, ${green}, ${blue}, ${normalizedAlpha})`;
}
