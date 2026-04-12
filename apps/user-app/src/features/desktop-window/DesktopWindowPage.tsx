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
import {
  GitSidebar,
  type GitSidebarWorkbenchShellOverrides
} from "../conversation/components/GitSidebar";
import type { WorkspaceSessionGroup } from "../conversation/components/WorkbenchLayout";
import {
  TerminalManagerPanel,
  type TerminalManagerPanelWorkbenchShellOverrides
} from "../workbench/components/TerminalManagerPanel";
import { WorkbenchRealtimeClient } from "../../network/workbench-realtime-client";
import type { WindowDescriptor } from "../../platform/desktop/window-descriptor";
import { usePlatform } from "../../platform/platform-provider";
import { t } from "../../shared/i18n";

function mapWorkbenchSnapshotToGroups(snapshot: WorkbenchSnapshotDto | null | undefined): WorkspaceSessionGroup[] {
  if (!snapshot || !Array.isArray(snapshot.items)) {
    return [];
  }

  return snapshot.items.map((item) => ({
    workspace: item.workspace,
    sessions: [...item.sessions].sort((left, right) =>
      (right.lastMessageAt ?? right.updatedAt).localeCompare(left.lastMessageAt ?? left.updatedAt)
    ),
    childWorktrees: Array.isArray(item.childWorktrees) ? item.childWorktrees : []
  }));
}

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

function resolveDesktopWindowTitle(descriptor: WindowDescriptor): string {
  if (descriptor.kind === "files") {
    return t("shell.filesEntry");
  }

  if (descriptor.kind === "git") {
    return t("shell.gitEntry");
  }

  if (descriptor.kind === "processes") {
    return t("shell.terminalManagerEntry");
  }

  return descriptor.kind;
}

export function DesktopWindowPage() {
  const { windowId } = useParams<{ windowId: string }>();
  const navigate = useNavigate();
  const platform = usePlatform();
  const [descriptor, setDescriptor] = useState<WindowDescriptor | null>(null);
  const [descriptorLoading, setDescriptorLoading] = useState(true);
  const [descriptorError, setDescriptorError] = useState<string | null>(null);
  const [navigationGroups, setNavigationGroups] = useState<WorkspaceSessionGroup[]>([]);
  const [realtimeClient, setRealtimeClient] = useState<WorkbenchRealtimeClient | null>(null);

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
      return;
    }

    let cancelled = false;

    async function loadWorkbenchSnapshot() {
      try {
        const snapshot = await getWorkbenchSnapshot();

        if (cancelled) {
          return;
        }

        setNavigationGroups(mapWorkbenchSnapshotToGroups(snapshot));
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
  }, [descriptor?.workspaceId]);

  useEffect(() => {
    if (!descriptor) {
      setRealtimeClient(null);
      return;
    }

    const client = new WorkbenchRealtimeClient({
      onConnectionChange: () => undefined,
      onSnapshot: (snapshot) => {
        setNavigationGroups(mapWorkbenchSnapshotToGroups(snapshot));
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
  }, [descriptor, navigate]);

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

  let content: JSX.Element | null = null;

  if (descriptor.kind === "files") {
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

  return (
    <main className="desktop-window-page">
      <div
        className="desktop-window-body"
        data-window-kind={descriptor.kind}
        aria-label={resolveDesktopWindowTitle(descriptor)}
      >
        {content}
      </div>
    </main>
  );
}
