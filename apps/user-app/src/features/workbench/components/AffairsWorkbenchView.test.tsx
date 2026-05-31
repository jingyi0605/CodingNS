import { render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import type { WorkspaceSessionGroup } from "../../conversation/components/WorkbenchLayout";
import { getCodingNSDesktopBridge } from "../../../platform/desktop/codingns-desktop-bridge";
import {
  AffairsAuxiliaryPanel,
  AffairsWorkbenchProvider,
  AffairsWorkbenchView
} from "./AffairsWorkbenchView";
import type { AffairsViewState } from "../types/workbench-mode";

const desktopBridgeMock = vi.hoisted(() => ({
  fs: {
    openFile: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    revealInFileManager: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    pickDirectory: vi.fn().mockResolvedValue({ ok: true, value: "/Users/jackson/SynologyDrive" })
  }
}));

const conversationApiMock = vi.hoisted(() => ({
  getAffairsLibraryConfig: vi.fn(),
  getAffairsLibraryPreview: vi.fn(),
  getAffairsLibrarySnapshot: vi.fn(),
  listAffairsLibraryDocuments: vi.fn(),
  requestAffairsLibraryRefresh: vi.fn(),
  saveAffairsLibraryBinding: vi.fn(),
  saveAffairsLibraryConfig: vi.fn(),
  updateAffairsLibraryFavorites: vi.fn()
}));

vi.mock("../../conversation/api/conversation-api", async () => {
  const actual = await vi.importActual<object>("../../conversation/api/conversation-api");
  return {
    ...actual,
    getAffairsLibraryConfig: conversationApiMock.getAffairsLibraryConfig,
    getAffairsLibraryPreview: conversationApiMock.getAffairsLibraryPreview,
    getAffairsLibrarySnapshot: conversationApiMock.getAffairsLibrarySnapshot,
    listAffairsLibraryDocuments: conversationApiMock.listAffairsLibraryDocuments,
    requestAffairsLibraryRefresh: conversationApiMock.requestAffairsLibraryRefresh,
    saveAffairsLibraryBinding: conversationApiMock.saveAffairsLibraryBinding,
    saveAffairsLibraryConfig: conversationApiMock.saveAffairsLibraryConfig,
    updateAffairsLibraryFavorites: conversationApiMock.updateAffairsLibraryFavorites
  };
});

vi.mock("../../butler/api/butler-api", () => ({
  listAssistantAutomations: vi.fn().mockResolvedValue({ items: [] }),
  listButlerFollowUpTasks: vi.fn().mockResolvedValue({ items: [] }),
  listButlerInboxItems: vi.fn().mockResolvedValue({ items: [] }),
  listRecentAssistantAutomationRuns: vi.fn().mockResolvedValue({ items: [] })
}));

vi.mock("../../butler/runtime/butler-runtime-store", () => ({
  ButlerRuntimeStore: class {
    constructor(_workspaceId: string) {}
  },
  useButlerRuntimeStore: vi.fn((_store, selector) => selector({
    initialized: true,
    loading: false,
    profile: null,
    activeProvider: null,
    controlSession: null,
    capabilities: null,
    messages: [],
    historyState: "idle",
    loadingOlderMessages: false,
    hasOlderMessages: false,
    runtimeHasActiveRun: false,
    runtimeCanInterrupt: false,
    contextUsage: null,
    permissionRequests: [],
    sending: false
  }))
}));

vi.mock("../../conversation/components/ComposerPanel", () => ({
  ComposerPanel: () => <div data-testid="affairs-composer" />
}));

vi.mock("../../conversation/components/MessageTimeline", () => ({
  MessageTimeline: () => <div data-testid="affairs-timeline" />
}));

vi.mock("../../conversation/components/PermissionRequestList", () => ({
  PermissionRequestList: () => <div data-testid="affairs-permissions" />
}));

vi.mock("../../conversation/components/WorkspaceImportBrowserModal", () => ({
  WorkspaceImportBrowserModal: () => null
}));

vi.mock("../../../platform/desktop/codingns-desktop-bridge", () => ({
  getCodingNSDesktopBridge: vi.fn(() => desktopBridgeMock)
}));

vi.mock("../../conversation/timeline-source-items", () => ({
  buildConversationTimelineSourceItems: () => []
}));

const navigationGroups: WorkspaceSessionGroup[] = [
  {
    workspace: {
      id: "workspace-1",
      name: "事务工作区",
      path: "/tmp/workspace-1",
      repoRoot: "/tmp/workspace-1"
    },
    sessions: []
  }
];

function createState(): AffairsViewState {
  return {
    workspaceId: "workspace-1",
    primarySection: "library",
    selectedNodeId: "library:all",
    selectedObjectId: null,
    toolbarExpanded: false,
    auxiliaryTab: "detail",
    browseMode: "folder",
    viewMode: "grid",
    selectedFolderPath: null,
    selectedTagPath: null,
    selectedDocumentId: null,
    selectedFavoriteId: null
  };
}

function renderWorkbench() {
  function TestHarness(): ReactElement {
    const [state, setState] = useState(createState());

    return (
      <AffairsWorkbenchProvider
        workspaceId="workspace-1"
        workspaceName="事务工作区"
        navigationGroups={navigationGroups}
        state={state}
        onStateChange={setState}
      >
        <div style={{ display: "flex" }}>
          <AffairsWorkbenchView workspaceId="workspace-1" />
          <AffairsAuxiliaryPanel workspaceId="workspace-1" />
        </div>
      </AffairsWorkbenchProvider>
    );
  }

  return render(<TestHarness />);
}

describe("AffairsWorkbenchView", () => {
  beforeEach(() => {
    conversationApiMock.getAffairsLibrarySnapshot.mockReset();
    conversationApiMock.listAffairsLibraryDocuments.mockReset();
    conversationApiMock.getAffairsLibraryPreview.mockReset();
    conversationApiMock.getAffairsLibraryConfig.mockReset();
    conversationApiMock.requestAffairsLibraryRefresh.mockReset();
    conversationApiMock.saveAffairsLibraryBinding.mockReset();
    conversationApiMock.saveAffairsLibraryConfig.mockReset();
    conversationApiMock.updateAffairsLibraryFavorites.mockReset();

    desktopBridgeMock.fs.openFile.mockClear();
    desktopBridgeMock.fs.revealInFileManager.mockClear();
    desktopBridgeMock.fs.pickDirectory.mockClear();

    conversationApiMock.getAffairsLibrarySnapshot.mockResolvedValue({
      binding: {
        workspaceId: "workspace-1",
        rootDir: "/Users/jackson/WorkFile",
        configRelativePath: ".ai-index/doc-semantic-index.config.json",
        exportMode: "v2",
        updatedAt: "2026-05-31T08:00:00.000Z"
      },
      status: {
        state: "fresh",
        dirtyReasons: [],
        lastRequestedAt: null,
        lastStartedAt: null,
        lastCompletedAt: "2026-05-31T08:00:00.000Z",
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: null,
        errorSummary: null
      },
      tags: [],
      favorites: [],
      folders: [],
      documentCount: 1,
      lastError: null
    });

    conversationApiMock.getAffairsLibraryConfig.mockResolvedValue({
      binding: {
        workspaceId: "workspace-1",
        rootDir: "/Users/jackson/WorkFile",
        mirrorRoot: "/Users/jackson/SynologyDrive",
        allowedExtensions: [".docx", ".md", ".pdf"],
        configRelativePath: ".ai-index/doc-semantic-index.config.json",
        exportMode: "v2",
        updatedAt: "2026-05-31T08:00:00.000Z"
      },
      mirrorRoot: "/Users/jackson/SynologyDrive",
      allowedExtensions: [".docx", ".md", ".pdf"],
      configRelativePath: ".ai-index/doc-semantic-index.config.json",
      canWrite: true
    });

    conversationApiMock.listAffairsLibraryDocuments.mockResolvedValue({
      total: 1,
      offset: 0,
      limit: 120,
      items: [
        {
          documentId: "doc-1",
          path: "Exchange 分层通讯簿.txt",
          title: "Exchange 分层通讯簿",
          summary: "事务文档摘要",
          updatedAt: "2026-05-31T08:00:00.000Z",
          tags: [],
          derivedTags: [],
          isFavorite: false
        }
      ]
    });

    conversationApiMock.getAffairsLibraryPreview.mockResolvedValue({
      workspaceId: "workspace-1",
      path: "Exchange 分层通讯簿.txt",
      supported: true,
      kind: "text",
      reason: null,
      content: "这是事务文档内容",
      version: null,
      size: 24,
      updatedAt: "2026-05-31T08:00:00.000Z",
      previewPath: null,
      previewUrl: null,
      capabilities: {
        canEdit: false,
        canRefresh: true,
        canResize: true,
        canZoom: false,
        canPaginate: false
      }
    });

    conversationApiMock.saveAffairsLibraryConfig.mockResolvedValue({
      binding: {
        workspaceId: "workspace-1",
        rootDir: "/Users/jackson/WorkFile",
        mirrorRoot: "/Users/jackson/SynologyDrive",
        allowedExtensions: [".docx", ".md", ".pdf"],
        configRelativePath: ".ai-index/doc-semantic-index.config.json",
        exportMode: "v2",
        updatedAt: "2026-05-31T08:00:00.000Z"
      },
      mirrorRoot: "/Users/jackson/SynologyDrive",
      allowedExtensions: [".docx", ".md", ".pdf"],
      configRelativePath: ".ai-index/doc-semantic-index.config.json",
      canWrite: true,
      applyConfigTaskId: "task-apply-1",
      applyConfigStatus: {
        state: "fresh",
        dirtyReasons: [],
        lastRequestedAt: "2026-05-31T08:00:00.000Z",
        lastStartedAt: "2026-05-31T08:00:00.000Z",
        lastCompletedAt: "2026-05-31T08:00:01.000Z",
        lastFailedAt: null,
        nextAllowedAt: null,
        runningTaskId: null,
        errorSummary: null
      }
    });
  });

  it("双击事务文档会复用文件预览工具并走事务预览接口", async () => {
    renderWorkbench();

    const card = await screen.findByRole("button", { name: /Exchange 分层通讯簿/i });
    await userEvent.dblClick(card);

    await waitFor(() => {
      expect(conversationApiMock.getAffairsLibraryPreview).toHaveBeenCalledWith(
        "workspace-1",
        "Exchange 分层通讯簿.txt"
      );
    });

    expect(
      await screen.findByRole("dialog", { name: "Exchange 分层通讯簿.txt" })
    ).toBeInTheDocument();
    expect(await screen.findByText("Plain Text")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: t("conversation.fileViewerEdit") })).not.toBeInTheDocument();
  });

  it("点击设置按钮后会在独立模态框里显示文档库设置", async () => {
    renderWorkbench();

    expect(screen.queryByText(t("shell.affairsLibraryConfigTitle"))).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibrarySettingsAction") }));

    expect(await screen.findByRole("dialog", { name: t("shell.affairsLibraryConfigTitle") })).toBeInTheDocument();
    expect(screen.getByDisplayValue("/Users/jackson/SynologyDrive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ".docx" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: ".md" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: ".pdf" })).toHaveAttribute("aria-pressed", "true");
  });

  it("点击预设后缀会切换选中状态", async () => {
    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibrarySettingsAction") }));

    const txtChip = screen.getByRole("button", { name: ".txt" });
    expect(txtChip).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(txtChip);
    expect(txtChip).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(txtChip);
    expect(txtChip).toHaveAttribute("aria-pressed", "false");
  });

  it("详情区会提供打开本地镜像文件按钮", async () => {
    renderWorkbench();

    const button = await screen.findByText("Exchange 分层通讯簿");
    await userEvent.click(button);

    expect(await screen.findByRole("button", { name: t("shell.affairsLibraryOpenLocalFileAction") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.affairsLibraryRevealLocalFileAction") })).toBeInTheDocument();

    const bridge = getCodingNSDesktopBridge();
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsLibraryOpenLocalFileAction") }));

    expect(bridge.fs.openFile).toHaveBeenCalledWith("/Users/jackson/SynologyDrive/Exchange 分层通讯簿.txt");
  });


  it("保存设置时会提交 mirrorRoot 和 allowedExtensions", async () => {
    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibrarySettingsAction") }));

    const mirrorRootInput = await screen.findByDisplayValue("/Users/jackson/SynologyDrive");

    await userEvent.clear(mirrorRootInput);
    await userEvent.type(mirrorRootInput, "/Users/jackson/SynologyDrive/Mirror");
    await userEvent.click(screen.getByRole("button", { name: ".docx" }));
    await userEvent.click(screen.getByRole("button", { name: ".txt" }));
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsLibraryConfigSaveAction") }));

    await waitFor(() => {
      expect(conversationApiMock.saveAffairsLibraryConfig).toHaveBeenCalledWith("workspace-1", {
        mirrorRoot: "/Users/jackson/SynologyDrive/Mirror",
        allowedExtensions: [".md", ".pdf", ".txt"]
      });
    });
  });

  it("可以手动添加自定义后缀", async () => {
    renderWorkbench();

    await userEvent.click(await screen.findByRole("button", { name: t("shell.affairsLibrarySettingsAction") }));

    await userEvent.type(
      screen.getByPlaceholderText(t("shell.affairsLibraryAllowedExtensionsCustomPlaceholder")),
      ".pages"
    );
    await userEvent.click(screen.getByRole("button", { name: t("shell.affairsLibraryAllowedExtensionsCustomAddAction") }));

    expect(screen.getByRole("button", { name: ".pages Custom" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(t("shell.affairsLibraryCustomExtensionBadge"))).toBeInTheDocument();
  });
});
