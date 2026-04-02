import { useEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { FileContextPanel } from "../conversation/components/FileContextPanel";
import { GitSidebar } from "../conversation/components/GitSidebar";
import { useWorkbenchShell } from "../conversation/components/WorkbenchLayout";
import { useHaptics, type HapticPattern } from "../../shared/haptics";
import { MobileWorkspaceSwitcherHeader } from "../mobile-shell/components/MobileWorkspaceSwitcherHeader";
import { buildWorkspaceToolProcessesPath, buildWorkspaceToolsPath } from "../workbench/utils/workbench-navigation";
import { t } from "../../shared/i18n";

type PrimaryToolKey = "files" | "git";

const LAST_PRIMARY_TOOL_KEY = "mobile.tools.last-primary-tool";
const PRIMARY_TOOL_ORDER: PrimaryToolKey[] = ["files", "git"];
const TOOL_SWIPE_THRESHOLD_PX = 56;
const TOOL_SWIPE_DOMINANCE_RATIO = 1.2;

export function resolvePrimaryToolFromSearch(
  searchTab: string | null,
  fallbackTool: PrimaryToolKey
): PrimaryToolKey {
  if (searchTab === "git") {
    return "git";
  }

  if (searchTab === "files") {
    return "files";
  }

  return fallbackTool;
}

export function resolvePrimaryToolAfterSwipe(
  activeTool: PrimaryToolKey,
  touchStart: { x: number; y: number } | null,
  touchEnd: { x: number; y: number }
): PrimaryToolKey {
  if (!touchStart) {
    return activeTool;
  }

  const deltaX = touchEnd.x - touchStart.x;
  const deltaY = touchEnd.y - touchStart.y;

  if (Math.abs(deltaX) < TOOL_SWIPE_THRESHOLD_PX) {
    return activeTool;
  }

  if (Math.abs(deltaX) < Math.abs(deltaY) * TOOL_SWIPE_DOMINANCE_RATIO) {
    return activeTool;
  }

  const activeToolIndex = PRIMARY_TOOL_ORDER.indexOf(activeTool);
  const nextIndex =
    deltaX < 0
      ? Math.min(PRIMARY_TOOL_ORDER.length - 1, activeToolIndex + 1)
      : Math.max(0, activeToolIndex - 1);

  return PRIMARY_TOOL_ORDER[nextIndex] ?? activeTool;
}

function readStoredPrimaryTool(): PrimaryToolKey {
  if (typeof window === "undefined") {
    return "files";
  }

  try {
    const storedValue = window.localStorage.getItem(LAST_PRIMARY_TOOL_KEY);
    return storedValue === "git" ? "git" : "files";
  } catch {
    return "files";
  }
}

export function ToolsHomePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const haptics = useHaptics();
  const { navigationGroups, currentWorkspaceId, currentSessionId, selectWorkspace } = useWorkbenchShell();
  const currentWorkspace =
    navigationGroups.find((group) => group.workspace.id === currentWorkspaceId)?.workspace
    ?? navigationGroups[0]?.workspace
    ?? null;
  const searchTab = new URLSearchParams(location.search).get("tab");
  const storedPrimaryToolRef = useRef<PrimaryToolKey>(readStoredPrimaryTool());
  // URL 是主工具切换的唯一真相源，避免本地 state 和查询参数互相回写造成抖动。
  const activeTool = resolvePrimaryToolFromSearch(searchTab, storedPrimaryToolRef.current);
  const [visitedTools, setVisitedTools] = useState<Record<PrimaryToolKey, boolean>>(() => {
    const initialTool = resolvePrimaryToolFromSearch(searchTab, storedPrimaryToolRef.current);

    return {
      files: initialTool === "files",
      git: initialTool === "git"
    };
  });
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const primaryTools = useMemo(
    () => [
      {
        key: "files" as const,
        title: t("shell.filesEntry"),
        render: () => (
          <FileContextPanel
            sessionId={currentSessionId}
            workspaceId={currentWorkspaceId}
            hideHeading
          />
        )
      },
      {
        key: "git" as const,
        title: t("shell.gitEntry"),
        render: () => (
          <GitSidebar
            className="mobile-tool-native-panel mobile-tool-git-panel"
            workspaceId={currentWorkspaceId}
            panelActive={activeTool === "git"}
          />
        )
      }
    ],
    [activeTool, currentSessionId, currentWorkspaceId]
  );
  const activeToolIndex = PRIMARY_TOOL_ORDER.indexOf(activeTool);

  useEffect(() => {
    setVisitedTools((current) => ({
      ...current,
      [activeTool]: true
    }));
  }, [activeTool]);

  useEffect(() => {
    storedPrimaryToolRef.current = activeTool;

    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(LAST_PRIMARY_TOOL_KEY, activeTool);
    } catch {
      // 忽略隐私模式或测试环境里的本地存储失败。
    }
  }, [activeTool]);

  useEffect(() => {
    if (searchTab === activeTool) {
      return;
    }

    const nextSearchParams = new URLSearchParams(location.search);
    nextSearchParams.set("tab", activeTool);
    navigate(
      {
        pathname: location.pathname,
        search: `?${nextSearchParams.toString()}`
      },
      { replace: true }
    );
  }, [activeTool, location.pathname, location.search, navigate, searchTab]);

  function selectPrimaryTool(nextTool: PrimaryToolKey, hapticPattern: HapticPattern = "selection") {
    if (nextTool === activeTool) {
      return;
    }

    void haptics.trigger(hapticPattern);

    const nextSearchParams = new URLSearchParams(location.search);
    nextSearchParams.set("tab", nextTool);
    navigate(
      {
        pathname: location.pathname,
        search: `?${nextSearchParams.toString()}`
      },
      { replace: true }
    );
  }

  function switchPrimaryTool(step: -1 | 1) {
    const nextIndex = Math.min(PRIMARY_TOOL_ORDER.length - 1, Math.max(0, activeToolIndex + step));
    const nextTool = PRIMARY_TOOL_ORDER[nextIndex];

    if (nextTool) {
      selectPrimaryTool(nextTool, "gesture");
    }
  }

  function handleTouchStart(event: ReactTouchEvent<HTMLElement>) {
    if (event.changedTouches.length !== 1) {
      touchStartRef.current = null;
      return;
    }

    const touchPoint = event.changedTouches[0];
    touchStartRef.current = {
      x: touchPoint.clientX,
      y: touchPoint.clientY
    };
  }

  function handleTouchEnd(event: ReactTouchEvent<HTMLElement>) {
    const touchStart = touchStartRef.current;
    touchStartRef.current = null;

    if (event.changedTouches.length !== 1) {
      return;
    }

    const touchPoint = event.changedTouches[0];
    const nextTool = resolvePrimaryToolAfterSwipe(activeTool, touchStart, {
      x: touchPoint.clientX,
      y: touchPoint.clientY
    });

    if (nextTool !== activeTool) {
      selectPrimaryTool(nextTool);
    }
  }

  return (
    <main className="mobile-feature-page mobile-page-fixed-root mobile-tools-workspace-page">
      {currentWorkspace ? (
        <>
          <MobileWorkspaceSwitcherHeader
            currentWorkspace={currentWorkspace}
            workspaces={navigationGroups.map((group) => group.workspace)}
            onSelectWorkspace={(workspaceId) => {
              selectWorkspace(workspaceId);
              navigate(buildWorkspaceToolsPath(workspaceId, activeTool));
            }}
            trailing={
              <button
                type="button"
                className="secondary-button mobile-tools-more-button"
                aria-label={t("shell.toolsMoreAction")}
                title={t("shell.toolsMoreAction")}
                onClick={() => {
                  void haptics.trigger("action");
                  navigate(buildWorkspaceToolProcessesPath(currentWorkspace.id));
                }}
              >
                <MoreIcon />
              </button>
            }
            content={
              <div className="mobile-tools-switcher" aria-label={t("shell.mobileToolsEntry")}>
                <div className="mobile-tools-segmented-control" role="tablist" aria-label={t("shell.mobileToolsEntry")}>
                  {primaryTools.map((tool) => {
                    const selected = tool.key === activeTool;

                    return (
                      <button
                        key={tool.key}
                        type="button"
                        role="tab"
                        className="mobile-tools-segmented-button"
                        data-active={selected}
                        aria-selected={selected}
                        aria-controls={`mobile-tool-panel-${tool.key}`}
                        onClick={() => selectPrimaryTool(tool.key, "selection")}
                      >
                        {tool.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            }
          />

          <section
            className="mobile-tools-stage"
            data-active-tool={activeTool}
            data-testid="mobile-tools-stage"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={() => {
              touchStartRef.current = null;
            }}
          >
            <div className="mobile-tools-stage-viewport">
              <div
                className="mobile-tools-stage-track"
                style={{ transform: `translateX(-${activeToolIndex * 100}%)` }}
              >
                {primaryTools.map((tool) => (
                  <article
                    key={tool.key}
                    id={`mobile-tool-panel-${tool.key}`}
                    role="tabpanel"
                    aria-label={tool.title}
                    aria-hidden={tool.key !== activeTool}
                    className="mobile-tools-stage-panel"
                  >
                    <div className="mobile-tools-stage-panel-shell">
                      {visitedTools[tool.key] ? tool.render() : null}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </>
      ) : (
        <article className="mobile-feature-empty surface-card">
          <p>{t("shell.emptyNavigationBody")}</p>
        </article>
      )}
    </main>
  );
}

function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}
