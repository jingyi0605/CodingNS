import { fireEvent, render, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearViewSnapshot,
  readViewSnapshot,
  writeViewSnapshot
} from "../../../shared/cache/view-snapshot-cache";
import { localUiPreferenceStore } from "../../../preferences/local-ui-preference-store";
import { userPreferenceStore } from "../../../preferences/user-preference-store";
import { t } from "../../../shared/i18n";
import { ToastProvider } from "../../../shared/toast";
import { FileContextPanel } from "./FileContextPanel";

const WORKSPACE_TREE_SNAPSHOT_KEY = "file-panel.workspace-tree.workspace-1";
const SESSION_COUNT_SNAPSHOT_KEY = "file-panel.session-change-count.workspace-1.session-1";
const DEFAULT_FILE_PREVIEW_CAPABILITIES = {
  canEdit: true,
  canRefresh: true,
  canResize: true,
  canZoom: true,
  canPaginate: false
} as const;

const fileApiMock = vi.hoisted(() => ({
  getFileTree: vi.fn(),
  operateFile: vi.fn(),
  searchFiles: vi.fn(),
  getFilePreview: vi.fn(),
  saveFileContent: vi.fn(),
  uploadFile: vi.fn(),
  downloadFile: vi.fn()
}));

const conversationApiMock = vi.hoisted(() => ({
  getSessionChangedFiles: vi.fn()
}));

const gitApiMock = vi.hoisted(() => ({
  getGitStatus: vi.fn(),
  getGitDiff: vi.fn(),
  stageGitTargets: vi.fn(),
  addGitIgnoreTargets: vi.fn()
}));

const clipboardWriteTextMock = vi.hoisted(() => vi.fn());
const showDesktopContextMenuMock = vi.hoisted(() => vi.fn());
const createObjectUrlMock = vi.hoisted(() => vi.fn(() => "blob:mock-file"));
const revokeObjectUrlMock = vi.hoisted(() => vi.fn());
const anchorClickMock = vi.hoisted(() => vi.fn());
const initialPreferenceState = userPreferenceStore.getState();
const fileTreeSnapshotListeners = new Set<
  (snapshot: { workspaceId: string; path: string; items: unknown[] }) => void
>();
const gitSnapshotListeners = new Set<
  (snapshot: { workspaceId: string; status?: { changes: unknown[] } }) => void
>();

const workbenchShellMock = vi.hoisted(() => ({
  navigationGroups: [
    {
      workspace: {
        id: "workspace-1",
        name: "CodingNS",
        path: "C:/Code/CodingNS",
        repoRoot: "C:/Code/CodingNS"
      },
      sessions: []
    }
  ],
  subscribeGitSnapshot: vi.fn(),
  requestGitRefresh: vi.fn(async (workspaceId: string) => {
    const response = await gitApiMock.getGitStatus(workspaceId);

    queueMicrotask(() => {
      gitSnapshotListeners.forEach((listener) => {
        listener({
          workspaceId,
          status: {
            changes: response.changes ?? []
          }
        });
      });
    });
  }),
  addGitSnapshotListener: vi.fn((listener: (snapshot: {
    workspaceId: string;
    status?: { changes: unknown[] };
  }) => void) => {
    gitSnapshotListeners.add(listener);
    return () => {
      gitSnapshotListeners.delete(listener);
    };
  }),
  subscribeFileTree: vi.fn(),
  requestFileTreeRefresh: vi.fn(),
  addFileTreeSnapshotListener: vi.fn((listener: (snapshot: {
    workspaceId: string;
    path: string;
    items: unknown[];
  }) => void) => {
    fileTreeSnapshotListeners.add(listener);
    return () => {
      fileTreeSnapshotListeners.delete(listener);
    };
  })
}));

const platformMock = vi.hoisted(() => ({
  platform: "web",
  isDesktop: false,
  isWeb: true,
  isMobile: false,
  isNativeMobile: false,
  viewportClass: "expanded",
  ui: {
    osFamily: "unknown",
    windowControlsStyle: "none",
    prefersDesktopChrome: false,
    prefersOverlayTitlebar: false,
    prefersSystemFontStack: true
  },
  bridge: {
    supported: false,
    openExternal: vi.fn(),
    showNotification: vi.fn(),
    writeClipboardText: vi.fn(),
    setWindowState: vi.fn(),
    readDesktopConfig: vi.fn(),
    writeDesktopConfig: vi.fn(),
    getRuntimeInfo: vi.fn(),
    installUpdate: vi.fn(),
    rollbackToPreviousVersion: vi.fn(),
    pickDirectory: vi.fn()
  }
}));

const rootItemsMock = [
  {
    path: "config.json",
    name: "config.json",
    kind: "file",
    size: 42,
    updatedAt: "2026-03-24T12:00:00.000Z"
  },
  {
    path: "settings.yaml",
    name: "settings.yaml",
    kind: "file",
    size: 36,
    updatedAt: "2026-03-24T12:00:00.000Z"
  },
  {
    path: "docs.md",
    name: "docs.md",
    kind: "file",
    size: 120,
    updatedAt: "2026-03-24T12:00:00.000Z"
  },
  {
    path: "app.toml",
    name: "app.toml",
    kind: "file",
    size: 84,
    updatedAt: "2026-03-24T12:00:00.000Z"
  },
  {
    path: "profile.ini",
    name: "profile.ini",
    kind: "file",
    size: 56,
    updatedAt: "2026-03-24T12:00:00.000Z"
  },
  {
    path: ".env.local",
    name: ".env.local",
    kind: "file",
    size: 64,
    updatedAt: "2026-03-24T12:00:00.000Z"
  },
  {
    path: "gradle.properties",
    name: "gradle.properties",
    kind: "file",
    size: 72,
    updatedAt: "2026-03-24T12:00:00.000Z"
  },
  {
    path: "app.conf",
    name: "app.conf",
    kind: "file",
    size: 68,
    updatedAt: "2026-03-24T12:00:00.000Z"
  },
  {
    path: ".editorconfig",
    name: ".editorconfig",
    kind: "file",
    size: 96,
    updatedAt: "2026-03-24T12:00:00.000Z"
  },
  {
    path: "Dockerfile",
    name: "Dockerfile",
    kind: "file",
    size: 128,
    updatedAt: "2026-03-24T12:00:00.000Z"
  },
  {
    path: ".gitignore",
    name: ".gitignore",
    kind: "file",
    size: 48,
    updatedAt: "2026-03-24T12:00:00.000Z"
  },
  {
    path: "server.log",
    name: "server.log",
    kind: "file",
    size: 144,
    updatedAt: "2026-03-24T12:00:00.000Z"
  }
] as const;

vi.mock("../api/file-context-api", () => ({
  getFileTree: fileApiMock.getFileTree,
  operateFile: fileApiMock.operateFile,
  searchFiles: fileApiMock.searchFiles,
  getFilePreview: fileApiMock.getFilePreview,
  saveFileContent: fileApiMock.saveFileContent,
  uploadFile: fileApiMock.uploadFile,
  downloadFile: fileApiMock.downloadFile
}));

vi.mock("../api/conversation-api", () => ({
  getSessionChangedFiles: conversationApiMock.getSessionChangedFiles
}));

vi.mock("../api/git-api", () => ({
  getGitStatus: gitApiMock.getGitStatus,
  getGitDiff: gitApiMock.getGitDiff,
  stageGitTargets: gitApiMock.stageGitTargets,
  addGitIgnoreTargets: gitApiMock.addGitIgnoreTargets
}));

vi.mock("./WorkbenchLayout", () => ({
  useWorkbenchShell: () => workbenchShellMock
}));

vi.mock("../../../platform/platform-provider", () => ({
  usePlatform: () => platformMock
}));

vi.mock("../../../platform/desktop/desktop-context-menu", () => ({
  showDesktopContextMenu: showDesktopContextMenuMock
}));

function createPreferenceState(language: "zh-CN" | "en-US") {
  return {
    initialized: true,
    profile: {
      language,
      theme: "light" as const,
      autoTheme: false,
      defaultPermissionMode: "default" as const
    },
    providers: {
      "claude-code": {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      codex: {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      opencode: {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      gemini: {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      kimi: {
        defaultModel: null,
        defaultReasoningLevel: null
      }
    },
    updatedAt: null,
    source: "default" as const
  };
}

describe("FileContextPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userPreferenceStore.hydrate(createPreferenceState("zh-CN"));
    fileTreeSnapshotListeners.clear();
    gitSnapshotListeners.clear();
    window.localStorage.clear();
    localUiPreferenceStore.setShowSystemFiles(false);
    window.sessionStorage.clear();
    clearViewSnapshot(WORKSPACE_TREE_SNAPSHOT_KEY);
    clearViewSnapshot(SESSION_COUNT_SNAPSHOT_KEY);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock
      }
    });
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrlMock
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrlMock
    });
    Object.defineProperty(HTMLAnchorElement.prototype, "click", {
      configurable: true,
      value: anchorClickMock
    });
    platformMock.platform = "web";
    platformMock.isDesktop = false;
    platformMock.isWeb = true;
    platformMock.isMobile = false;
    platformMock.isNativeMobile = false;
    platformMock.viewportClass = "expanded";
    platformMock.ui.osFamily = "unknown";
    platformMock.bridge.supported = false;
    platformMock.bridge.writeClipboardText.mockResolvedValue({
      ok: true
    });
    workbenchShellMock.navigationGroups[0].workspace.path = "C:/Code/CodingNS";
    workbenchShellMock.navigationGroups[0].workspace.repoRoot = "C:/Code/CodingNS";

    fileApiMock.getFileTree.mockResolvedValue({
      items: [...rootItemsMock]
    });

    workbenchShellMock.requestFileTreeRefresh.mockImplementation(
      async (workspaceId: string, paths?: string[], options?: { targetHostId?: string | null }) => {
        const targetPaths = paths && paths.length > 0 ? paths : [""];

        await Promise.all(
          targetPaths.map(async (path) => {
            const response = await fileApiMock.getFileTree(
              workspaceId,
              path ? path : undefined,
              ...(options?.targetHostId ? [{ targetHostId: options.targetHostId }] : [])
            );

            queueMicrotask(() => {
              fileTreeSnapshotListeners.forEach((listener) => {
                listener({
                  workspaceId,
                  path,
                  items: response.items,
                  targetHostId: options?.targetHostId ?? null
                });
              });
            });
          })
        );
      }
    );

    fileApiMock.operateFile.mockResolvedValue({
      success: true,
      opType: "create_file"
    });

    fileApiMock.searchFiles.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20
    });

    conversationApiMock.getSessionChangedFiles.mockResolvedValue({
      items: []
    });

    gitApiMock.getGitStatus.mockResolvedValue({
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/Code/CodingNS",
        branch: "main",
        ahead: 0,
        behind: 0,
        hasRemote: true,
        isDirty: true,
        lastFetchedAt: null
      },
      changes: []
    });

    gitApiMock.stageGitTargets.mockResolvedValue({
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/Code/CodingNS",
        branch: "main",
        ahead: 0,
        behind: 0,
        hasRemote: true,
        isDirty: true,
        lastFetchedAt: null
      },
      changes: []
    });
    gitApiMock.getGitDiff.mockResolvedValue({
      content: ""
    });

    fileApiMock.getFilePreview.mockImplementation(async (_workspaceId: string, filePath: string) => {
      if (filePath === "config.json") {
        return {
          workspaceId: "workspace-1",
          path: "config.json",
          supported: true,
          kind: "text",
          reason: null,
          content: '{\n  "name": "demo",\n  "enabled": true\n}',
          version: "json-version-1",
          size: 42,
          updatedAt: "2026-03-24T12:01:00.000Z",
          previewPath: null,
          previewUrl: null,
          onlyOffice: null,
          capabilities: DEFAULT_FILE_PREVIEW_CAPABILITIES
        };
      }

      if (filePath === "settings.yaml") {
        return {
          workspaceId: "workspace-1",
          path: "settings.yaml",
          supported: true,
          kind: "text",
          reason: null,
          content: "name: demo\nenabled: true\n",
          version: "yaml-version-1",
          size: 36,
          updatedAt: "2026-03-24T12:01:00.000Z",
          previewPath: null,
          previewUrl: null,
          onlyOffice: null,
          capabilities: DEFAULT_FILE_PREVIEW_CAPABILITIES
        };
      }

      if (filePath === "app.toml") {
        return {
          workspaceId: "workspace-1",
          path: "app.toml",
          supported: true,
          kind: "text",
          reason: null,
          content: '[database]\nport = 5432\nenabled = true\n',
          version: "toml-version-1",
          size: 84,
          updatedAt: "2026-03-24T12:01:00.000Z",
          previewPath: null,
          previewUrl: null,
          onlyOffice: null,
          capabilities: DEFAULT_FILE_PREVIEW_CAPABILITIES
        };
      }

      if (filePath === "profile.ini") {
        return {
          workspaceId: "workspace-1",
          path: "profile.ini",
          supported: true,
          kind: "text",
          reason: null,
          content: '[user]\nname=demo\nenabled=yes\n',
          version: "ini-version-1",
          size: 56,
          updatedAt: "2026-03-24T12:01:00.000Z",
          previewPath: null,
          previewUrl: null,
          onlyOffice: null,
          capabilities: DEFAULT_FILE_PREVIEW_CAPABILITIES
        };
      }

      if (filePath === ".env.local") {
        return {
          workspaceId: "workspace-1",
          path: ".env.local",
          supported: true,
          kind: "text",
          reason: null,
          content: 'NODE_ENV="development"\nPORT=3000\n',
          version: "env-version-1",
          size: 64,
          updatedAt: "2026-03-24T12:01:00.000Z",
          previewPath: null,
          previewUrl: null,
          onlyOffice: null,
          capabilities: DEFAULT_FILE_PREVIEW_CAPABILITIES
        };
      }

      if (filePath === "gradle.properties") {
        return {
          workspaceId: "workspace-1",
          path: "gradle.properties",
          supported: true,
          kind: "text",
          reason: null,
          content: "org.gradle.jvmargs=-Xmx2g\nbuild.cache=true\n",
          version: "properties-version-1",
          size: 72,
          updatedAt: "2026-03-24T12:01:00.000Z",
          previewPath: null,
          previewUrl: null,
          onlyOffice: null,
          capabilities: DEFAULT_FILE_PREVIEW_CAPABILITIES
        };
      }

      if (filePath === "app.conf") {
        return {
          workspaceId: "workspace-1",
          path: "app.conf",
          supported: true,
          kind: "text",
          reason: null,
          content: "[server]\nport=8080\nenabled=on\n",
          version: "conf-version-1",
          size: 68,
          updatedAt: "2026-03-24T12:01:00.000Z",
          previewPath: null,
          previewUrl: null,
          onlyOffice: null,
          capabilities: DEFAULT_FILE_PREVIEW_CAPABILITIES
        };
      }

      if (filePath === ".editorconfig") {
        return {
          workspaceId: "workspace-1",
          path: ".editorconfig",
          supported: true,
          kind: "text",
          reason: null,
          content: "root = true\n\n[*]\nindent_style = space\n",
          version: "editorconfig-version-1",
          size: 96,
          updatedAt: "2026-03-24T12:01:00.000Z",
          previewPath: null,
          previewUrl: null,
          onlyOffice: null,
          capabilities: DEFAULT_FILE_PREVIEW_CAPABILITIES
        };
      }

      if (filePath === "Dockerfile") {
        return {
          workspaceId: "workspace-1",
          path: "Dockerfile",
          supported: true,
          kind: "text",
          reason: null,
          content: "FROM node:20-alpine\nWORKDIR /app\nRUN pnpm install\n",
          version: "dockerfile-version-1",
          size: 128,
          updatedAt: "2026-03-24T12:01:00.000Z",
          previewPath: null,
          previewUrl: null,
          onlyOffice: null,
          capabilities: DEFAULT_FILE_PREVIEW_CAPABILITIES
        };
      }

      if (filePath === ".gitignore") {
        return {
          workspaceId: "workspace-1",
          path: ".gitignore",
          supported: true,
          kind: "text",
          reason: null,
          content: "node_modules/\n*.log\n!.env.example\n",
          version: "gitignore-version-1",
          size: 48,
          updatedAt: "2026-03-24T12:01:00.000Z",
          previewPath: null,
          previewUrl: null,
          onlyOffice: null,
          capabilities: DEFAULT_FILE_PREVIEW_CAPABILITIES
        };
      }

      if (filePath === "server.log") {
        return {
          workspaceId: "workspace-1",
          path: "server.log",
          supported: true,
          kind: "text",
          reason: null,
          content: "2026-03-24 21:45:01 INFO server started\n2026-03-24 21:45:03 ERROR port in use\n",
          version: "log-version-1",
          size: 144,
          updatedAt: "2026-03-24T12:01:00.000Z",
          previewPath: null,
          previewUrl: null,
          onlyOffice: null,
          capabilities: DEFAULT_FILE_PREVIEW_CAPABILITIES
        };
      }

      return {
        workspaceId: "workspace-1",
        path: "docs.md",
        supported: true,
        kind: "text",
        reason: null,
        content: "# 鏍囬\n\n```ts\nconst answer = 42;\n```\n",
        version: "md-version-1",
        size: 38,
        updatedAt: "2026-03-24T12:01:00.000Z",
        previewPath: null,
        previewUrl: null,
        onlyOffice: null,
        capabilities: DEFAULT_FILE_PREVIEW_CAPABILITIES
      };
    });

    fileApiMock.saveFileContent.mockResolvedValue({
      version: "version-2",
      updatedAt: "2026-03-24T12:02:00.000Z"
    });
    fileApiMock.uploadFile.mockResolvedValue({
      workspaceId: "workspace-1",
      path: "config.json",
      size: 42,
      updatedAt: "2026-03-24T12:02:00.000Z"
    });
    fileApiMock.downloadFile.mockResolvedValue({
      workspaceId: "workspace-1",
      path: "config.json",
      fileName: "config.json",
      contentBase64: "eyJuYW1lIjoiZGVtbyJ9",
      size: 15,
      updatedAt: "2026-03-24T12:02:00.000Z"
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    userPreferenceStore.hydrate(initialPreferenceState);
    clearViewSnapshot(WORKSPACE_TREE_SNAPSHOT_KEY);
    clearViewSnapshot(SESSION_COUNT_SNAPSHOT_KEY);
  });

  function renderPanel(
    sessionId: string | null = "session-1",
    workspaceId = "workspace-1",
    options?: {
      hideHeading?: boolean;
      hideTabs?: boolean;
      externalWindowMode?: boolean;
      externalRevealRequest?: {
        requestId: number;
        workspaceId: string;
        filePath: string;
        openViewer: boolean;
      } | null;
      workbenchShellOverrides?: Record<string, unknown>;
    }
  ): RenderResult {
    return render(
      <ToastProvider>
        <FileContextPanel
          sessionId={sessionId}
          workspaceId={workspaceId}
          hideHeading={options?.hideHeading}
          hideTabs={options?.hideTabs}
          externalWindowMode={options?.externalWindowMode}
          externalRevealRequest={options?.externalRevealRequest}
          workbenchShellOverrides={options?.workbenchShellOverrides as never}
        />
      </ToastProvider>
    );
  }

  it("有缓存时会先显示缓存目录，并在后台静默刷新", async () => {
    writeViewSnapshot(WORKSPACE_TREE_SNAPSHOT_KEY, {
      treeCache: {
        "": [
          {
            path: "cached-dir",
            name: "cached-dir",
            kind: "directory",
            size: null,
            updatedAt: "2026-03-24T12:00:00.000Z"
          }
        ]
      },
      expandedDirectories: [],
      activeDirectoryPath: ""
    });

    fileApiMock.getFileTree.mockResolvedValue({ items: [...rootItemsMock] });

    renderPanel();

    expect(await screen.findByText("cached-dir")).toBeInTheDocument();
    expect(screen.queryByText(t("common.loading"))).not.toBeInTheDocument();
    expect(fileApiMock.getFileTree).not.toHaveBeenCalled();

    await new Promise((resolve) => window.setTimeout(resolve, 1700));

    await waitFor(() => {
      expect(fileApiMock.getFileTree).toHaveBeenCalledWith("workspace-1", undefined);
    });
  });

  it("PEERHOST 文件树会使用带 HOST 的缓存 key 和订阅参数", async () => {
    const peerWorkspaceTreeSnapshotKey = "file-panel.workspace-tree.host.peer-host-1.remote-workspace-1";

    writeViewSnapshot(peerWorkspaceTreeSnapshotKey, {
      treeCache: {
        "": [
          {
            path: "peer-cached.ts",
            name: "peer-cached.ts",
            kind: "file",
            size: 1,
            updatedAt: "2026-03-24T12:00:00.000Z"
          }
        ]
      },
      treeRevisionByPath: {
        "": "peer-revision"
      },
      expandedDirectories: [],
      activeDirectoryPath: ""
    });

    renderPanel("session-1", "remote-workspace-1", {
      workbenchShellOverrides: {
        currentTargetHostId: "peer-host-1"
      }
    });

    expect(await screen.findByText("peer-cached.ts")).toBeInTheDocument();
    await waitFor(() => {
      expect(workbenchShellMock.subscribeFileTree).toHaveBeenCalledWith(
        "remote-workspace-1",
        expect.any(Array),
        expect.objectContaining({
          targetHostId: "peer-host-1"
        })
      );
    });

    clearViewSnapshot(peerWorkspaceTreeSnapshotKey);
  });

  it("从 PEERHOST 文件作用域切回主 HOST 后不会复用旧缓存或接收旧快照", async () => {
    const peerWorkspaceTreeSnapshotKey = "file-panel.workspace-tree.host.peer-host-1.remote-workspace-1";

    writeViewSnapshot(peerWorkspaceTreeSnapshotKey, {
      treeCache: {
        "": [
          {
            path: "peer-cached.ts",
            name: "peer-cached.ts",
            kind: "file",
            size: 1,
            updatedAt: "2026-03-24T12:00:00.000Z"
          }
        ]
      },
      treeRevisionByPath: {
        "": "peer-revision"
      },
      expandedDirectories: [],
      activeDirectoryPath: ""
    });

    fileApiMock.getFileTree.mockResolvedValue({
      items: [
        {
          path: "host-main.ts",
          name: "host-main.ts",
          kind: "file",
          size: 2,
          updatedAt: "2026-03-24T12:10:00.000Z"
        }
      ]
    });

    const view = renderPanel("session-1", "remote-workspace-1", {
      workbenchShellOverrides: {
        currentTargetHostId: "peer-host-1"
      }
    });

    expect(await screen.findByText("peer-cached.ts")).toBeInTheDocument();

    workbenchShellMock.requestFileTreeRefresh.mockClear();
    workbenchShellMock.subscribeFileTree.mockClear();
    fileApiMock.getFileTree.mockClear();

    view.rerender(
      <ToastProvider>
        <FileContextPanel
          sessionId="session-1"
          workspaceId="workspace-1"
          workbenchShellOverrides={{ currentTargetHostId: null } as never}
        />
      </ToastProvider>
    );

    expect(screen.queryByText("peer-cached.ts")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(workbenchShellMock.subscribeFileTree).toHaveBeenCalledWith(
        "workspace-1",
        expect.any(Array),
        expect.not.objectContaining({
          targetHostId: "peer-host-1"
        })
      );
    });

    await waitFor(() => {
      expect(fileApiMock.getFileTree).toHaveBeenCalledWith("workspace-1", undefined);
    });

    expect(await screen.findByText("host-main.ts")).toBeInTheDocument();

    fileTreeSnapshotListeners.forEach((listener) => {
      listener({
        workspaceId: "workspace-1",
        path: "",
        items: [
          {
            path: "peer-leak.ts",
            name: "peer-leak.ts",
            kind: "file",
            size: 3,
            updatedAt: "2026-03-24T12:11:00.000Z"
          }
        ],
        targetHostId: "peer-host-1"
      } as never);
    });

    await waitFor(() => {
      expect(screen.getByText("host-main.ts")).toBeInTheDocument();
    });
    expect(screen.queryByText("peer-leak.ts")).not.toBeInTheDocument();

    clearViewSnapshot(peerWorkspaceTreeSnapshotKey);
  });

  it("工作区首屏有会话改动缓存时不会立刻请求 changed-files", async () => {
    writeViewSnapshot(SESSION_COUNT_SNAPSHOT_KEY, 16);

    renderPanel();

    expect(
      await screen.findByLabelText(`${t("conversation.filePanelSessionTab")} 16`)
    ).toBeInTheDocument();
  });

  it("工作区首屏没有缓存时会先显示 0，并在后台补刷新本次会话数量", async () => {
    conversationApiMock.getSessionChangedFiles.mockResolvedValue({
      items: [
        {
          sessionId: "session-1",
          workspaceId: "workspace-1",
          path: "apps/user-app/src/app/App.tsx",
          firstDetectedAt: "2026-03-24T12:00:00.000Z",
          lastDetectedAt: "2026-03-24T12:00:00.000Z",
          lastToolName: "apply_patch"
        }
      ]
    });
    gitApiMock.getGitStatus.mockResolvedValue({
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/Code/CodingNS",
        branch: "main",
        ahead: 0,
        behind: 0,
        hasRemote: true,
        isDirty: true,
        lastFetchedAt: null
      },
      changes: [createGitChange("apps/user-app/src/app/App.tsx", false)]
    });

    renderPanel();

    expect(screen.getByLabelText(`${t("conversation.filePanelSessionTab")} 0`)).toBeInTheDocument();
    expect(await screen.findByLabelText(`${t("conversation.filePanelSessionTab")} 1`)).toBeInTheDocument();
    expect(conversationApiMock.getSessionChangedFiles).toHaveBeenCalledTimes(1);
  });

  it("工作区标签点击刷新时会同步刷新本次会话数量", async () => {
    conversationApiMock.getSessionChangedFiles.mockResolvedValue({
      items: [
        {
          sessionId: "session-1",
          workspaceId: "workspace-1",
          path: "apps/user-app/src/app/App.tsx",
          firstDetectedAt: "2026-03-24T12:00:00.000Z",
          lastDetectedAt: "2026-03-24T12:00:00.000Z",
          lastToolName: "apply_patch"
        }
      ]
    });
    gitApiMock.getGitStatus.mockResolvedValue({
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/Code/CodingNS",
        branch: "main",
        ahead: 0,
        behind: 0,
        hasRemote: true,
        isDirty: true,
        lastFetchedAt: null
      },
      changes: [createGitChange("apps/user-app/src/app/App.tsx", false)]
    });

    renderPanel();

    expect(screen.getByLabelText(`${t("conversation.filePanelSessionTab")} 0`)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelRefresh") }));

    expect(await screen.findByLabelText(`${t("conversation.filePanelSessionTab")} 1`)).toBeInTheDocument();
    expect(conversationApiMock.getSessionChangedFiles).toHaveBeenCalledTimes(2);
  });

  it("切换左侧会话后会同步刷新对应的本次会话数量", async () => {
    writeViewSnapshot(SESSION_COUNT_SNAPSHOT_KEY, 0);

    conversationApiMock.getSessionChangedFiles.mockResolvedValue({
      items: [
        {
          sessionId: "session-2",
          workspaceId: "workspace-1",
          path: "apps/user-app/src/app/App.tsx",
          firstDetectedAt: "2026-03-24T12:00:00.000Z",
          lastDetectedAt: "2026-03-24T12:00:00.000Z",
          lastToolName: "apply_patch"
        }
      ]
    });
    gitApiMock.getGitStatus.mockResolvedValue({
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/Code/CodingNS",
        branch: "main",
        ahead: 0,
        behind: 0,
        hasRemote: true,
        isDirty: true,
        lastFetchedAt: null
      },
      changes: [createGitChange("apps/user-app/src/app/App.tsx", false)]
    });

    const view = render(
      <ToastProvider>
        <FileContextPanel sessionId="session-1" workspaceId="workspace-1" />
      </ToastProvider>
    );

    expect(screen.getByLabelText(`${t("conversation.filePanelSessionTab")} 0`)).toBeInTheDocument();

    view.rerender(
      <ToastProvider>
        <FileContextPanel sessionId="session-2" workspaceId="workspace-1" />
      </ToastProvider>
    );

    expect(await screen.findByLabelText(`${t("conversation.filePanelSessionTab")} 1`)).toBeInTheDocument();
    expect(conversationApiMock.getSessionChangedFiles).toHaveBeenCalled();
  });

  it("只选中项目而没有会话时，仍然显示工作区文件并禁用会话页签", async () => {
    renderPanel(null);

    expect(await screen.findByText("config.json")).toBeInTheDocument();

    const sessionTab = screen.getByRole("tab", { name: /本次会话 0|Session 0/ });
    expect(sessionTab).toBeDisabled();
    expect(screen.queryByText(t("conversation.filePanelSessionNoSession"))).not.toBeInTheDocument();
  });

  it("开启单视图模式后不显示工作区和会话标签页", async () => {
    renderPanel(null, "workspace-1", { hideTabs: true });

    expect(await screen.findByText("config.json")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: new RegExp(t("conversation.filePanelWorkspaceTab")) })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: new RegExp(t("conversation.filePanelSessionTab")) })).not.toBeInTheDocument();
  });

  it("默认隐藏 macOS 和 Windows 常见系统文件", async () => {
    fileApiMock.getFileTree.mockResolvedValue({
      items: [
        {
          path: ".DS_Store",
          name: ".DS_Store",
          kind: "file",
          size: 12,
          updatedAt: "2026-03-24T12:00:00.000Z"
        },
        {
          path: "Thumbs.db",
          name: "Thumbs.db",
          kind: "file",
          size: 18,
          updatedAt: "2026-03-24T12:00:00.000Z"
        },
        {
          path: ".gitignore",
          name: ".gitignore",
          kind: "file",
          size: 48,
          updatedAt: "2026-03-24T12:00:00.000Z"
        }
      ]
    });

    renderPanel();

    expect(await screen.findByText(".gitignore")).toBeInTheDocument();
    expect(screen.queryByText(".DS_Store")).not.toBeInTheDocument();
    expect(screen.queryByText("Thumbs.db")).not.toBeInTheDocument();
  });

  it("开启后会显示被默认隐藏的系统文件", async () => {
    localUiPreferenceStore.setShowSystemFiles(true);
    fileApiMock.getFileTree.mockResolvedValue({
      items: [
        {
          path: ".DS_Store",
          name: ".DS_Store",
          kind: "file",
          size: 12,
          updatedAt: "2026-03-24T12:00:00.000Z"
        },
        {
          path: "Thumbs.db",
          name: "Thumbs.db",
          kind: "file",
          size: 18,
          updatedAt: "2026-03-24T12:00:00.000Z"
        }
      ]
    });

    renderPanel();

    expect(await screen.findByText(".DS_Store")).toBeInTheDocument();
    expect(screen.getByText("Thumbs.db")).toBeInTheDocument();
  });

  it("切换到本次会话页签时由会话面板自己加载 changed-files", async () => {
    writeViewSnapshot(SESSION_COUNT_SNAPSHOT_KEY, 16);
    conversationApiMock.getSessionChangedFiles.mockResolvedValue({
      items: [
        {
          sessionId: "session-1",
          workspaceId: "workspace-1",
          path: "apps/user-app/src/app/App.tsx",
          firstDetectedAt: "2026-03-24T12:00:00.000Z",
          lastDetectedAt: "2026-03-24T12:00:00.000Z",
          lastToolName: "apply_patch"
        }
      ]
    });
    gitApiMock.getGitStatus.mockResolvedValue({
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/Code/CodingNS",
        branch: "main",
        ahead: 0,
        behind: 0,
        hasRemote: true,
        isDirty: true,
        lastFetchedAt: null
      },
      changes: [createGitChange("apps/user-app/src/app/App.tsx", false)]
    });

    renderPanel();

    expect(
      await screen.findByLabelText(`${t("conversation.filePanelSessionTab")} 16`)
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("tab", { name: new RegExp(t("conversation.filePanelSessionTab")) })
    );

    expect(await screen.findByText("App.tsx")).toBeInTheDocument();
    expect(await screen.findByLabelText(`${t("conversation.filePanelSessionTab")} 1`)).toBeInTheDocument();
  });

  it("本次会话页签也会隐藏系统文件", async () => {
    writeViewSnapshot(SESSION_COUNT_SNAPSHOT_KEY, 2);
    conversationApiMock.getSessionChangedFiles.mockResolvedValue({
      items: [
        {
          sessionId: "session-1",
          workspaceId: "workspace-1",
          path: ".DS_Store",
          firstDetectedAt: "2026-03-24T12:00:00.000Z",
          lastDetectedAt: "2026-03-24T12:00:00.000Z",
          lastToolName: "apply_patch"
        },
        {
          sessionId: "session-1",
          workspaceId: "workspace-1",
          path: "apps/user-app/src/app/App.tsx",
          firstDetectedAt: "2026-03-24T12:00:00.000Z",
          lastDetectedAt: "2026-03-24T12:00:00.000Z",
          lastToolName: "apply_patch"
        }
      ]
    });
    gitApiMock.getGitStatus.mockResolvedValue({
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/Code/CodingNS",
        branch: "main",
        ahead: 0,
        behind: 0,
        hasRemote: true,
        isDirty: true,
        lastFetchedAt: null
      },
      changes: [
        createGitChange(".DS_Store", false),
        createGitChange("apps/user-app/src/app/App.tsx", false)
      ]
    });

    renderPanel();

    await userEvent.click(
      screen.getByRole("tab", { name: new RegExp(t("conversation.filePanelSessionTab")) })
    );

    expect(await screen.findByText("App.tsx")).toBeInTheDocument();
    expect(screen.queryByText(".DS_Store")).not.toBeInTheDocument();
    expect(await screen.findByLabelText(`${t("conversation.filePanelSessionTab")} 1`)).toBeInTheDocument();
  });

  it("恢复缓存时只展开当前活动目录链路", async () => {
    writeViewSnapshot(WORKSPACE_TREE_SNAPSHOT_KEY, {
      treeCache: {
        "": [
          {
            path: "apps",
            name: "apps",
            kind: "directory",
            size: null,
            updatedAt: "2026-03-24T12:00:00.000Z"
          },
          {
            path: "docs",
            name: "docs",
            kind: "directory",
            size: null,
            updatedAt: "2026-03-24T12:00:00.000Z"
          }
        ],
        apps: [
          {
            path: "apps/user-app",
            name: "user-app",
            kind: "directory",
            size: null,
            updatedAt: "2026-03-24T12:00:00.000Z"
          }
        ],
        "apps/user-app": [
          {
            path: "apps/user-app/src",
            name: "src",
            kind: "directory",
            size: null,
            updatedAt: "2026-03-24T12:00:00.000Z"
          }
        ],
        docs: [
          {
            path: "docs/spec.md",
            name: "spec.md",
            kind: "file",
            size: 1,
            updatedAt: "2026-03-24T12:00:00.000Z"
          }
        ]
      },
      expandedDirectories: ["apps", "apps/user-app", "docs"],
      activeDirectoryPath: "apps/user-app"
    });

    renderPanel();

    expect(await screen.findByText("apps")).toBeInTheDocument();
    expect(screen.queryByText("spec.md")).not.toBeInTheDocument();

    await waitFor(() => {
      const restoredSnapshot = readViewSnapshot<{
        treeCache: Record<string, unknown>;
        expandedDirectories: string[];
        activeDirectoryPath: string;
      }>(WORKSPACE_TREE_SNAPSHOT_KEY, 5 * 60 * 1000);

      expect(restoredSnapshot?.expandedDirectories).toEqual(["apps", "apps/user-app"]);
      expect(Object.keys(restoredSnapshot?.treeCache ?? {}).sort()).toEqual(["", "apps", "apps/user-app"]);
    });
  });

  it("手动刷新时只请求当前展开目录，不重刷历史缓存目录", async () => {
    writeViewSnapshot(WORKSPACE_TREE_SNAPSHOT_KEY, {
      treeCache: {
        "": [
          {
            path: "apps",
            name: "apps",
            kind: "directory",
            size: null,
            updatedAt: "2026-03-24T12:00:00.000Z"
          },
          {
            path: "docs",
            name: "docs",
            kind: "directory",
            size: null,
            updatedAt: "2026-03-24T12:00:00.000Z"
          }
        ],
        apps: [
          {
            path: "apps/user-app",
            name: "user-app",
            kind: "directory",
            size: null,
            updatedAt: "2026-03-24T12:00:00.000Z"
          }
        ],
        docs: [
          {
            path: "docs/spec.md",
            name: "spec.md",
            kind: "file",
            size: 1,
            updatedAt: "2026-03-24T12:00:00.000Z"
          }
        ]
      },
      expandedDirectories: ["apps"],
      activeDirectoryPath: "apps"
    });

    fileApiMock.getFileTree.mockImplementation(async (_workspaceId: string, filePath?: string) => ({
      items:
        filePath === "apps"
          ? [
              {
                path: "apps/user-app",
                name: "user-app",
                kind: "directory",
                size: null,
                updatedAt: "2026-03-24T12:00:00.000Z"
              }
            ]
          : [...rootItemsMock]
    }));

    renderPanel();

    await screen.findByText("apps");
    await waitFor(() => {
      const restoredSnapshot = readViewSnapshot<{
        treeCache: Record<string, unknown>;
        expandedDirectories: string[];
        activeDirectoryPath: string;
      }>(WORKSPACE_TREE_SNAPSHOT_KEY, 5 * 60 * 1000);

      expect(restoredSnapshot?.expandedDirectories).toEqual(["apps"]);
      expect(Object.keys(restoredSnapshot?.treeCache ?? {}).sort()).toEqual(["", "apps"]);
    });

    fileApiMock.getFileTree.mockClear();
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelRefresh") }));

    await waitFor(() => {
      expect(fileApiMock.getFileTree).toHaveBeenCalledWith("workspace-1", undefined);
      expect(fileApiMock.getFileTree).toHaveBeenCalledWith("workspace-1", "apps");
    });
  });

  it("收到外部文件定位请求时会展开目录链并显示目标文件", async () => {
    fileApiMock.getFileTree.mockImplementation(async (_workspaceId: string, filePath?: string) => ({
      items:
        filePath === "apps"
          ? [
              {
                path: "apps/user-app",
                name: "user-app",
                kind: "directory",
                size: null,
                updatedAt: "2026-03-24T12:00:00.000Z"
              }
            ]
          : filePath === "apps/user-app"
            ? [
                {
                  path: "apps/user-app/src",
                  name: "src",
                  kind: "directory",
                  size: null,
                  updatedAt: "2026-03-24T12:00:00.000Z"
                }
              ]
            : filePath === "apps/user-app/src"
              ? [
                  {
                    path: "apps/user-app/src/App.tsx",
                    name: "App.tsx",
                    kind: "file",
                    size: 42,
                    updatedAt: "2026-03-24T12:00:00.000Z"
                  }
                ]
              : [
                  {
                    path: "apps",
                    name: "apps",
                    kind: "directory",
                    size: null,
                    updatedAt: "2026-03-24T12:00:00.000Z"
                  }
                ]
    }));

    renderPanel("session-1", "workspace-1", {
      externalRevealRequest: {
        requestId: 1,
        workspaceId: "workspace-1",
        filePath: "apps/user-app/src/App.tsx",
        openViewer: false
      }
    });

    expect(await screen.findByText("App.tsx")).toBeInTheDocument();
    await waitFor(() => {
      expect(fileApiMock.getFileTree).toHaveBeenCalledWith("workspace-1", "apps");
      expect(fileApiMock.getFileTree).toHaveBeenCalledWith("workspace-1", "apps/user-app");
      expect(fileApiMock.getFileTree).toHaveBeenCalledWith("workspace-1", "apps/user-app/src");
    });
  });

  it("目录快照长时间不返回时会回退到 HTTP 文件树接口完成展开", async () => {
    fileApiMock.getFileTree.mockImplementation(async (_workspaceId: string, filePath?: string) => {
      if (filePath === "tmp") {
        return {
          items: [
            {
              path: "tmp/demo.txt",
              name: "demo.txt",
              kind: "file",
              size: 12,
              updatedAt: "2026-03-24T12:00:00.000Z"
            }
          ]
        };
      }

      return {
        items: [
          {
            path: "tmp",
            name: "tmp",
            kind: "directory",
            size: null,
            updatedAt: "2026-03-24T12:00:00.000Z"
          },
          ...rootItemsMock
        ]
      };
    });

    workbenchShellMock.requestFileTreeRefresh.mockImplementation(async (workspaceId: string, paths?: string[]) => {
      const targetPaths = paths && paths.length > 0 ? paths : [""];

      await Promise.all(
        targetPaths.map(async (path) => {
          if (path === "tmp") {
            return;
          }

          const response = await fileApiMock.getFileTree(workspaceId, path ? path : undefined);

          queueMicrotask(() => {
            fileTreeSnapshotListeners.forEach((listener) => {
              listener({
                workspaceId,
                path,
                items: response.items
              });
            });
          });
        })
      );
    });

    renderPanel();

    fireEvent.click(await screen.findByText("tmp"));
    expect(screen.getByText(t("common.loading"))).toBeInTheDocument();

    await waitFor(() => {
      expect(fileApiMock.getFileTree).toHaveBeenCalledWith("workspace-1", "tmp");
    }, {
      timeout: 5000
    });
    expect(await screen.findByText("demo.txt")).toBeInTheDocument();
  }, 10000);

  it("支持复制当前选中文件的相对路径", async () => {
    renderPanel();

    await userEvent.click(await screen.findByText("config.json"));
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelCopyPath") }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: t("conversation.filePanelCopyRelativePath") })
    );

    expect(clipboardWriteTextMock).toHaveBeenCalledWith("config.json");
    expect(await screen.findByText(t("conversation.filePanelCopyRelativePathSuccess"))).toBeInTheDocument();
  });

  it("桌面工具栏会触发上传文件选择器", async () => {
    renderPanel();

    await screen.findByText("config.json");

    const uploadInput = screen.getByTestId("file-panel-upload-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(uploadInput, "click");

    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelUpload") }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("桌面工具栏支持下载当前选中的文件", async () => {
    renderPanel();

    await userEvent.click(await screen.findByText("config.json"));
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelDownload") }));

    await waitFor(() => {
      expect(fileApiMock.downloadFile).toHaveBeenCalledWith("workspace-1", "config.json");
    });

    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    expect(anchorClickMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlMock).toHaveBeenCalledWith("blob:mock-file");
    expect(await screen.findByText(t("conversation.filePanelDownloadSuccess", { name: "config.json" }))).toBeInTheDocument();
  });

  it("桌面工具栏支持删除当前选中的文件", async () => {
    let deleted = false;
    fileApiMock.getFileTree.mockImplementation(async () => ({
      items: deleted
        ? rootItemsMock.filter((item) => item.path !== "config.json")
        : [...rootItemsMock]
    }));
    fileApiMock.operateFile.mockImplementationOnce(async () => {
      deleted = true;
      return {
        success: true,
        opType: "delete"
      };
    });

    renderPanel();

    await userEvent.click(await screen.findByText("config.json"));
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelDelete") }));
    const dialog = await screen.findByRole("dialog", {
      name: t("conversation.filePanelDeleteConfirmTitle")
    });

    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      t("conversation.filePanelDeleteFileConfirm", {
        path: "config.json"
      })
    );

    await userEvent.click(within(dialog).getByRole("button", { name: t("conversation.filePanelDelete") }));

    await waitFor(() => {
      expect(fileApiMock.operateFile).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        opType: "delete",
        srcPath: "config.json"
      });
    });

    expect(
      await screen.findByText(t("conversation.filePanelDeleteSuccess", { name: "config.json" }))
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("config.json")).not.toBeInTheDocument();
    });
  });

  it("移动端文件工具栏会收起成操作菜单，并支持菜单操作", async () => {
    platformMock.isMobile = true;
    platformMock.viewportClass = "compact";

    renderPanel("session-1", "workspace-1", {
      hideHeading: true
    });

    await screen.findByText("config.json");

    expect(screen.getByRole("button", { name: t("conversation.filePanelActionsMenu") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("conversation.filePanelRefresh") })).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("config.json"));
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelActionsMenu") }));

    const actionMenu = screen.getByRole("menu", { name: t("conversation.filePanelActionsMenu") });
    expect(within(actionMenu).getByRole("menuitem", { name: t("conversation.filePanelShowSearch") })).toBeInTheDocument();
    expect(within(actionMenu).getByRole("menuitem", { name: t("conversation.filePanelRefresh") })).toBeInTheDocument();
    expect(within(actionMenu).getByRole("menuitem", { name: t("conversation.filePanelUpload") })).toBeInTheDocument();
    expect(within(actionMenu).getByRole("menuitem", { name: t("conversation.filePanelDownload") })).toBeInTheDocument();
    expect(within(actionMenu).getByRole("menuitem", { name: t("conversation.filePanelRenameMove") })).toBeInTheDocument();
    expect(within(actionMenu).getByRole("menuitem", { name: t("conversation.filePanelDelete") })).toBeInTheDocument();
    expect(within(actionMenu).getByRole("menuitem", { name: t("conversation.filePanelNewFile") })).toBeInTheDocument();
    expect(within(actionMenu).getByRole("menuitem", { name: t("conversation.filePanelNewDirectory") })).toBeInTheDocument();

    await userEvent.click(
      within(actionMenu).getByRole("menuitem", { name: t("conversation.filePanelCopyRelativePath") })
    );

    expect(clipboardWriteTextMock).toHaveBeenCalledWith("config.json");
    expect(await screen.findByText(t("conversation.filePanelCopyRelativePathSuccess"))).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelActionsMenu") }));
    await userEvent.click(screen.getByRole("menuitem", { name: t("conversation.filePanelShowSearch") }));

    expect(screen.getByPlaceholderText(t("conversation.filePanelSearchPlaceholder"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("conversation.filePanelSearchButton") })).toHaveTextContent(
      t("conversation.filePanelSearchButton")
    );

    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelActionsMenu") }));
    await userEvent.click(screen.getByRole("menuitem", { name: t("conversation.filePanelNewFile") }));
    const createDialog = await screen.findByRole("dialog", {
      name: t("conversation.filePanelNewFile")
    });
    await userEvent.type(
      within(createDialog).getByRole("textbox", { name: t("conversation.filePanelPathFieldLabel") }),
      "notes/todo.md"
    );
    await userEvent.click(
      within(createDialog).getByRole("button", { name: t("conversation.filePanelCreateFileSubmit") })
    );

    await waitFor(() => {
      expect(fileApiMock.operateFile).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        opType: "create_file",
        dstPath: "notes/todo.md",
        content: ""
      });
    });
  });

  it("移动端操作菜单支持删除当前选中的文件夹", async () => {
    platformMock.isMobile = true;
    platformMock.viewportClass = "compact";
    fileApiMock.getFileTree.mockImplementation(async (_workspaceId: string, filePath?: string) => {
      if (filePath === "docs") {
        return {
          items: []
        };
      }

      return {
        items: [
          {
            path: "docs",
            name: "docs",
            kind: "directory",
            size: null,
            updatedAt: "2026-03-24T12:00:00.000Z"
          },
          ...rootItemsMock
        ]
      };
    });
    fileApiMock.operateFile.mockResolvedValueOnce({
      success: true,
      opType: "delete"
    });

    renderPanel("session-1", "workspace-1", {
      hideHeading: true
    });

    await userEvent.click(await screen.findByText("docs"));
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelActionsMenu") }));
    await userEvent.click(screen.getByRole("menuitem", { name: t("conversation.filePanelDelete") }));
    const dialog = await screen.findByRole("dialog", {
      name: t("conversation.filePanelDeleteConfirmTitle")
    });

    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      t("conversation.filePanelDeleteDirectoryConfirm", {
        path: "docs"
      })
    );

    await userEvent.click(within(dialog).getByRole("button", { name: t("conversation.filePanelDelete") }));

    await waitFor(() => {
      expect(fileApiMock.operateFile).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        opType: "delete",
        srcPath: "docs"
      });
    });
  });

  it("Windows 下复制相对路径会使用反斜杠", async () => {
    platformMock.ui.osFamily = "windows";
    fileApiMock.getFileTree.mockResolvedValue({
      items: [
        {
          path: "packages/session-sync-core/src/index.ts",
          name: "index.ts",
          kind: "file",
          size: 42,
          updatedAt: "2026-03-24T12:00:00.000Z"
        }
      ]
    });

    renderPanel();

    await userEvent.click(await screen.findByText("index.ts"));
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelCopyPath") }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: t("conversation.filePanelCopyRelativePath") })
    );

    expect(clipboardWriteTextMock).toHaveBeenCalledWith("packages\\session-sync-core\\src\\index.ts");
  });

  it("支持复制当前选中目录的绝对路径", async () => {
    platformMock.platform = "desktop";
    platformMock.isDesktop = true;
    platformMock.isWeb = false;
    platformMock.ui.osFamily = "windows";
    platformMock.bridge.supported = true;
    fileApiMock.getFileTree.mockImplementation(async (_workspaceId: string, filePath?: string) => ({
      items:
        filePath === "apps"
          ? [
              {
                path: "apps/user-app",
                name: "user-app",
                kind: "directory",
                size: null,
                updatedAt: "2026-03-24T12:00:00.000Z"
              }
            ]
          : [
              {
                path: "apps",
                name: "apps",
                kind: "directory",
                size: null,
                updatedAt: "2026-03-24T12:00:00.000Z"
              }
            ]
    }));

    renderPanel();

    await userEvent.click(await screen.findByText("apps"));
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelCopyPath") }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: t("conversation.filePanelCopyAbsolutePath") })
    );

    expect(platformMock.bridge.writeClipboardText).toHaveBeenCalledWith("C:\\Code\\CodingNS\\apps");
    expect(await screen.findByText(t("conversation.filePanelCopyAbsolutePathSuccess"))).toBeInTheDocument();
  });

  it("macOS 下复制绝对路径会使用正斜杠", async () => {
    platformMock.platform = "desktop";
    platformMock.isDesktop = true;
    platformMock.isWeb = false;
    platformMock.ui.osFamily = "macos";
    platformMock.bridge.supported = true;
    workbenchShellMock.navigationGroups[0].workspace.path = "/Users/jackson/Documents/Code/CodingNS";
    workbenchShellMock.navigationGroups[0].workspace.repoRoot = "/Users/jackson/Documents/Code/CodingNS";
    fileApiMock.getFileTree.mockResolvedValue({
      items: [
        {
          path: "packages/session-sync-core/src/index.ts",
          name: "index.ts",
          kind: "file",
          size: 42,
          updatedAt: "2026-03-24T12:00:00.000Z"
        }
      ]
    });

    renderPanel();

    await userEvent.click(await screen.findByText("index.ts"));
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelCopyPath") }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: t("conversation.filePanelCopyAbsolutePath") })
    );

    expect(platformMock.bridge.writeClipboardText).toHaveBeenCalledWith(
      "/Users/jackson/Documents/Code/CodingNS/packages/session-sync-core/src/index.ts"
    );
  });

  it("鍙屽嚮 markdown 鏂囦欢鍚庝細鎵撳紑鏌ョ湅鍣ㄥ苟鏀寔缂栬緫淇濆瓨", async () => {
    renderPanel();

    await userEvent.dblClick(await screen.findByText("docs.md"));

    const dialog = await screen.findByRole("dialog", { name: "docs.md" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("# 鏍囬")).toBeInTheDocument();
    expect(within(dialog).getByText("```ts")).toBeInTheDocument();
    expect(within(dialog).getByText("const answer = 42;")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: t("conversation.fileViewerEdit") }));

    const editor = await screen.findByTestId("file-viewer-editor");
    await userEvent.clear(editor);
    await userEvent.type(editor, "# 鏂版爣棰?");
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelSave") }));

    await waitFor(() => {
      expect(fileApiMock.saveFileContent).toHaveBeenCalledWith(
        "workspace-1",
        "docs.md",
        "# 鏂版爣棰?",
        "md-version-1"
      );
    });
  });

  it("鍙屽嚮 json 鏂囦欢鍚庝細鎵撳紑浠ｇ爜鏌ョ湅鍣?", async () => {
    renderPanel();

    await userEvent.dblClick(await screen.findByText("config.json"));

    const dialog = await screen.findByRole("dialog", { name: "config.json" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("JSON")).toBeInTheDocument();
    expect(within(dialog).getByText("\"name\"")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("tab", { name: t("conversation.fileViewerEdit") }));
    expect(within(dialog).getByTestId("file-viewer-editor")).toHaveValue(
      '{\n  "name": "demo",\n  "enabled": true\n}'
    );
  });

  it("鍙屽嚮 yaml 鏂囦欢鍚庝細鎵撳紑浠ｇ爜鏌ョ湅鍣?", async () => {
    renderPanel();

    await userEvent.dblClick(await screen.findByText("settings.yaml"));

    const dialog = await screen.findByRole("dialog", { name: "settings.yaml" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("YAML")).toBeInTheDocument();
    expect(within(dialog).getByText("enabled")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("tab", { name: t("conversation.fileViewerEdit") }));
    expect(within(dialog).getByTestId("file-viewer-editor")).toHaveValue(
      "name: demo\nenabled: true\n"
    );
  });

  it("鍙屽嚮 toml 鏂囦欢鍚庝細鎵撳紑浠ｇ爜鏌ョ湅鍣?", async () => {
    renderPanel();

    await userEvent.dblClick(await screen.findByText("app.toml"));

    const dialog = await screen.findByRole("dialog", { name: "app.toml" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("TOML")).toBeInTheDocument();
    expect(within(dialog).getByText("[database]")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("tab", { name: t("conversation.fileViewerEdit") }));
    expect(within(dialog).getByTestId("file-viewer-editor")).toHaveValue(
      "[database]\nport = 5432\nenabled = true\n"
    );
  });

  it("鍙屽嚮 ini 鏂囦欢鍚庝細鎵撳紑浠ｇ爜鏌ョ湅鍣?", async () => {
    renderPanel();

    await userEvent.dblClick(await screen.findByText("profile.ini"));

    const dialog = await screen.findByRole("dialog", { name: "profile.ini" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("INI")).toBeInTheDocument();
    expect(within(dialog).getByText("[user]")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("tab", { name: t("conversation.fileViewerEdit") }));
    expect(within(dialog).getByTestId("file-viewer-editor")).toHaveValue(
      "[user]\nname=demo\nenabled=yes\n"
    );
  });

  it("鍙屽嚮 env 鏂囦欢鍚庝細鎵撳紑浠ｇ爜鏌ョ湅鍣?", async () => {
    renderPanel();

    await userEvent.dblClick(await screen.findByText(".env.local"));

    const dialog = await screen.findByRole("dialog", { name: ".env.local" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("ENV")).toBeInTheDocument();
    expect(within(dialog).getByText("NODE_ENV")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("tab", { name: t("conversation.fileViewerEdit") }));
    expect(within(dialog).getByTestId("file-viewer-editor")).toHaveValue(
      'NODE_ENV="development"\nPORT=3000\n'
    );
  });

  it("鍙屽嚮 properties 鏂囦欢鍚庝細鎵撳紑浠ｇ爜鏌ョ湅鍣?", async () => {
    renderPanel();

    await userEvent.dblClick(await screen.findByText("gradle.properties"));

    const dialog = await screen.findByRole("dialog", { name: "gradle.properties" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("Properties")).toBeInTheDocument();
    expect(within(dialog).getByText("org.gradle.jvmargs")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("tab", { name: t("conversation.fileViewerEdit") }));
    expect(within(dialog).getByTestId("file-viewer-editor")).toHaveValue(
      "org.gradle.jvmargs=-Xmx2g\nbuild.cache=true\n"
    );
  });

  it("鍙屽嚮 conf 鏂囦欢鍚庝細鎵撳紑浠ｇ爜鏌ョ湅鍣?", async () => {
    renderPanel();

    await userEvent.dblClick(await screen.findByText("app.conf"));

    const dialog = await screen.findByRole("dialog", { name: "app.conf" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("CONF")).toBeInTheDocument();
    expect(within(dialog).getByText("[server]")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("tab", { name: t("conversation.fileViewerEdit") }));
    expect(within(dialog).getByTestId("file-viewer-editor")).toHaveValue(
      "[server]\nport=8080\nenabled=on\n"
    );
  });

  it("鍙屽嚮 editorconfig 鏂囦欢鍚庝細鎵撳紑浠ｇ爜鏌ョ湅鍣?", async () => {
    renderPanel();

    await userEvent.dblClick(await screen.findByText(".editorconfig"));

    const dialog = await screen.findByRole("dialog", { name: ".editorconfig" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("EditorConfig")).toBeInTheDocument();
    expect(within(dialog).getByText("indent_style")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("tab", { name: t("conversation.fileViewerEdit") }));
    expect(within(dialog).getByTestId("file-viewer-editor")).toHaveValue(
      "root = true\n\n[*]\nindent_style = space\n"
    );
  });

  it("鍙屽嚮 Dockerfile 鍚庝細鎵撳紑浠ｇ爜鏌ョ湅鍣?", async () => {
    renderPanel();

    await userEvent.dblClick(await screen.findByText("Dockerfile"));

    const dialog = await screen.findByRole("dialog", { name: "Dockerfile" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getAllByText("Dockerfile").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("FROM")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("tab", { name: t("conversation.fileViewerEdit") }));
    expect(within(dialog).getByTestId("file-viewer-editor")).toHaveValue(
      "FROM node:20-alpine\nWORKDIR /app\nRUN pnpm install\n"
    );
  });

  it("鍙屽嚮 gitignore 鏂囦欢鍚庝細鎵撳紑浠ｇ爜鏌ョ湅鍣?", async () => {
    renderPanel();

    await userEvent.dblClick(await screen.findByText(".gitignore"));

    const dialog = await screen.findByRole("dialog", { name: ".gitignore" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("GitIgnore")).toBeInTheDocument();
    expect(within(dialog).getByText("*.log")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("tab", { name: t("conversation.fileViewerEdit") }));
    expect(within(dialog).getByTestId("file-viewer-editor")).toHaveValue(
      "node_modules/\n*.log\n!.env.example\n"
    );
  });

  it("鍙屽嚮 log 鏂囦欢鍚庝細鎵撳紑浠ｇ爜鏌ョ湅鍣?", async () => {
    renderPanel();

    await userEvent.dblClick(await screen.findByText("server.log"));

    const dialog = await screen.findByRole("dialog", { name: "server.log" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("Log")).toBeInTheDocument();
    expect(within(dialog).getByText("INFO")).toBeInTheDocument();
    expect(within(dialog).getByText("ERROR")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("tab", { name: t("conversation.fileViewerEdit") }));
    expect(within(dialog).getByTestId("file-viewer-editor")).toHaveValue(
      "2026-03-24 21:45:01 INFO server started\n2026-03-24 21:45:03 ERROR port in use\n"
    );
  });

  it("浼氬湪鏈浼氳瘽鏍囩椤甸噷绛涢€変慨鏀规枃浠跺苟鏀寔涓€閿殏瀛?", async () => {
    conversationApiMock.getSessionChangedFiles.mockResolvedValue({
      items: [
        {
          sessionId: "session-1",
          workspaceId: "workspace-1",
          path: "apps/user-app/src/app/App.tsx",
          firstDetectedAt: "2026-03-24T12:00:00.000Z",
          lastDetectedAt: "2026-03-24T12:00:00.000Z",
          lastToolName: "apply_patch"
        }
      ]
    });

    gitApiMock.getGitStatus
      .mockResolvedValueOnce({
        snapshot: {
          workspaceId: "workspace-1",
          repoRoot: "C:/Code/CodingNS",
          branch: "main",
          ahead: 0,
          behind: 0,
          hasRemote: true,
          isDirty: true,
          lastFetchedAt: null
        },
        changes: [
          createGitChange("apps/user-app/src/app/App.tsx", false),
          createGitChange("README.md", false)
        ]
      })
      .mockResolvedValueOnce({
        snapshot: {
          workspaceId: "workspace-1",
          repoRoot: "C:/Code/CodingNS",
          branch: "main",
          ahead: 0,
          behind: 0,
          hasRemote: true,
          isDirty: true,
          lastFetchedAt: null
        },
        changes: [
          createGitChange("apps/user-app/src/app/App.tsx", false),
          createGitChange("README.md", false)
        ]
      })
      .mockResolvedValueOnce({
        snapshot: {
          workspaceId: "workspace-1",
          repoRoot: "C:/Code/CodingNS",
          branch: "main",
          ahead: 0,
          behind: 0,
          hasRemote: true,
          isDirty: true,
          lastFetchedAt: null
        },
        changes: [createGitChange("apps/user-app/src/app/App.tsx", false)]
      })
      .mockResolvedValueOnce({
        snapshot: {
          workspaceId: "workspace-1",
          repoRoot: "C:/Code/CodingNS",
          branch: "main",
          ahead: 0,
          behind: 0,
          hasRemote: true,
          isDirty: true,
          lastFetchedAt: null
        },
        changes: [createGitChange("apps/user-app/src/app/App.tsx", true)]
      });

    renderPanel();

    await userEvent.click(
      screen.getByRole("tab", { name: new RegExp(t("conversation.filePanelSessionTab")) })
    );

    expect(await screen.findByLabelText(`${t("conversation.filePanelSessionTab")} 1`)).toBeInTheDocument();
    expect(await screen.findByText("App.tsx")).toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: t("conversation.filePanelSessionListView") }));
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelSessionStageAll") }));

    await waitFor(() => {
      expect(gitApiMock.stageGitTargets).toHaveBeenCalledTimes(1);
    });
    expect(gitApiMock.stageGitTargets).toHaveBeenCalledWith("workspace-1", [
      "apps/user-app/src/app/App.tsx"
    ]);

    expect(await screen.findByText("已把本次会话的修改加入暂存区。")).toBeInTheDocument();
  });
  it("连续点击同一文件两次也会打开查看器（旧块）", async () => {
    renderPanel();

    const fileEntry = await screen.findByText("config.json");
    await userEvent.click(fileEntry);
    await userEvent.click(fileEntry);

    expect(await screen.findByRole("dialog", { name: "config.json" })).toBeInTheDocument();
  });

  it("M 状态文件从文件管理打开时仍显示预览，并带变更标尺", async () => {
    gitApiMock.getGitStatus.mockResolvedValue({
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/Code/CodingNS",
        branch: "main",
        ahead: 0,
        behind: 0,
        hasRemote: true,
        isDirty: true,
        lastFetchedAt: null
      },
      changes: [createGitChange("config.json", false)]
    });
    gitApiMock.getGitDiff.mockResolvedValue({
      workspaceId: "workspace-1",
      path: "config.json",
      staged: false,
      binary: false,
      truncated: false,
      content: [
        "diff --git a/config.json b/config.json",
        "index 1111111..2222222 100644",
        "--- a/config.json",
        "+++ b/config.json",
        "@@ -1,3 +1,4 @@",
        "-  \"name\": \"old\",",
        "+  \"name\": \"demo\",",
        "   \"enabled\": true",
        "+  \"extra\": false"
      ].join("\n")
    });

    renderPanel();

    const fileEntry = await screen.findByText("config.json");
    await userEvent.click(fileEntry);
    await userEvent.click(fileEntry);

    const dialog = await screen.findByRole("dialog", { name: "config.json" });

    await waitFor(() => {
      expect(gitApiMock.getGitDiff).toHaveBeenCalledWith("workspace-1", "config.json", false);
    });

    expect(dialog).toHaveTextContent("demo");
    expect(within(dialog).queryByText("diff --git a/config.json b/config.json")).not.toBeInTheDocument();
    expect(dialog.querySelector('[data-testid="file-overview-ruler"]')).not.toBeNull();
  });

  it("本次会话文件连续点击两次会打开查看器（旧块）", async () => {
    conversationApiMock.getSessionChangedFiles.mockResolvedValue({
      items: [
        {
          sessionId: "session-1",
          workspaceId: "workspace-1",
          path: "apps/user-app/src/app/App.tsx",
          firstDetectedAt: "2026-03-24T12:00:00.000Z",
          lastDetectedAt: "2026-03-24T12:00:00.000Z",
          lastToolName: "apply_patch"
        }
      ]
    });

    gitApiMock.getGitStatus.mockResolvedValue({
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/Code/CodingNS",
        branch: "main",
        ahead: 0,
        behind: 0,
        hasRemote: true,
        isDirty: true,
        lastFetchedAt: null
      },
      changes: [createGitChange("apps/user-app/src/app/App.tsx", false)]
    });

    fileApiMock.getFilePreview.mockImplementation(async (_workspaceId: string, filePath: string) => {
      if (filePath === "apps/user-app/src/app/App.tsx") {
        return {
          workspaceId: "workspace-1",
          path: "apps/user-app/src/app/App.tsx",
          supported: true,
          kind: "text",
          reason: null,
          content: "export function App() {\n  return <main>demo</main>;\n}\n",
          version: "app-version-1",
          size: 58,
          updatedAt: "2026-03-24T12:01:00.000Z"
        };
      }

      return {
        workspaceId: "workspace-1",
        path: filePath,
        supported: true,
        kind: "text",
        reason: null,
        content: "",
        version: "fallback-version",
        size: 0,
        updatedAt: "2026-03-24T12:01:00.000Z"
      };
    });

    renderPanel();

    await userEvent.click(screen.getByRole("tab", { name: new RegExp(t("conversation.filePanelSessionTab")) }));

    const sessionFileEntry = await screen.findByText("App.tsx");
    await userEvent.click(sessionFileEntry);
    await userEvent.click(sessionFileEntry);

    expect(
      await screen.findByRole("dialog", { name: "apps/user-app/src/app/App.tsx" })
    ).toBeInTheDocument();
  });

  it("杩炵画鐐瑰嚮鍚屼竴鏂囦欢涓ゆ涔熶細鎵撳紑鏌ョ湅鍣?", async () => {
    renderPanel();

    const fileEntry = await screen.findByText("config.json");
    await userEvent.click(fileEntry);
    await userEvent.click(fileEntry);

    expect(await screen.findByRole("dialog", { name: "config.json" })).toBeInTheDocument();
  });

  it("鏈浼氳瘽鏂囦欢杩炵画鐐瑰嚮涓ゆ浼氭墦寮€鏌ョ湅鍣?", async () => {
    conversationApiMock.getSessionChangedFiles.mockResolvedValue({
      items: [
        {
          sessionId: "session-1",
          workspaceId: "workspace-1",
          path: "apps/user-app/src/app/App.tsx",
          firstDetectedAt: "2026-03-24T12:00:00.000Z",
          lastDetectedAt: "2026-03-24T12:00:00.000Z",
          lastToolName: "apply_patch"
        }
      ]
    });

    gitApiMock.getGitStatus.mockResolvedValue({
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/Code/CodingNS",
        branch: "main",
        ahead: 0,
        behind: 0,
        hasRemote: true,
        isDirty: true,
        lastFetchedAt: null
      },
      changes: [createGitChange("apps/user-app/src/app/App.tsx", false)]
    });

    fileApiMock.getFilePreview.mockImplementation(async (_workspaceId: string, filePath: string) => {
      if (filePath === "apps/user-app/src/app/App.tsx") {
        return {
          workspaceId: "workspace-1",
          path: "apps/user-app/src/app/App.tsx",
          supported: true,
          kind: "text",
          reason: null,
          content: "export function App() {\n  return <main>demo</main>;\n}\n",
          version: "app-version-1",
          size: 58,
          updatedAt: "2026-03-24T12:01:00.000Z"
        };
      }

      return {
        workspaceId: "workspace-1",
        path: filePath,
        supported: true,
        kind: "text",
        reason: null,
        content: "",
        version: "fallback-version",
        size: 0,
        updatedAt: "2026-03-24T12:01:00.000Z"
      };
    });

    renderPanel();

    await userEvent.click(
      screen.getByRole("tab", { name: new RegExp(t("conversation.filePanelSessionTab")) })
    );

    const sessionFileEntry = await screen.findByText("App.tsx");
    await userEvent.click(sessionFileEntry);
    await userEvent.click(sessionFileEntry);

    expect(
      await screen.findByRole("dialog", { name: "apps/user-app/src/app/App.tsx" })
    ).toBeInTheDocument();
  });

  it("支持 Shift 连续多选和 Ctrl 切换单个选中项", async () => {
    renderPanel();

    const configButton = await screen.findByRole("button", { name: "config.json" });
    const settingsButton = screen.getByRole("button", { name: "settings.yaml" });
    const docsButton = screen.getByRole("button", { name: "docs.md" });

    await userEvent.click(configButton);
    fireEvent.click(docsButton, { shiftKey: true });

    expect(configButton).toHaveAttribute("data-selected", "true");
    expect(settingsButton).toHaveAttribute("data-selected", "true");
    expect(docsButton).toHaveAttribute("data-selected", "true");

    fireEvent.click(settingsButton, { ctrlKey: true });

    expect(configButton).toHaveAttribute("data-selected", "true");
    expect(settingsButton).toHaveAttribute("data-selected", "false");
    expect(docsButton).toHaveAttribute("data-selected", "true");
    expect(
      screen.queryByText(
        t("conversation.filePanelSelectionCount", {
          count: 2
        })
      )
    ).not.toBeInTheDocument();
  });

  it("支持复制多选文件并粘贴到目标目录", async () => {
    fileApiMock.getFileTree.mockImplementation(async (_workspaceId: string, filePath?: string) => {
      if (filePath === "archive") {
        return {
          items: []
        };
      }

      return {
        items: [
          {
            path: "archive",
            name: "archive",
            kind: "directory",
            size: null,
            updatedAt: "2026-03-24T12:00:00.000Z"
          },
          rootItemsMock[0],
          rootItemsMock[1]
        ]
      };
    });

    renderPanel();

    const configButton = await screen.findByRole("button", { name: "config.json" });
    const settingsButton = screen.getByRole("button", { name: "settings.yaml" });

    await userEvent.click(configButton);
    fireEvent.click(settingsButton, { ctrlKey: true });
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelCopy") }));

    expect(
      await screen.findByText(
        t("conversation.filePanelCopySelectionSuccess", {
          count: 2
        })
      )
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "archive" }));
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelPaste") }));

    await waitFor(() => {
      expect(fileApiMock.operateFile).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          opType: "copy",
          srcPath: "config.json",
          dstPath: "archive/config.json"
        })
      );
      expect(fileApiMock.operateFile).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          opType: "copy",
          srcPath: "settings.yaml",
          dstPath: "archive/settings.yaml"
        })
      );
    });
  });

  it("支持剪切文件并粘贴到目标目录", async () => {
    fileApiMock.getFileTree.mockImplementation(async (_workspaceId: string, filePath?: string) => {
      if (filePath === "archive") {
        return {
          items: []
        };
      }

      return {
        items: [
          {
            path: "archive",
            name: "archive",
            kind: "directory",
            size: null,
            updatedAt: "2026-03-24T12:00:00.000Z"
          },
          rootItemsMock[0]
        ]
      };
    });

    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: "config.json" }));
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelCut") }));

    expect(
      await screen.findByText(
        t("conversation.filePanelCutSelectionSuccess", {
          count: 1
        })
      )
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "archive" }));
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelPaste") }));

    await waitFor(() => {
      expect(fileApiMock.operateFile).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          opType: "move",
          srcPath: "config.json",
          dstPath: "archive/config.json"
        })
      );
    });
  });

  it("支持重命名当前选中的文件", async () => {
    let renamed = false;
    fileApiMock.getFileTree.mockImplementation(async () => ({
      items: renamed
        ? [
            {
              ...rootItemsMock[0],
              path: "config-next.json",
              name: "config-next.json"
            },
            rootItemsMock[1]
          ]
        : [rootItemsMock[0], rootItemsMock[1]]
    }));
    fileApiMock.operateFile.mockImplementation(async (payload: {
      opType: string;
    }) => {
      if (payload.opType === "rename") {
        renamed = true;
      }

      return {
        success: true,
        opType: payload.opType
      };
    });

    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: "config.json" }));
    await userEvent.click(screen.getByRole("button", { name: t("conversation.filePanelRenameMove") }));

    const dialog = await screen.findByRole("dialog", {
      name: t("conversation.filePanelRenameMove")
    });
    const input = within(dialog).getByRole("textbox", {
      name: t("conversation.filePanelPathFieldLabel")
    });
    await userEvent.clear(input);
    await userEvent.type(input, "config-next.json");
    await userEvent.click(
      within(dialog).getByRole("button", { name: t("conversation.filePanelRenameSubmit") })
    );

    await waitFor(() => {
      expect(fileApiMock.operateFile).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        opType: "rename",
        srcPath: "config.json",
        dstPath: "config-next.json"
      });
    });

    expect(
      await screen.findByText(
        t("conversation.filePanelRenameSuccess", {
          name: "config-next.json"
        })
      )
    ).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "config-next.json" })).toBeInTheDocument();
  });

  it("桌面端右键会弹出文件操作菜单", async () => {
    platformMock.platform = "desktop";
    platformMock.isDesktop = true;
    platformMock.isWeb = false;
    platformMock.bridge.supported = true;
    showDesktopContextMenuMock.mockResolvedValue(undefined);

    renderPanel();

    const configButton = await screen.findByRole("button", { name: "config.json" });
    fireEvent.contextMenu(configButton);

    await waitFor(() => {
      expect(showDesktopContextMenuMock).toHaveBeenCalledTimes(1);
    });

    const menuItems = showDesktopContextMenuMock.mock.calls[0][0] as Array<{ label: string }>;
    expect(menuItems.map((item) => item.label)).toEqual(
      expect.arrayContaining([
        t("conversation.filePanelOpenFile"),
        t("conversation.filePanelDownload"),
        t("conversation.filePanelNewFile"),
        t("conversation.filePanelNewDirectory"),
        t("conversation.filePanelRenameMove"),
        t("conversation.filePanelCopy"),
        t("conversation.filePanelCut"),
        t("conversation.filePanelAddToGitIgnore"),
        t("conversation.filePanelPaste"),
        t("conversation.filePanelDelete")
      ])
    );
  });

  it("桌面端右键添加到 Git 排除会调用对应接口", async () => {
    platformMock.platform = "desktop";
    platformMock.isDesktop = true;
    platformMock.isWeb = false;
    platformMock.bridge.supported = true;
    gitApiMock.addGitIgnoreTargets.mockResolvedValue({
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/Code/CodingNS",
        branch: "main",
        ahead: 0,
        behind: 0,
        hasRemote: true,
        isDirty: true,
        lastFetchedAt: null
      },
      changes: []
    });
    showDesktopContextMenuMock.mockImplementation(async (items: Array<{ label: string; onSelect: () => void }>) => {
      await items.find((item) => item.label === t("conversation.filePanelAddToGitIgnore"))?.onSelect();
    });

    renderPanel();

    fireEvent.contextMenu(await screen.findByRole("button", { name: "config.json" }));

    await waitFor(() => {
      expect(gitApiMock.addGitIgnoreTargets).toHaveBeenCalledWith("workspace-1", ["config.json"], undefined);
    });
  });

  it("H5 端右键会显示页面内操作菜单", async () => {
    renderPanel();

    const configButton = await screen.findByRole("button", { name: "config.json" });
    fireEvent.contextMenu(configButton, {
      clientX: 160,
      clientY: 220
    });

    const menu = await screen.findByRole("menu", {
      name: t("conversation.filePanelActionsMenu")
    });
    expect(menu).toHaveClass("file-web-context-menu");
    expect(within(menu).getByRole("menuitem", { name: t("conversation.filePanelOpenFile") })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: t("conversation.filePanelDownload") })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: t("conversation.filePanelNewFile") })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: t("conversation.filePanelNewDirectory") })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: t("conversation.filePanelRenameMove") })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: t("conversation.filePanelCopy") })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: t("conversation.filePanelCut") })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: t("conversation.filePanelAddToGitIgnore") })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: t("conversation.filePanelDelete") })).toBeInTheDocument();
  });

  it("H5 端右键菜单会限制在可视区域内并支持下载文件", async () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 300
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 260
    });

    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRectMock() {
      if (this instanceof HTMLElement && this.classList.contains("file-web-context-menu")) {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 176,
          bottom: 320,
          width: 176,
          height: 320,
          toJSON: () => ({})
        } as DOMRect;
      }

      return originalGetBoundingClientRect.call(this);
    };

    try {
      renderPanel();

      const configButton = await screen.findByRole("button", { name: "config.json" });
      fireEvent.contextMenu(configButton, {
        clientX: 280,
        clientY: 240
      });

      const menu = await screen.findByRole("menu", {
        name: t("conversation.filePanelActionsMenu")
      });

      await waitFor(() => {
        expect(menu).toHaveStyle({
          left: "116px",
          top: "8px",
          maxHeight: "228px"
        });
      });

      await userEvent.click(
        within(menu).getByRole("menuitem", { name: t("conversation.filePanelDownload") })
      );

      await waitFor(() => {
        expect(fileApiMock.downloadFile).toHaveBeenCalledWith("workspace-1", "config.json");
      });
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight
      });
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  it("不再显示按钮式开新窗口入口", async () => {
    platformMock.platform = "desktop";
    platformMock.isDesktop = true;
    platformMock.isWeb = false;
    platformMock.bridge.supported = true;

    renderPanel();
    await screen.findByTestId("file-context-panel");
    expect(screen.queryByRole("button", { name: "在新窗口打开" })).not.toBeInTheDocument();
  });
});

function createGitChange(path: string, staged: boolean) {
  return {
    path,
    status: "M",
    staged,
    oldPath: null,
    binary: false,
    stagedStatus: staged ? "M" : null,
    worktreeStatus: staged ? null : "M"
  };
}
