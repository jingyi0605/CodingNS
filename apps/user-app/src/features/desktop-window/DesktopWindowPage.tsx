import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import { authStore } from "../auth/store/auth-store";
import {
  getWorkbenchSnapshot,
  type WorkbenchSnapshotDto
} from "../conversation/api/conversation-api";
import {
  FileContextPanel,
  type FileContextPanelWorkbenchShellOverrides
} from "../conversation/components/FileContextPanel";
import { FileViewerPanel } from "../conversation/components/FileViewerModal";
import {
  GitSidebar,
  type GitSidebarWorkbenchShellOverrides
} from "../conversation/components/GitSidebar";
import type { WorkspaceSessionGroup } from "../conversation/components/WorkbenchLayout";
import { useLocalUiPreferenceSelector } from "../../preferences/local-ui-preference-store";
import {
  TerminalManagerPanel,
  type TerminalManagerPanelWorkbenchShellOverrides
} from "../workbench/components/TerminalManagerPanel";
import {
  AffairsAuxiliaryPanel,
  AffairsWorkbenchProvider,
  AffairsWorkbenchView
} from "../workbench/components/AffairsWorkbenchView";
import {
  TerminalPage,
  type TerminalPageWorkbenchShellOverrides
} from "../terminal/pages/TerminalPage";
import { mapWorkbenchSnapshotToNavigationGroups } from "../workbench/utils/workbench-navigation-snapshot";
import { buildWorkspaceSessionIndexPath } from "../workbench/utils/workbench-navigation";
import {
  createDefaultAffairsLibraryLandingState,
  readAffairsViewState,
  writeAffairsViewState
} from "../workbench/utils/workbench-mode";
import type { AffairsViewState } from "../workbench/types/workbench-mode";
import { WorkbenchRealtimeClient } from "../../network/workbench-realtime-client";
import { resolveMacOsNativeTitlebarDragRegion } from "../../platform/desktop/window-drag";
import type { WindowDescriptor } from "../../platform/desktop/window-descriptor";
import { usePlatform } from "../../platform/platform-provider";
import { t } from "../../shared/i18n";

function createEmptyWorkbenchShellOverrides(
  navigationGroups: WorkspaceSessionGroup[]
): FileContextPanelWorkbenchShellOverrides {
  return {
    navigationGroups,
    subscribeFileTree: () => undefined,
    requestFileTreeRefresh: () => undefined,
    addFileTreeSnapshotListener: () => () => undefined,
    subscribeGitSnapshot: () => undefined,
    requestGitRefresh: () => undefined,
    addGitSnapshotListener: () => () => undefined
  };
}

function createEmptyGitWorkbenchShellOverrides(): GitSidebarWorkbenchShellOverrides {
  return {
    subscribeGitSnapshot: () => undefined,
    requestGitRefresh: () => undefined,
    addGitSnapshotListener: () => () => undefined
  };
}

function createEmptyTerminalManagerWorkbenchShellOverrides(): TerminalManagerPanelWorkbenchShellOverrides {
  return {
    subscribeTerminalManagerSnapshot: () => undefined,
    requestTerminalManagerRefresh: () => undefined,
    addTerminalManagerSnapshotListener: () => () => undefined
  };
}

function createEmptyTerminalWorkbenchShellOverrides(
  currentWorkspaceId: string | null,
  navigationGroups: WorkspaceSessionGroup[]
): TerminalPageWorkbenchShellOverrides {
  return {
    navigationGroups,
    currentWorkspaceId,
    selectWorkspace: () => undefined,
    subscribeTerminalManagerSnapshot: () => undefined,
    requestTerminalManagerRefresh: () => undefined,
    addTerminalManagerSnapshotListener: () => () => undefined
  };
}

function resolveDesktopWindowTitle(descriptor: WindowDescriptor): string {
  if (descriptor.kind === "file-preview") {
    return t("conversation.fileViewerWindowTitle");
  }

  if (descriptor.kind === "files") {
    return t("shell.filesEntry");
  }

  if (descriptor.kind === "git") {
    return t("shell.gitEntry");
  }

  if (descriptor.kind === "processes") {
    return t("shell.terminalManagerEntry");
  }

  if (descriptor.kind === "terminals") {
    return t("shell.terminalsEntry");
  }

  if (descriptor.kind === "affairs") {
    return t("shell.workbenchModeAffairs");
  }

  if (descriptor.kind === "code") {
    return t("shell.workbenchModeCode");
  }

  return descriptor.kind;
}

function resolveDesktopWindowWorkspaceName(
  descriptor: WindowDescriptor,
  navigationGroups: WorkspaceSessionGroup[]
): string | null {
  return (
    descriptor.workspaceName
    ?? (
      descriptor.workspaceId
        ? navigationGroups.find((group) => group.workspace.id === descriptor.workspaceId)?.workspace.name ?? null
        : null
    )
  );
}

function resolveFileNameFromPath(filePath: string | null | undefined): string | null {
  const normalizedPath = filePath?.trim().replace(/\\/g, "/") ?? "";
  if (!normalizedPath) {
    return null;
  }

  return normalizedPath.split("/").filter(Boolean).at(-1) ?? normalizedPath;
}

function resolveDesktopCodeWindowRoute(descriptor: WindowDescriptor): string | null {
  const routePath = descriptor.payload.routePath?.trim() ?? "";

  if (routePath) {
    return routePath;
  }

  const workspaceId = descriptor.workspaceId?.trim() ?? "";
  return workspaceId ? buildWorkspaceSessionIndexPath(workspaceId) : null;
}

function resolveDesktopWindowNativeTitle(
  descriptor: WindowDescriptor,
  navigationGroups: WorkspaceSessionGroup[]
): string {
  const workspaceName = resolveDesktopWindowWorkspaceName(descriptor, navigationGroups);

  if (descriptor.kind === "file-preview") {
    const fileName = resolveFileNameFromPath(descriptor.payload.filePath) ?? resolveDesktopWindowTitle(descriptor);
    return workspaceName ? `${fileName}（${workspaceName}）` : fileName;
  }

  const sectionTitle = resolveDesktopWindowTitle(descriptor);

  if (!workspaceName) {
    return `CodingNS - ${sectionTitle}`;
  }

  return `CodingNS - ${sectionTitle}（${workspaceName}）`;
}

export function DesktopWindowPage() {
  const { windowId } = useParams<{ windowId: string }>();
  const navigate = useNavigate();
  const platform = usePlatform();
  const macOsNativeTitlebarDragRegion = resolveMacOsNativeTitlebarDragRegion(platform);
  const sessionDisplaySortMode = useLocalUiPreferenceSelector((state) => state.sessionDisplaySortMode);
  const [descriptor, setDescriptor] = useState<WindowDescriptor | null>(null);
  const [descriptorLoading, setDescriptorLoading] = useState(true);
  const [descriptorError, setDescriptorError] = useState<string | null>(null);
  const [navigationGroups, setNavigationGroups] = useState<WorkspaceSessionGroup[]>([]);
  const [realtimeClient, setRealtimeClient] = useState<WorkbenchRealtimeClient | null>(null);
  const [affairsViewState, setAffairsViewState] = useState<AffairsViewState | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDescriptor() {
      if (!windowId) {
        setDescriptor(null);
        setDescriptorLoading(false);
        setDescriptorError(t("desktopWindow.invalidWindowId"));
        return;
      }

      setDescriptorLoading(true);
      setDescriptorError(null);

      const bridgeResult = await platform.bridge.getWindowDescriptor(windowId);
      const resolvedDescriptor = bridgeResult.ok
        ? bridgeResult.value ?? null
        : platform.windows.getDescriptor(windowId);

      if (cancelled) {
        return;
      }

      if (!resolvedDescriptor) {
        setDescriptor(null);
        setDescriptorLoading(false);
        setDescriptorError(bridgeResult.detail ?? t("desktopWindow.loadDescriptorFailed"));
        return;
      }

      platform.windows.registerDescriptor(resolvedDescriptor);
      platform.windows.markWindowOpen(resolvedDescriptor.windowId);
      setDescriptor(resolvedDescriptor);
      setDescriptorLoading(false);
    }

    void loadDescriptor();

    return () => {
      cancelled = true;
    };
  }, [platform, windowId]);

  useEffect(() => {
    if (!descriptor?.workspaceId) {
      setNavigationGroups([]);
      setAffairsViewState(null);
      return;
    }

    setAffairsViewState(
      readAffairsViewState(descriptor.workspaceId)
      ?? createDefaultAffairsLibraryLandingState(descriptor.workspaceId)
    );

    let cancelled = false;

    async function loadWorkbenchSnapshot() {
      try {
        const snapshot = await getWorkbenchSnapshot();

        if (cancelled) {
          return;
        }

        setNavigationGroups(
          mapWorkbenchSnapshotToNavigationGroups(
            snapshot as WorkbenchSnapshotDto | null | undefined,
            sessionDisplaySortMode
          ) as WorkspaceSessionGroup[]
        );
      } catch {
        if (cancelled) {
          return;
        }

        setNavigationGroups([]);
      }
    }

    void loadWorkbenchSnapshot();

    return () => {
      cancelled = true;
    };
  }, [descriptor?.workspaceId, sessionDisplaySortMode]);

  useEffect(() => {
    if (!descriptor) {
      setRealtimeClient(null);
      return;
    }

    const client = new WorkbenchRealtimeClient({
      onConnectionChange: () => undefined,
      onSnapshot: (snapshot) => {
        setNavigationGroups(mapWorkbenchSnapshotToNavigationGroups(snapshot, sessionDisplaySortMode));
      },
      onUnauthorized: () => {
        authStore.clear();
        navigate(`/login?returnTo=${encodeURIComponent(`/desktop-window/${descriptor.windowId}`)}`, {
          replace: true
        });
      }
    });

    setRealtimeClient(client);
    client.start();

    return () => {
      client.close();
      setRealtimeClient(null);
    };
  }, [descriptor, navigate, sessionDisplaySortMode]);

  useEffect(() => {
    if (!platform.isDesktop || !platform.bridge.supported || !descriptor || descriptor.mode !== "external") {
      return;
    }

    const title = resolveDesktopWindowNativeTitle(descriptor, navigationGroups);
    document.title = title;

    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
      .catch(() => undefined);
  }, [descriptor, navigationGroups, platform.bridge.supported, platform.isDesktop]);

  const workbenchShellOverrides = useMemo<FileContextPanelWorkbenchShellOverrides>(() => {
    if (!realtimeClient) {
      return createEmptyWorkbenchShellOverrides(navigationGroups);
    }

    return {
      navigationGroups,
      subscribeFileTree: realtimeClient.subscribeFileTree.bind(realtimeClient),
      requestFileTreeRefresh: realtimeClient.requestFileTreeRefresh.bind(realtimeClient),
      addFileTreeSnapshotListener: realtimeClient.addFileTreeSnapshotListener.bind(realtimeClient),
      subscribeGitSnapshot: realtimeClient.subscribeGit.bind(realtimeClient),
      requestGitRefresh: realtimeClient.requestGitRefresh.bind(realtimeClient),
      addGitSnapshotListener: realtimeClient.addGitSnapshotListener.bind(realtimeClient)
    };
  }, [navigationGroups, realtimeClient]);

  const gitWorkbenchShellOverrides = useMemo<GitSidebarWorkbenchShellOverrides>(() => {
    if (!realtimeClient) {
      return createEmptyGitWorkbenchShellOverrides();
    }

    return {
      subscribeGitSnapshot: realtimeClient.subscribeGit.bind(realtimeClient),
      requestGitRefresh: realtimeClient.requestGitRefresh.bind(realtimeClient),
      addGitSnapshotListener: realtimeClient.addGitSnapshotListener.bind(realtimeClient)
    };
  }, [realtimeClient]);

  const terminalManagerWorkbenchShellOverrides =
    useMemo<TerminalManagerPanelWorkbenchShellOverrides>(() => {
      if (!realtimeClient) {
        return createEmptyTerminalManagerWorkbenchShellOverrides();
      }

      return {
        subscribeTerminalManagerSnapshot: realtimeClient.subscribeTerminalManager.bind(realtimeClient),
        requestTerminalManagerRefresh: realtimeClient.requestTerminalManagerRefresh.bind(realtimeClient),
        addTerminalManagerSnapshotListener:
          realtimeClient.addTerminalManagerSnapshotListener.bind(realtimeClient)
      };
    }, [realtimeClient]);
  const terminalWorkbenchShellOverrides = useMemo<TerminalPageWorkbenchShellOverrides>(() => {
    if (!realtimeClient) {
      return createEmptyTerminalWorkbenchShellOverrides(
        descriptor?.workspaceId ?? null,
        navigationGroups
      );
    }

    return {
      navigationGroups,
      currentWorkspaceId: descriptor?.workspaceId ?? null,
      selectWorkspace: () => undefined,
      subscribeTerminalManagerSnapshot: realtimeClient.subscribeTerminalManager.bind(realtimeClient),
      requestTerminalManagerRefresh: realtimeClient.requestTerminalManagerRefresh.bind(realtimeClient),
      addTerminalManagerSnapshotListener:
        realtimeClient.addTerminalManagerSnapshotListener.bind(realtimeClient)
    };
  }, [descriptor?.workspaceId, navigationGroups, realtimeClient]);
  if (!platform.isDesktop) {
    return <Navigate to="/" replace />;
  }

  if (descriptorLoading) {
    return (
      <main className="desktop-window-page">
        <p className="status-text">{t("common.loading")}</p>
      </main>
    );
  }

  if (descriptorError) {
    return (
      <main className="desktop-window-page">
        <p className="status-text">{descriptorError}</p>
      </main>
    );
  }

  if (!descriptor) {
    return (
      <main className="desktop-window-page">
        <p className="status-text">{t("desktopWindow.loadDescriptorFailed")}</p>
      </main>
    );
  }

  if (descriptor.kind === "code") {
    const routePath = resolveDesktopCodeWindowRoute(descriptor);

    if (!routePath) {
      return (
        <main className="desktop-window-page">
          <p className="status-text">{t("desktopWindow.invalidCodeTarget")}</p>
        </main>
      );
    }

    return <Navigate to={routePath} replace />;
  }

  const workspaceName = descriptor ? resolveDesktopWindowWorkspaceName(descriptor, navigationGroups) : null;

  const handleAffairsViewStateChange = (nextState: AffairsViewState) => {
    setAffairsViewState(nextState);
    writeAffairsViewState(nextState);
  };

  let content: JSX.Element | null = null;

  if (descriptor.kind === "file-preview") {
    const previewFilePath = descriptor.payload.filePath?.trim() ?? "";

    const workspaceName = resolveDesktopWindowWorkspaceName(descriptor, navigationGroups);
    content = previewFilePath ? (
      <FileViewerPanel
        workspaceId={descriptor.workspaceId}
        filePath={previewFilePath}
        open
        chrome="window"
        windowTitle={resolveFileNameFromPath(previewFilePath) ?? previewFilePath}
        onClose={() => void platform.bridge.setWindowState("close")}
        onSaved={() => undefined}
      />
    ) : (
      <p className="status-text">{t("desktopWindow.invalidFilePreviewTarget")}</p>
    );
  } else if (descriptor.kind === "files") {
    content = (
      <FileContextPanel
        sessionId={descriptor.sessionId}
        workspaceId={descriptor.workspaceId}
        externalWindowMode
        workbenchShellOverrides={workbenchShellOverrides}
      />
    );
  } else if (descriptor.kind === "git") {
    content = (
      <GitSidebar
        workspaceId={descriptor.workspaceId}
        externalWindowMode
        workbenchShellOverrides={gitWorkbenchShellOverrides}
      />
    );
  } else if (descriptor.kind === "processes") {
    content = (
      <TerminalManagerPanel
        currentWorkspaceId={descriptor.workspaceId}
        navigationGroups={navigationGroups}
        externalWindowMode
        workbenchShellOverrides={terminalManagerWorkbenchShellOverrides}
      />
    );
  } else if (descriptor.kind === "terminals") {
    content = (
      <TerminalPage
        externalWindowMode
        externalWindowWorkspaceId={descriptor.workspaceId}
        workbenchShellOverrides={terminalWorkbenchShellOverrides}
      />
    );
  } else if (descriptor.kind === "affairs") {
    const externalWorkspaceId = descriptor.workspaceId?.trim() ?? "";
    const effectiveAffairsViewState =
      affairsViewState && affairsViewState.workspaceId === externalWorkspaceId
        ? affairsViewState
        : (externalWorkspaceId ? createDefaultAffairsLibraryLandingState(externalWorkspaceId) : null);

    content = externalWorkspaceId && effectiveAffairsViewState ? (
      <AffairsWorkbenchProvider
        workspaceId={externalWorkspaceId}
        workspaceName={workspaceName}
        navigationGroups={navigationGroups}
        state={effectiveAffairsViewState}
        onStateChange={handleAffairsViewStateChange}
      >
        <div className="desktop-affairs-window-shell">
          <div className="desktop-affairs-window-main">
            <AffairsWorkbenchView workspaceId={externalWorkspaceId} />
          </div>
          <aside className="desktop-affairs-window-auxiliary surface-card">
            <AffairsAuxiliaryPanel workspaceId={externalWorkspaceId} />
          </aside>
        </div>
      </AffairsWorkbenchProvider>
    ) : (
      <p className="status-text">{t("desktopWindow.invalidAffairsTarget")}</p>
    );
  }

  if (!content) {
    return (
      <main className="desktop-window-page">
        <p className="status-text">
          {t("desktopWindow.unsupportedKind", {
            kind: descriptor.kind
          })}
        </p>
      </main>
    );
  }

  const desktopWindowTitle = resolveDesktopWindowTitle(descriptor);
  const desktopWindowWorkspaceName = resolveDesktopWindowWorkspaceName(descriptor, navigationGroups);
  const shouldRenderDesktopWindowDragHeader =
    descriptor.mode === "external" && descriptor.kind === "processes";

  return (
    <main className="desktop-window-page">
      {shouldRenderDesktopWindowDragHeader ? (
        <header
          className="desktop-window-drag-header"
          data-window-kind={descriptor.kind}
          data-window-drag-handle="desktop-window-drag-header"
          data-tauri-drag-region={macOsNativeTitlebarDragRegion}
          aria-label={desktopWindowTitle}
        >
          <div
            className="desktop-window-drag-header-copy"
            data-tauri-drag-region={macOsNativeTitlebarDragRegion}
          >
            <span
              className="desktop-window-drag-header-tag"
              data-tauri-drag-region={macOsNativeTitlebarDragRegion}
            >
              {desktopWindowTitle}
            </span>
            <strong data-tauri-drag-region={macOsNativeTitlebarDragRegion}>
              {desktopWindowWorkspaceName ?? desktopWindowTitle}
            </strong>
          </div>
        </header>
      ) : null}
      <div
        className="desktop-window-body"
        data-window-kind={descriptor.kind}
        aria-label={desktopWindowTitle}
      >
        {content}
      </div>
    </main>
  );
}
