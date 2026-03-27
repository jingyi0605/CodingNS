import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearViewSnapshot,
  readViewSnapshot,
  writeViewSnapshot
} from "../../../shared/cache/view-snapshot-cache";
import { t } from "../../../shared/i18n";
import { ToastProvider } from "../../../shared/toast";
import { FileContextPanel } from "./FileContextPanel";

const WORKSPACE_TREE_SNAPSHOT_KEY = "file-panel.workspace-tree.workspace-1";
const SESSION_COUNT_SNAPSHOT_KEY = "file-panel.session-change-count.workspace-1.session-1";

const fileApiMock = vi.hoisted(() => ({
  getFileTree: vi.fn(),
  operateFile: vi.fn(),
  searchFiles: vi.fn(),
  getFilePreview: vi.fn(),
  saveFileContent: vi.fn()
}));

const conversationApiMock = vi.hoisted(() => ({
  getSessionChangedFiles: vi.fn()
}));

const gitApiMock = vi.hoisted(() => ({
  getGitStatus: vi.fn(),
  stageGitTargets: vi.fn()
}));

const clipboardWriteTextMock = vi.hoisted(() => vi.fn());
const fileTreeSnapshotListeners = new Set<
  (snapshot: { workspaceId: string; path: string; items: unknown[] }) => void
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
  saveFileContent: fileApiMock.saveFileContent
}));

vi.mock("../api/conversation-api", () => ({
  getSessionChangedFiles: conversationApiMock.getSessionChangedFiles
}));

vi.mock("../api/git-api", () => ({
  getGitStatus: gitApiMock.getGitStatus,
  stageGitTargets: gitApiMock.stageGitTargets
}));

vi.mock("./WorkbenchLayout", () => ({
  useWorkbenchShell: () => workbenchShellMock
}));

vi.mock("../../../platform/platform-provider", () => ({
  usePlatform: () => platformMock
}));

describe("FileContextPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileTreeSnapshotListeners.clear();
    window.sessionStorage.clear();
    clearViewSnapshot(WORKSPACE_TREE_SNAPSHOT_KEY);
    clearViewSnapshot(SESSION_COUNT_SNAPSHOT_KEY);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock
      }
    });
    platformMock.platform = "web";
    platformMock.isDesktop = false;
    platformMock.isWeb = true;
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
      async (workspaceId: string, paths?: string[]) => {
        const targetPaths = paths && paths.length > 0 ? paths : [""];

        await Promise.all(
          targetPaths.map(async (path) => {
            const response = await fileApiMock.getFileTree(
              workspaceId,
              path ? path : undefined
            );

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
          updatedAt: "2026-03-24T12:01:00.000Z"
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
          updatedAt: "2026-03-24T12:01:00.000Z"
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
          updatedAt: "2026-03-24T12:01:00.000Z"
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
          updatedAt: "2026-03-24T12:01:00.000Z"
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
          updatedAt: "2026-03-24T12:01:00.000Z"
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
          updatedAt: "2026-03-24T12:01:00.000Z"
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
          updatedAt: "2026-03-24T12:01:00.000Z"
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
          updatedAt: "2026-03-24T12:01:00.000Z"
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
          updatedAt: "2026-03-24T12:01:00.000Z"
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
          updatedAt: "2026-03-24T12:01:00.000Z"
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
          updatedAt: "2026-03-24T12:01:00.000Z"
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
        updatedAt: "2026-03-24T12:01:00.000Z"
      };
    });

    fileApiMock.saveFileContent.mockResolvedValue({
      version: "version-2",
      updatedAt: "2026-03-24T12:02:00.000Z"
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    clearViewSnapshot(WORKSPACE_TREE_SNAPSHOT_KEY);
    clearViewSnapshot(SESSION_COUNT_SNAPSHOT_KEY);
  });

  function renderPanel(sessionId: string | null = "session-1", workspaceId = "workspace-1") {
    render(
      <ToastProvider>
        <FileContextPanel sessionId={sessionId} workspaceId={workspaceId} />
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
      expect(fileApiMock.getFileTree).toHaveBeenCalledTimes(1);
    });
  });

  it("工作区首屏有会话改动缓存时不会立刻请求 changed-files", async () => {
    writeViewSnapshot(SESSION_COUNT_SNAPSHOT_KEY, 16);

    renderPanel();

    expect(
      await screen.findByLabelText(`${t("conversation.filePanelSessionTab")} 16`)
    ).toBeInTheDocument();
  });

  it("工作区首屏没有缓存时也不会主动请求 changed-files", async () => {
    renderPanel();

    expect(screen.getByLabelText(`${t("conversation.filePanelSessionTab")} 0`)).toBeInTheDocument();
  });

  it("只选中项目而没有会话时，仍然显示工作区文件并禁用会话页签", async () => {
    renderPanel(null);

    expect(await screen.findByText("config.json")).toBeInTheDocument();

    const sessionTab = screen.getByRole("tab", { name: /本次会话 0|Session 0/ });
    expect(sessionTab).toBeDisabled();
    expect(screen.queryByText(t("conversation.filePanelSessionNoSession"))).not.toBeInTheDocument();
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
      expect(fileApiMock.getFileTree).toHaveBeenCalledTimes(2);
    });

    expect(fileApiMock.getFileTree).toHaveBeenNthCalledWith(1, "workspace-1", undefined);
    expect(fileApiMock.getFileTree).toHaveBeenNthCalledWith(2, "workspace-1", "apps");
  });

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

    expect(await screen.findByRole("dialog", { name: "docs.md" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "鏍囬" })).toBeInTheDocument();
    expect(await screen.findByText("TypeScript")).toBeInTheDocument();

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
    expect(within(dialog).getAllByText("JSON")).toHaveLength(2);
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
    expect(within(dialog).getAllByText("YAML")).toHaveLength(2);
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
    expect(within(dialog).getAllByText("TOML")).toHaveLength(2);
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
    expect(within(dialog).getAllByText("INI")).toHaveLength(2);
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
    expect(within(dialog).getAllByText("ENV")).toHaveLength(2);
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
    expect(within(dialog).getAllByText("Properties")).toHaveLength(2);
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
    expect(within(dialog).getAllByText("CONF")).toHaveLength(2);
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
    expect(within(dialog).getAllByText("EditorConfig")).toHaveLength(2);
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
    expect(within(dialog).getAllByText("Dockerfile")).toHaveLength(3);
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
    expect(within(dialog).getAllByText("GitIgnore")).toHaveLength(2);
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
    expect(within(dialog).getAllByText("Log")).toHaveLength(2);
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
      expect(gitApiMock.stageGitTargets).toHaveBeenCalledWith("workspace-1", [
        "apps/user-app/src/app/App.tsx"
      ]);
    });

    expect(await screen.findByText("已把本次会话的修改加入暂存区。")).toBeInTheDocument();
  });
  it("连续点击同一文件两次也会打开查看器（旧块）", async () => {
    renderPanel();

    const fileEntry = await screen.findByText("config.json");
    await userEvent.click(fileEntry);
    await userEvent.click(fileEntry);

    expect(await screen.findByRole("dialog", { name: "config.json" })).toBeInTheDocument();
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
