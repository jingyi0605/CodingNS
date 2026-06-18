import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { buildConversationTimelineSourceItems } from "../timeline-source-items";
import { ConversationPage } from "./ConversationPage";

const mockGetProviderCapabilities = vi.fn();
const mockGetSessionMessages = vi.fn();
const mockStartLiveSession = vi.fn();
const mockUseWorkbenchShell = vi.fn();
const mockRuntimeStoreInitialize = vi.fn();
const mockRuntimeStoreSessionIds: string[] = [];
const mockRuntimeStoreDestroy = vi.fn();
const mockRuntimeStoreApplyNavigationSession = vi.fn();
const mockRuntimeStoreSendMessage = vi.fn();
const mockQueuedMessageList = vi.fn((_props: unknown) => null);
const mockComposerPanel = vi.fn((_props: unknown) => null);
const mockParallelConversationGroupView = vi.fn((_props: unknown) => null);
const mockParallelSessionCreateModal = vi.fn((_props: unknown) => null);
function createBaseLiveSession() {
  return {
    sessionId: "session-live-1",
    workspaceId: "workspace-1",
    provider: "codex",
    providerSessionId: "provider-session-live-1",
    rawStoreRef: "/tmp/session-live-1.jsonl",
    parentSessionId: null,
    forkMethod: null,
    forkSourceType: null,
    forkSourceSessionId: null,
    forkSourceMessageId: null,
    isSubagent: false,
    subagentLabel: null,
    isArchived: false,
    isFavorite: false,
    title: "父会话",
    messageCount: 3,
    lastMessageAt: "2026-04-11T11:00:00.000Z",
    createdAt: "2026-04-11T10:00:00.000Z",
    updatedAt: "2026-04-11T11:00:00.000Z",
    syncStatus: "idle",
    syncCursor: null,
    lastSyncAt: null,
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: "idle",
    activitySource: "none",
    lastEventAt: "2026-04-11T11:00:00.000Z",
    completedAt: null,
    lastSeenAt: null,
    activityState: "idle"
  };
}

const mockLiveRuntimeState: any = {
  session: createBaseLiveSession(),
  capabilities: null,
  runtimeHasActiveRun: false,
  runtimeCanInterrupt: false,
  messages: [],
  timelineItems: buildConversationTimelineSourceItems({ messages: [] }),
  permissionRequests: [],
  queuedMessages: [],
  contextUsage: null,
  historyState: "ready",
  errorCode: null,
  errorDetail: null,
  interruptSource: null,
  loadingOlderMessages: false,
  hasOlderMessages: false,
  connectionState: "connected"
};

vi.mock("../api/conversation-api", async () => {
  const actual = await vi.importActual<typeof import("../api/conversation-api")>(
    "../api/conversation-api"
  );

  return {
    ...actual,
    getProviderCapabilities: (...args: unknown[]) => mockGetProviderCapabilities(...args),
    getSessionMessages: (...args: unknown[]) => mockGetSessionMessages(...args),
    startLiveSession: (...args: unknown[]) => mockStartLiveSession(...args)
  };
});

vi.mock("../components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../components/ConnectionBanner", () => ({
  ConnectionBanner: () => null
}));

vi.mock("../components/MessageTimeline", () => ({
  MessageTimeline: () => <div data-testid="timeline">timeline</div>
}));

vi.mock("../components/ComposerPanel", () => ({
  ComposerPanel: (props: unknown) => {
    mockComposerPanel(props);
    const composerProps = props as {
      onSend?: (
        content: string,
        options?: {
          model?: string | null;
          attachments?: Array<{
            id: string;
            kind: "image";
            fileName: string;
            mimeType: string;
            fileSize: number;
            contentBase64?: string;
          }>;
          attachmentMeta?: Array<{
            id: string;
            kind: "image";
            fileName: string;
            mimeType: string;
            fileSize: number;
          }>;
          providerConfigMode?: "global-default" | "cc-switch-preset";
          providerPresetId?: string | null;
        }
      ) => Promise<void>;
    };

    return (
      <div data-testid="composer">
        composer
        <button
          type="button"
          data-testid="composer-send"
          onClick={() => {
            void composerProps.onSend?.("继续处理当前会话");
          }}
        >
          发送
        </button>
        <button
          type="button"
          data-testid="composer-send-with-model"
          onClick={() => {
            void composerProps.onSend?.("继续处理当前会话", {
              model: "gpt-5.4",
              providerConfigMode: "cc-switch-preset",
              providerPresetId: "preset-x"
            });
          }}
        >
          发送指定模型
        </button>
        <button
          type="button"
          data-testid="composer-send-with-preset-default"
          onClick={() => {
            void composerProps.onSend?.("继续处理当前会话", {
              model: null,
              providerConfigMode: "cc-switch-preset",
              providerPresetId: "preset-deepseek"
            });
          }}
        >
          发送指定配置文件默认模型
        </button>
        <button
          type="button"
          data-testid="composer-send-with-image"
          onClick={() => {
            void composerProps.onSend?.("请分析这张图片", {
              attachments: [
                {
                  id: "attachment-image-1",
                  kind: "image",
                  fileName: "bug.png",
                  mimeType: "image/png",
                  fileSize: 1024,
                  contentBase64: "ZmFrZQ=="
                }
              ],
              attachmentMeta: [
                {
                  id: "attachment-image-1",
                  kind: "image",
                  fileName: "bug.png",
                  mimeType: "image/png",
                  fileSize: 1024
                }
              ]
            });
          }}
        >
          发送图片
        </button>
      </div>
    );
  }
}));

vi.mock("../components/ParallelConversationGroupView", () => ({
  ParallelConversationGroupView: (props: unknown) => {
    mockParallelConversationGroupView(props);
    const viewProps = props as { groupId: string; currentSessionId: string };

    return (
      <div data-testid="parallel-conversation-group-view">
        parallel:{viewProps.groupId}:{viewProps.currentSessionId}
      </div>
    );
  }
}));

vi.mock("../components/ParallelSessionCreateModal", () => ({
  ParallelSessionCreateModal: (props: unknown) => {
    mockParallelSessionCreateModal(props);
    return null;
  }
}));

vi.mock("../components/SessionHeader", () => ({
  SessionHeader: () => <div data-testid="session-header">header</div>
}));

vi.mock("../components/SessionButlerActionButton", () => ({
  SessionButlerActionButton: () => null
}));

vi.mock("../components/ConversationSelectionActions", () => ({
  ConversationSelectionActions: () => null
}));

vi.mock("../components/PermissionRequestList", () => ({
  PermissionRequestList: () => null
}));

vi.mock("../components/QueuedMessageList", () => ({
  QueuedMessageList: (props: unknown) => mockQueuedMessageList(props)
}));

vi.mock("../components/MobileConversationSessionActions", () => ({
  MobileConversationSessionActions: () => null
}));

vi.mock("../components/SessionBranchTreePanel", () => ({
  SessionBranchTreePanel: () => null,
  buildSessionBranchTreeModel: () => [],
  hasSessionBranchRelations: () => false
}));

vi.mock("../components/FileContextPanel", () => ({
  FileContextPanel: ({
    sessionId,
    workspaceId
  }: {
    sessionId: string;
    workspaceId: string;
  }) => (
    <div data-testid="file-context-panel">
      files:{workspaceId}:{sessionId}
    </div>
  )
}));

vi.mock("../components/GitSidebar", () => ({
  GitSidebar: ({
    workspaceId
  }: {
    workspaceId: string;
  }) => <div data-testid="git-sidebar">git:{workspaceId}</div>
}));

vi.mock("../../workbench/components/TerminalManagerPanel", () => ({
  TerminalManagerPanel: ({
    currentWorkspaceId
  }: {
    currentWorkspaceId: string;
  }) => <div data-testid="process-panel">processes:{currentWorkspaceId}</div>
}));

vi.mock("../runtime/session-runtime-store", () => ({
  SessionRuntimeStore: class {
    constructor(sessionId: string) {
      mockRuntimeStoreSessionIds.push(sessionId);
    }

    initialize = mockRuntimeStoreInitialize;
    destroy = mockRuntimeStoreDestroy;
    applyNavigationSession = mockRuntimeStoreApplyNavigationSession;
    reconnect = vi.fn();
    loadOlderMessages = vi.fn();
    retryMessage = vi.fn();
    replyPermissionRequest = vi.fn();
    enqueueMessage = vi.fn();
    interrupt = vi.fn();
    deleteQueuedMessage = vi.fn();
    steerQueuedMessage = vi.fn();
    sendMessage = mockRuntimeStoreSendMessage;
  },
  useSessionRuntimeStore: (_store: unknown, selector: (state: typeof mockLiveRuntimeState) => unknown) =>
    selector(mockLiveRuntimeState)
}));

describe("ConversationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntimeStoreSessionIds.length = 0;
    mockQueuedMessageList.mockClear();
    mockComposerPanel.mockClear();
    mockParallelConversationGroupView.mockClear();
    mockParallelSessionCreateModal.mockClear();
    mockRuntimeStoreSendMessage.mockReset();
    mockRuntimeStoreSendMessage.mockResolvedValue(undefined);
    mockStartLiveSession.mockReset();
    mockGetSessionMessages.mockReset();
    mockGetSessionMessages.mockResolvedValue({
      messages: [],
      cursor: null,
      nextCursor: null,
      total: 0
    });
    mockStartLiveSession.mockResolvedValue({
      sessionId: "session-live-1",
      provider: "codex",
      session: createBaseLiveSession(),
      message: {
        messageId: "message-live-1",
        provider: "codex",
        providerSessionId: "provider-session-live-1",
        role: "assistant",
        content: "已创建会话",
        timestamp: "2026-04-25T10:00:00.000Z",
        sequence: 1,
        rawRef: "store://session-live-1#1"
      }
    });
    mockLiveRuntimeState.errorCode = null;
    mockLiveRuntimeState.errorDetail = null;
    mockLiveRuntimeState.session = {
      ...createBaseLiveSession(),
      provider: "codex",
      runningState: "idle",
      activityState: "idle"
    };
    mockLiveRuntimeState.capabilities = null;
    mockLiveRuntimeState.runtimeHasActiveRun = false;
    mockLiveRuntimeState.queuedMessages = [];
    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390
    });

    mockGetProviderCapabilities.mockResolvedValue({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      modelOptions: [{ id: "provider-default", name: "跟随 CLI 默认模型", usesProviderDefault: true }],
      limitations: []
    });

    mockUseWorkbenchShell.mockReturnValue(createMobileWorkbenchShellValue());
  });

  it("H5 会话预览列表右键会显示菜单并触发收藏", async () => {
    const toggleFavoriteSession = vi.fn().mockResolvedValue(undefined);
    mockUseWorkbenchShell.mockReturnValue(
      createMobileWorkbenchShellValue({
        toggleFavoriteSession
      })
    );

    const view = renderLiveConversationPage();
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 24, clientY: 180 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 140, clientY: 184 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 140, clientY: 184 }]
    });

    const item = await screen.findByRole("button", { name: /父会话/ });
    fireEvent.contextMenu(item);

    const favoriteAction = await screen.findByRole("button", { name: t("shell.favoriteAction") });
    expect(screen.getByRole("button", { name: t("shell.renameAction") })).toBeInTheDocument();

    await userEvent.click(favoriteAction);

    await waitFor(() => {
      expect(toggleFavoriteSession).toHaveBeenCalledWith("session-live-1");
    });
  });

  it("H5 会话预览列表右键重命名会调用 shell renameSession", async () => {
    const renameSession = vi.fn().mockResolvedValue({
      ...createBaseLiveSession(),
      sessionId: "session-live-1",
      title: "新标题"
    });
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("新标题");

    mockUseWorkbenchShell.mockReturnValue(
      createMobileWorkbenchShellValue({
        renameSession
      })
    );

    const view = renderLiveConversationPage();
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 24, clientY: 180 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 140, clientY: 184 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 140, clientY: 184 }]
    });

    const item = await screen.findByRole("button", { name: /父会话/ });
    fireEvent.contextMenu(item);

    await userEvent.click(await screen.findByRole("button", { name: t("shell.renameAction") }));

    await waitFor(() => {
      expect(renameSession).toHaveBeenCalledWith("session-live-1", "新标题");
    });

    promptSpy.mockRestore();
  });

  it("Codex 运行态由 runtime 快照维持时，发送队列仍会显示引导入口", async () => {
    mockLiveRuntimeState.session = {
      ...mockLiveRuntimeState.session,
      provider: "codex",
      runningState: "idle",
      activityState: "idle"
    };
    mockLiveRuntimeState.capabilities = {
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "streaming_guidance",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      modelOptions: [{ id: "provider-default", name: "跟随 CLI 默认模型", usesProviderDefault: true }],
      limitations: []
    };
    mockLiveRuntimeState.runtimeHasActiveRun = true;
    mockLiveRuntimeState.queuedMessages = [
      {
        id: "queue-1",
        sessionId: "session-live-1",
        content: "把这条继续发给当前 Codex 会话",
        status: "queued",
        orderIndex: 1,
        errorDetail: null,
        createdAt: "2026-04-18T08:00:00.000Z",
        updatedAt: "2026-04-18T08:00:00.000Z"
      }
    ];

    renderLiveConversationPage();

    await waitFor(() => {
      const lastCall = mockQueuedMessageList.mock.calls[mockQueuedMessageList.mock.calls.length - 1];
      const props = lastCall?.[0] as { canSteer?: boolean } | undefined;
      expect(props?.canSteer).toBe(true);
    });
  });

  it("当前路由 session 已从导航快照消失时，不会启动 runtime store，并会跳回可用会话", async () => {
    mockUseWorkbenchShell.mockReturnValue({
      ...createMobileWorkbenchShellValue(),
      shellMode: "desktop",
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "工作区一",
            path: "/Users/jackson/workspace-1"
          },
          sessions: [
            {
              ...createBaseLiveSession(),
              sessionId: "session-fallback-1",
              title: "可用会话"
            }
          ],
          childWorktrees: []
        }
      ]
    });

    renderLiveConversationPage({
      initialEntry: "/workspaces/workspace-1/sessions/session-missing-1",
      withRouteProbe: true
    });

    await waitFor(() => {
      expect(screen.getByTestId("route-probe")).toHaveTextContent(
        "/workspaces/workspace-1/sessions/session-fallback-1"
      );
    });

    expect(mockRuntimeStoreSessionIds).not.toContain("session-missing-1");
    expect(mockRuntimeStoreSessionIds).toContain("session-fallback-1");
  });

  it("PeerHOST live 会话缺失时，自动跳转仍保留 targetHostId", async () => {
    mockLiveRuntimeState.session = null;
    mockUseWorkbenchShell.mockReturnValue(createMobileWorkbenchShellValue({
      currentTargetHostId: "peer-host-1",
      currentWorkspaceRef: {
        hostId: "peer-host-1",
        workspaceId: "remote-workspace-1"
      },
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "工作区一",
            path: "/Users/jackson/workspace-1"
          },
          sessions: [
            {
              ...createBaseLiveSession(),
              sessionId: "session-fallback-1",
              workspaceId: "remote-workspace-1",
              title: "可用远端会话"
            }
          ],
          childWorktrees: []
        }
      ]
    }));

    renderLiveConversationPage({
      initialEntry: "/workspaces/workspace-1/sessions/session-missing-1?targetHostId=peer-host-1",
      withRouteProbe: true
    });

    await waitFor(() => {
      expect(screen.getByTestId("route-probe")).toHaveTextContent(
        "/workspaces/workspace-1/sessions/session-fallback-1?targetHostId=peer-host-1"
      );
    });

    expect(mockRuntimeStoreSessionIds).not.toContain("session-missing-1");
    expect(mockRuntimeStoreSessionIds).toContain("session-fallback-1");
  });

  it("PeerHOST live 会话收到 SESSION_NOT_FOUND 时，会跳到带 targetHostId 的会话列表", async () => {
    mockLiveRuntimeState.errorCode = "SESSION_NOT_FOUND";
    mockLiveRuntimeState.errorDetail = "session 不存在";
    mockUseWorkbenchShell.mockReturnValue(createMobileWorkbenchShellValue({
      currentTargetHostId: "peer-host-1",
      currentWorkspaceRef: {
        hostId: "peer-host-1",
        workspaceId: "remote-workspace-1"
      },
      navigationGroups: [
        {
          workspace: {
            id: "workspace-2",
            name: "工作区二",
            path: "/Users/jackson/workspace-2"
          },
          sessions: [],
          childWorktrees: []
        }
      ]
    }));

    renderLiveConversationPage({
      initialEntry: "/workspaces/workspace-1/sessions/session-live-1?targetHostId=peer-host-1",
      withRouteProbe: true
    });

    await waitFor(() => {
      expect(screen.getByTestId("route-probe")).toHaveTextContent(
        "/workspaces/workspace-2/sessions?targetHostId=peer-host-1"
      );
    });

    expect(mockRuntimeStoreSessionIds).toContain("session-live-1");
  });

  it("当前停在 PeerHOST 远端工作区时，缺失会话回退到主 HOST 工作区不会继续复用旧 targetHostId", async () => {
    mockLiveRuntimeState.errorCode = null;
    mockLiveRuntimeState.errorDetail = null;
    mockUseWorkbenchShell.mockReturnValue(createMobileWorkbenchShellValue({
      currentTargetHostId: "peer-host-1",
      currentWorkspaceRef: {
        hostId: "peer-host-1",
        workspaceId: "remote-workspace-gcac"
      },
      resolveNavigationWorkspaceRef: (workspaceId: string, options?: {
        preferredTargetHostId?: string | null;
        fallbackToCurrent?: boolean;
      }) => {
        if (workspaceId === "workspace-host-1") {
          return { hostId: "current", workspaceId };
        }

        if (options?.preferredTargetHostId === "peer-host-1") {
          return { hostId: "peer-host-1", workspaceId: `remote-${workspaceId}` };
        }

        return { hostId: "current", workspaceId };
      },
      navigationGroups: [
        {
          workspace: {
            id: "workspace-host-1",
            name: "主 HOST 工作区",
            path: "/Users/jackson/workspace-host-1"
          },
          sessions: [
            {
              ...createBaseLiveSession(),
              sessionId: "session-host-fallback-1",
              workspaceId: "workspace-host-1",
              title: "主 HOST 回退会话"
            }
          ],
          childWorktrees: []
        }
      ]
    }));

    renderLiveConversationPage({
      initialEntry: "/workspaces/workspace-gcac/sessions/session-missing-2?targetHostId=peer-host-1",
      withRouteProbe: true
    });

    await waitFor(() => {
      expect(screen.getByTestId("route-probe")).toHaveTextContent(
        "/workspaces/workspace-host-1/sessions/session-host-fallback-1"
      );
      expect(screen.getByTestId("route-probe")).not.toHaveTextContent("targetHostId=peer-host-1");
    });
  });

  it("桌面端并行会话会切到并行分屏视图", () => {
    mockLiveRuntimeState.session = {
      ...mockLiveRuntimeState.session,
      sessionId: "session-live-1",
      workspaceId: "workspace-1",
      parallelGroup: {
        groupId: "parallel-group-1",
        role: "anchor",
        memberCount: 3,
        sourceType: "new",
        sourceSessionId: null,
        anchorSessionId: "session-live-1",
        colorToken: "parallel-group-1"
      }
    };
    mockUseWorkbenchShell.mockReturnValue(
      createMobileWorkbenchShellValue({
        shellMode: "desktop"
      })
    );

    renderLiveConversationPage();

    expect(screen.getByTestId("parallel-conversation-group-view")).toHaveTextContent(
      "parallel:parallel-group-1:session-live-1"
    );
    expect(screen.queryByTestId("session-header")).not.toBeInTheDocument();
  });

  it("桌面端切到并行成员的子 Agent 会话时仍保留并行分屏视图", () => {
    mockLiveRuntimeState.session = {
      ...mockLiveRuntimeState.session,
      sessionId: "session-member-subagent",
      workspaceId: "workspace-1",
      parentSessionId: "session-member",
      isSubagent: true,
      parallelGroup: null
    };
    mockUseWorkbenchShell.mockReturnValue(
      createMobileWorkbenchShellValue({
        shellMode: "desktop",
        navigationGroups: [
          {
            workspace: {
              id: "workspace-1",
              name: "工作区一",
              path: "/Users/jackson/workspace-1"
            },
            sessions: [
              {
                ...mockLiveRuntimeState.session,
                sessionId: "session-anchor",
                parentSessionId: null,
                isSubagent: false,
                parallelGroup: {
                  groupId: "parallel-group-1",
                  role: "anchor",
                  memberCount: 2,
                  sourceType: "new",
                  sourceSessionId: null,
                  anchorSessionId: "session-anchor",
                  colorToken: "parallel-group-1"
                }
              },
              {
                ...mockLiveRuntimeState.session,
                sessionId: "session-member",
                parentSessionId: "session-anchor",
                isSubagent: false,
                parallelGroup: {
                  groupId: "parallel-group-1",
                  role: "member",
                  memberCount: 2,
                  sourceType: "new",
                  sourceSessionId: null,
                  anchorSessionId: "session-anchor",
                  colorToken: "parallel-group-1"
                },
                displayParentSessionId: "session-anchor"
              },
              {
                ...mockLiveRuntimeState.session,
                sessionId: "session-member-subagent",
                parentSessionId: "session-member",
                isSubagent: true,
                parallelGroup: null
              }
            ],
            childWorktrees: []
          }
        ]
      })
    );

    renderLiveConversationPage({
      initialEntry: "/workspaces/workspace-1/sessions/session-member-subagent"
    });

    expect(screen.getByTestId("parallel-conversation-group-view")).toHaveTextContent(
      "parallel:parallel-group-1:session-member-subagent"
    );
    expect(screen.queryByTestId("session-header")).not.toBeInTheDocument();
  });

  it("桌面端已升级为子工作区的并行会话按普通会话展示", () => {
    mockLiveRuntimeState.session = {
      ...mockLiveRuntimeState.session,
      sessionId: "session-live-1",
      workspaceId: "workspace-isolated-1",
      parallelGroup: {
        groupId: "parallel-group-1",
        role: "member",
        memberCount: 2,
        sourceType: "new",
        sourceSessionId: null,
        anchorSessionId: "session-anchor-1",
        colorToken: "parallel-group-1"
      },
      sessionIsolatedWorkspace: {
        id: "isolated-record-1",
        workspaceId: "workspace-isolated-1",
        sourceWorkspaceId: "workspace-1",
        branchName: "parallel/member-1",
        lifecycleStatus: "promoted",
        promotedAt: "2026-04-24T08:30:00.000Z",
        createdAt: "2026-04-24T08:00:00.000Z",
        updatedAt: "2026-04-24T08:30:00.000Z"
      }
    };
    mockUseWorkbenchShell.mockReturnValue(
      createMobileWorkbenchShellValue({
        shellMode: "desktop"
      })
    );

    renderLiveConversationPage({
      initialEntry: "/workspaces/workspace-isolated-1/sessions/session-live-1"
    });

    expect(screen.queryByTestId("parallel-conversation-group-view")).not.toBeInTheDocument();
    expect(screen.getByTestId("timeline")).toBeInTheDocument();
    expect(screen.getByTestId("composer")).toBeInTheDocument();
    expect(mockParallelConversationGroupView).not.toHaveBeenCalled();
  });

  it("移动端并行会话仍按普通单会话视图展示，也不会挂载并行创建弹窗", () => {
    mockLiveRuntimeState.session = {
      ...mockLiveRuntimeState.session,
      sessionId: "session-live-1",
      workspaceId: "workspace-1",
      parallelGroup: {
        groupId: "parallel-group-1",
        role: "anchor",
        memberCount: 3,
        sourceType: "new",
        sourceSessionId: null,
        anchorSessionId: "session-live-1",
        colorToken: "parallel-group-1"
      }
    };

    renderLiveConversationPage();

    expect(screen.queryByTestId("parallel-conversation-group-view")).not.toBeInTheDocument();
    expect(screen.getByTestId("timeline")).toBeInTheDocument();
    expect(mockParallelConversationGroupView).not.toHaveBeenCalled();
    expect(mockParallelSessionCreateModal).not.toHaveBeenCalled();
  });

  it("移动端并行成员挂隔离工作区时，右滑会显示父工作区会话列表而不是空白", async () => {
    mockLiveRuntimeState.session = {
      ...mockLiveRuntimeState.session,
      sessionId: "session-live-1",
      workspaceId: "workspace-isolated-1",
      title: "复制B站首页 YouTube风格",
      parallelGroup: {
        groupId: "parallel-group-1",
        role: "member",
        memberCount: 2,
        sourceType: "new",
        sourceSessionId: null,
        anchorSessionId: "session-anchor-1",
        colorToken: "parallel-group-1"
      },
      sessionIsolatedWorkspace: {
        id: "isolated-record-1",
        workspaceId: "workspace-isolated-1",
        sourceWorkspaceId: "workspace-1",
        branchName: "parallel/member-1",
        lifecycleStatus: "active",
        promotedAt: null,
        createdAt: "2026-04-24T08:00:00.000Z",
        updatedAt: "2026-04-24T08:00:00.000Z"
      }
    };
    mockUseWorkbenchShell.mockReturnValue(
      createMobileWorkbenchShellValue({
        navigationGroups: [
          {
            workspace: {
              id: "workspace-1",
              name: "工作区一",
              path: "/Users/jackson/workspace-1"
            },
            sessions: [
              {
                ...mockLiveRuntimeState.session,
                workspaceId: "workspace-1",
                sessionIsolatedWorkspace: {
                  id: "isolated-record-1",
                  workspaceId: "workspace-isolated-1",
                  sourceWorkspaceId: "workspace-1",
                  branchName: "parallel/member-1",
                  lifecycleStatus: "active",
                  promotedAt: null,
                  createdAt: "2026-04-24T08:00:00.000Z",
                  updatedAt: "2026-04-24T08:00:00.000Z"
                }
              },
              {
                sessionId: "session-1",
                workspaceId: "workspace-1",
                provider: "codex",
                providerSessionId: "provider-session-1",
                rawStoreRef: "store://session-1",
                parentSessionId: null,
                forkMethod: null,
                forkSourceType: null,
                forkSourceSessionId: null,
                forkSourceMessageId: null,
                isSubagent: false,
                subagentLabel: null,
                isArchived: false,
                isFavorite: false,
                title: "历史会话 Alpha",
                messageCount: 4,
                lastMessageAt: "2026-03-28T08:00:00.000Z",
                createdAt: "2026-03-28T07:50:00.000Z",
                updatedAt: "2026-03-28T08:00:00.000Z",
                syncStatus: "idle",
                syncCursor: null,
                lastSyncAt: null,
                lastErrorCode: null,
                lastErrorDetail: null,
                resumedAt: null,
                runningState: "idle",
                activitySource: "none",
                lastEventAt: "2026-03-28T08:00:00.000Z",
                completedAt: null,
                lastSeenAt: null,
                activityState: "idle"
              }
            ]
          }
        ]
      })
    );

    const view = renderLiveConversationPage();
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 24, clientY: 180 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 140, clientY: 184 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 140, clientY: 184 }]
    });

    expect(await screen.findByText("历史会话 Alpha")).toBeInTheDocument();
    expect(view.container.querySelector(".mobile-conversation-preview-item-title")).toHaveTextContent(
      "复制B站首页 YouTube风格"
    );
    expect(screen.queryByText(t("shell.emptyWorkspaceSessions"))).not.toBeInTheDocument();
  });

  it("当前会话发送请求未完成时，也会先把 Composer 切到可停止态", async () => {
    const deferred = createDeferred();
    mockRuntimeStoreSendMessage.mockReturnValue(deferred.promise);
    mockLiveRuntimeState.session = {
      ...mockLiveRuntimeState.session,
      provider: "codex",
      runningState: "idle",
      activityState: "idle"
    };
    mockLiveRuntimeState.runtimeHasActiveRun = false;
    mockLiveRuntimeState.runtimeCanInterrupt = false;

    renderLiveConversationPage();
    fireEvent.click(await screen.findByTestId("composer-send"));

    await waitFor(() => {
      const props = readLatestComposerProps();
      expect(props?.isSubmitting).toBe(true);
      expect(props?.hasActiveRun).toBe(true);
      expect(props?.canInterrupt).toBe(true);
      expect(props?.isRunning).toBe(true);
    });

    deferred.resolve();
    await deferred.promise;
  });

  it("草稿会话创建真实会话后，会把刚才选中的模型继续传给 live Composer", async () => {
    renderDraftConversationPage();

    fireEvent.click(await screen.findByTestId("composer-send-with-model"));

    await waitFor(() => {
      expect(mockStartLiveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-5.4",
          providerConfigMode: "cc-switch-preset",
          providerPresetId: "preset-x"
        }),
        { targetHostId: undefined }
      );
    });

    await waitFor(() => {
      const props = readLatestComposerProps();
      expect(props?.initialModel).toBe("gpt-5.4");
      expect(props?.initialProviderConfigMode).toBe("cc-switch-preset");
      expect(props?.initialProviderPresetId).toBe("preset-x");
    });
  });

  it("草稿会话如果只切了配置文件默认模型，真实会话也会继续使用该配置文件", async () => {
    renderDraftConversationPage();

    fireEvent.click(await screen.findByTestId("composer-send-with-preset-default"));

    await waitFor(() => {
      expect(mockStartLiveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: null,
          providerConfigMode: "cc-switch-preset",
          providerPresetId: "preset-deepseek"
        }),
        { targetHostId: undefined }
      );
    });

    await waitFor(() => {
      const props = readLatestComposerProps();
      expect(props?.initialModel).toBeNull();
      expect(props?.initialProviderConfigMode).toBe("cc-switch-preset");
      expect(props?.initialProviderPresetId).toBe("preset-deepseek");
    });
  });

  it("草稿会话发送图片时，live bootstrap 只注入本地 synthetic user 消息", async () => {
    const view = renderDraftConversationPage({ withRouteProbe: true });

    fireEvent.click(await screen.findByTestId("composer-send-with-image"));

    await waitFor(() => {
      expect(screen.getByTestId("route-probe-state")).toHaveTextContent("\"role\":\"user\"");
      expect(screen.getByTestId("route-probe-state")).toHaveTextContent("\"content\":\"请分析这张图片\"");
      expect(screen.getByTestId("route-probe-state")).toHaveTextContent("\"attachmentCount\":1");
      expect(screen.getByTestId("route-probe-state")).toHaveTextContent("\"attachmentPayloadCount\":1");
      expect(screen.getByTestId("route-probe-state")).toHaveTextContent("\"rawRef\":\"synthetic://codex/session-live-1/");
      expect(screen.getByTestId("route-probe-state")).not.toHaveTextContent("已创建会话");
    });

    expect(view.getByTestId("route-probe")).toHaveTextContent("/workspaces/workspace-1/sessions/session-live-1");
  });

  it("PeerHOST 草稿会话发送消息时，会把 start-live 和跳转都锁到 PeerHOST", async () => {
    mockUseWorkbenchShell.mockReturnValue(createMobileWorkbenchShellValue({
      currentTargetHostId: "peer-host-1",
      currentWorkspaceRef: {
        hostId: "peer-host-1",
        workspaceId: "remote-workspace-1"
      }
    }));
    mockStartLiveSession.mockResolvedValueOnce({
      sessionId: "session-peer-1",
      provider: "codex",
      session: {
        ...createBaseLiveSession(),
        sessionId: "session-peer-1",
        workspaceId: "remote-workspace-1"
      },
      message: {
        messageId: "message-peer-1",
        provider: "codex",
        providerSessionId: "provider-session-peer-1",
        role: "assistant",
        content: "已创建 PeerHOST 会话",
        timestamp: "2026-04-25T10:00:00.000Z",
        sequence: 1,
        rawRef: "store://session-peer-1#1"
      }
    });

    renderDraftConversationPage({
      initialEntry:
        "/workspaces/workspace-1/sessions/draft-codex-1?targetHostId=peer-host-1&provider=codex&workspaceId=remote-workspace-1",
      withRouteProbe: true
    });

    fireEvent.click(await screen.findByTestId("composer-send"));

    await waitFor(() => {
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith("codex", "remote-workspace-1", undefined, {
        targetHostId: "peer-host-1"
      });
      expect(mockStartLiveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "remote-workspace-1",
          provider: "codex"
        }),
        { targetHostId: "peer-host-1" }
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("route-probe")).toHaveTextContent(
        "/workspaces/workspace-1/sessions/session-peer-1?targetHostId=peer-host-1"
      );
    });
  });

  it("PeerHOST 草稿会话切到新建 live 会话时，不会立刻把新会话绑定清空并跳回旧会话", async () => {
    const setSessionWorkspace = vi.fn();

    mockUseWorkbenchShell.mockReturnValue(createMobileWorkbenchShellValue({
      currentTargetHostId: "peer-host-1",
      currentWorkspaceRef: {
        hostId: "peer-host-1",
        workspaceId: "remote-workspace-1"
      },
      setSessionWorkspace
    }));
    mockStartLiveSession.mockResolvedValueOnce({
      sessionId: "session-peer-1",
      provider: "claude-code",
      session: {
        ...createBaseLiveSession(),
        sessionId: "session-peer-1",
        provider: "claude-code",
        workspaceId: "remote-workspace-1"
      },
      message: {
        messageId: "message-peer-1",
        provider: "claude-code",
        providerSessionId: "provider-session-peer-1",
        role: "assistant",
        content: "已创建 Claude Code 会话",
        timestamp: "2026-04-25T10:00:00.000Z",
        sequence: 1,
        rawRef: "store://session-peer-1#1"
      }
    });
    mockLiveRuntimeState.session = null;

    renderDraftConversationPage({
      initialEntry:
        "/workspaces/workspace-1/sessions/draft-codex-1?targetHostId=peer-host-1&provider=claude-code&workspaceId=remote-workspace-1",
      withRouteProbe: true
    });

    fireEvent.click(await screen.findByTestId("composer-send"));

    await waitFor(() => {
      expect(mockStartLiveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "remote-workspace-1",
          provider: "claude-code"
        }),
        { targetHostId: "peer-host-1" }
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("route-probe")).toHaveTextContent("session-peer-1");
    });

    expect(setSessionWorkspace).toHaveBeenCalledWith("session-peer-1", "remote-workspace-1");
    expect(setSessionWorkspace).not.toHaveBeenCalledWith("session-peer-1", null);
  });

  it("移动端在草稿对话页左滑会打开文件页", async () => {
    window.localStorage.setItem("mobile.conversation.preview.mode", "immersive");
    const view = renderDraftConversationPage({ withRouteProbe: true });
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      changedTouches: [{ clientX: 320, clientY: 180 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 180, clientY: 186 }]
    });

    expect(await screen.findByTestId("file-context-panel")).toHaveTextContent(
      "files:workspace-1:draft-codex-1"
    );
    expect(screen.getByTestId("route-probe")).toHaveTextContent(
      "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1&toolPanel=files"
    );
  });

  it("移动端在草稿对话页右滑会打开会话列表", async () => {
    const view = renderDraftConversationPage();
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 24, clientY: 180 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 140, clientY: 184 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 140, clientY: 184 }]
    });

    expect(await screen.findByText("父会话")).toBeInTheDocument();
    expect(view.container.querySelector(".mobile-conversation-preview-rail")).toBeInTheDocument();
  });

  it("移动端会话列表会显示收藏会话和归档入口，没有收藏时会自动隐藏收藏分组", async () => {
    mockUseWorkbenchShell.mockReturnValue(
      createMobileWorkbenchShellValue({
        favoriteSessions: [
          {
            workspace: {
              id: "workspace-1",
              name: "工作区一",
              path: "/Users/jackson/workspace-1"
            },
            session: {
              sessionId: "session-1",
              workspaceId: "workspace-1",
              provider: "codex",
              providerSessionId: "provider-session-1",
              rawStoreRef: "store://session-1",
              parentSessionId: null,
              forkMethod: null,
              forkSourceType: null,
              forkSourceSessionId: null,
              forkSourceMessageId: null,
              isSubagent: false,
              subagentLabel: null,
              isArchived: false,
              isFavorite: true,
              title: "历史会话 Alpha",
              messageCount: 4,
              lastMessageAt: "2026-03-28T08:00:00.000Z",
              createdAt: "2026-03-28T07:50:00.000Z",
              updatedAt: "2026-03-28T08:00:00.000Z",
              syncStatus: "idle",
              syncCursor: null,
              lastSyncAt: null,
              lastErrorCode: null,
              lastErrorDetail: null,
              resumedAt: null,
              runningState: "idle",
              activitySource: "none",
              lastEventAt: "2026-03-28T08:00:00.000Z",
              completedAt: null,
              lastSeenAt: null,
              activityState: "idle"
            }
          }
        ],
        navigationGroups: [
          {
            workspace: {
              id: "workspace-1",
              name: "工作区一",
              path: "/Users/jackson/workspace-1"
            },
            sessions: [
              {
                sessionId: "session-1",
                workspaceId: "workspace-1",
                provider: "codex",
                providerSessionId: "provider-session-1",
                rawStoreRef: "store://session-1",
                parentSessionId: null,
                forkMethod: null,
                forkSourceType: null,
                forkSourceSessionId: null,
                forkSourceMessageId: null,
                isSubagent: false,
                subagentLabel: null,
                isArchived: false,
                isFavorite: true,
                title: "历史会话 Alpha",
                messageCount: 4,
                lastMessageAt: "2026-03-28T08:00:00.000Z",
                createdAt: "2026-03-28T07:50:00.000Z",
                updatedAt: "2026-03-28T08:00:00.000Z",
                syncStatus: "idle",
                syncCursor: null,
                lastSyncAt: null,
                lastErrorCode: null,
                lastErrorDetail: null,
                resumedAt: null,
                runningState: "idle",
                activitySource: "none",
                lastEventAt: "2026-03-28T08:00:00.000Z",
                completedAt: null,
                lastSeenAt: null,
                activityState: "idle"
              },
              {
                sessionId: "archived-1",
                workspaceId: "workspace-1",
                provider: "codex",
                providerSessionId: "provider-session-archived-1",
                rawStoreRef: "store://archived-1",
                parentSessionId: null,
                forkMethod: null,
                forkSourceType: null,
                forkSourceSessionId: null,
                forkSourceMessageId: null,
                isSubagent: false,
                subagentLabel: null,
                isArchived: true,
                isFavorite: false,
                title: "归档会话一",
                messageCount: 2,
                lastMessageAt: "2026-03-27T08:00:00.000Z",
                createdAt: "2026-03-27T07:50:00.000Z",
                updatedAt: "2026-03-27T08:00:00.000Z",
                syncStatus: "idle",
                syncCursor: null,
                lastSyncAt: null,
                lastErrorCode: null,
                lastErrorDetail: null,
                resumedAt: null,
                runningState: "idle",
                activitySource: "none",
                lastEventAt: "2026-03-27T08:00:00.000Z",
                completedAt: null,
                lastSeenAt: null,
                activityState: "idle"
              }
            ]
          }
        ]
      })
    );

    const view = renderLiveConversationPage();
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 24, clientY: 180 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 140, clientY: 184 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 140, clientY: 184 }]
    });

    expect(await screen.findByText(t("shell.favoriteSectionTitle"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.archiveCurrentSessionAction") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("shell.archiveFolderLabel") })).toBeInTheDocument();

    view.unmount();
    mockUseWorkbenchShell.mockReturnValue(createMobileWorkbenchShellValue());

    const rerendered = renderDraftConversationPage();
    const nextStage = rerendered.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(nextStage, {
      touches: [{ clientX: 24, clientY: 180 }]
    });
    fireEvent.touchMove(nextStage, {
      touches: [{ clientX: 140, clientY: 184 }]
    });
    fireEvent.touchEnd(nextStage, {
      changedTouches: [{ clientX: 140, clientY: 184 }]
    });

    expect(await screen.findByText("父会话")).toBeInTheDocument();
    expect(screen.queryByText(t("shell.favoriteSectionTitle"))).not.toBeInTheDocument();
  });

  it("归档会话模态框支持按摘要搜索", async () => {
    mockGetSessionMessages.mockImplementation(async (sessionId: string) => {
      if (sessionId === "archived-1") {
        return {
          messages: [
            {
              messageId: "message-archived-1",
              provider: "codex",
              providerSessionId: "provider-session-archived-1",
              role: "assistant",
              content: "这里记录了支付登录问题的排查结论",
              timestamp: "2026-03-27T08:00:00.000Z",
              sequence: 1,
              rawRef: "store://archived-1#1"
            }
          ],
          cursor: null,
          nextCursor: null,
          total: 1
        };
      }

      return {
        messages: [
          {
            messageId: "message-archived-2",
            provider: "codex",
            providerSessionId: "provider-session-archived-2",
            role: "assistant",
            content: "这里是另一个问题的摘要",
            timestamp: "2026-03-26T08:00:00.000Z",
            sequence: 1,
            rawRef: "store://archived-2#1"
          }
        ],
        cursor: null,
        nextCursor: null,
        total: 1
      };
    });

    const baseSession = createMobileWorkbenchShellValue().navigationGroups[0].sessions[0];

    mockUseWorkbenchShell.mockReturnValue(
      createMobileWorkbenchShellValue({
        navigationGroups: [
          {
            workspace: {
              id: "workspace-1",
              name: "工作区一",
              path: "/Users/jackson/workspace-1"
            },
            sessions: [
              {
                ...baseSession,
                sessionId: "session-1",
                title: "历史会话 Alpha",
                isArchived: false
              },
              {
                ...baseSession,
                sessionId: "archived-1",
                providerSessionId: "provider-session-archived-1",
                rawStoreRef: "store://archived-1",
                title: "归档会话一",
                isArchived: true
              },
              {
                ...baseSession,
                sessionId: "archived-2",
                providerSessionId: "provider-session-archived-2",
                rawStoreRef: "store://archived-2",
                title: "归档会话二",
                isArchived: true
              }
            ]
          }
        ]
      })
    );

    const view = renderLiveConversationPage();
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 24, clientY: 180 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 140, clientY: 184 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 140, clientY: 184 }]
    });

    await userEvent.click(await screen.findByRole("button", { name: t("shell.archiveFolderLabel") }));

    const archiveDialog = await screen.findByRole("dialog", { name: t("shell.archiveModalTitle") });
    await userEvent.click(within(archiveDialog).getByRole("button", { name: t("shell.archiveSearchAction") }));

    await userEvent.type(
      within(archiveDialog).getByRole("textbox", { name: t("shell.archiveSearchLabel") }),
      "支付登录"
    );

    await waitFor(() => {
      expect(within(archiveDialog).getByText("归档会话一")).toBeInTheDocument();
      expect(within(archiveDialog).queryByText("归档会话二")).toBeNull();
    });
  });

  it("旧文件入口带来的 toolPanel 参数会自动打开对应面板", async () => {
    renderDraftConversationPage({
      initialEntry:
        "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1&toolPanel=git"
    });

    expect(await screen.findByTestId("git-sidebar")).toHaveTextContent("git:workspace-1");
  });

  it("工具页里右滑会回到对话页", async () => {
    const view = renderDraftConversationPage({
      initialEntry:
        "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1&toolPanel=files",
      withRouteProbe: true
    });
    const panelButton = await screen.findByRole("button", {
      name: t("shell.mobileConversationToolCloseAction")
    });
    const panel = panelButton.closest(".mobile-conversation-tool-panel") as HTMLElement;

    fireEvent.touchStart(panel, {
      changedTouches: [{ clientX: 84, clientY: 160 }]
    });
    fireEvent.touchEnd(panel, {
      changedTouches: [{ clientX: 180, clientY: 164 }]
    });

    await waitFor(() => {
      expect(screen.queryByTestId("file-context-panel")).not.toBeInTheDocument();
      expect(screen.getByTestId("route-probe")).toHaveTextContent(
        "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1"
      );
    });

    expect(view.container.querySelector(".mobile-conversation-tool-panel")).toBeNull();
  });

  it("工具页标签切换会同步更新查询参数", async () => {
    renderDraftConversationPage({
      initialEntry:
        "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1&toolPanel=files",
      withRouteProbe: true
    });

    fireEvent.click(await screen.findByRole("tab", { name: t("shell.gitEntry") }));

    await waitFor(() => {
      expect(screen.getByTestId("git-sidebar")).toBeInTheDocument();
      expect(screen.getByTestId("route-probe")).toHaveTextContent(
        "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1&toolPanel=git"
      );
    });
  });

  it("工具页支持左滑切换到 Git 和进程，并在 files 上右滑返回对话页", async () => {
    const view = renderDraftConversationPage({
      initialEntry:
        "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1&toolPanel=files",
      withRouteProbe: true
    });
    const panel = await screen.findByRole("button", {
      name: t("shell.mobileConversationToolCloseAction")
    });
    const panelRoot = panel.closest(".mobile-conversation-tool-panel") as HTMLElement;

    expect(screen.queryByTestId("composer")).not.toBeInTheDocument();

    fireEvent.touchStart(panelRoot, {
      changedTouches: [{ clientX: 240, clientY: 180 }]
    });
    fireEvent.touchEnd(panelRoot, {
      changedTouches: [{ clientX: 110, clientY: 186 }]
    });

    await waitFor(() => {
      expect(screen.getByTestId("git-sidebar")).toBeInTheDocument();
      expect(screen.getByTestId("route-probe")).toHaveTextContent("toolPanel=git");
    });

    fireEvent.touchStart(panelRoot, {
      changedTouches: [{ clientX: 240, clientY: 180 }]
    });
    fireEvent.touchEnd(panelRoot, {
      changedTouches: [{ clientX: 104, clientY: 188 }]
    });

    await waitFor(() => {
      expect(screen.getByTestId("process-panel")).toHaveTextContent("processes:workspace-1");
      expect(screen.getByTestId("route-probe")).toHaveTextContent("toolPanel=processes");
    });

    fireEvent.touchStart(panelRoot, {
      changedTouches: [{ clientX: 88, clientY: 176 }]
    });
    fireEvent.touchEnd(panelRoot, {
      changedTouches: [{ clientX: 184, clientY: 182 }]
    });

    await waitFor(() => {
      expect(screen.getByTestId("git-sidebar")).toBeInTheDocument();
      expect(screen.getByTestId("route-probe")).toHaveTextContent("toolPanel=git");
    });

    fireEvent.touchStart(panelRoot, {
      changedTouches: [{ clientX: 88, clientY: 176 }]
    });
    fireEvent.touchEnd(panelRoot, {
      changedTouches: [{ clientX: 184, clientY: 182 }]
    });

    await waitFor(() => {
      expect(screen.getByTestId("file-context-panel")).toBeInTheDocument();
      expect(screen.getByTestId("route-probe")).toHaveTextContent("toolPanel=files");
    });

    fireEvent.touchStart(panelRoot, {
      changedTouches: [{ clientX: 88, clientY: 176 }]
    });
    fireEvent.touchEnd(panelRoot, {
      changedTouches: [{ clientX: 184, clientY: 182 }]
    });

    await waitFor(() => {
      expect(view.container.querySelector(".mobile-conversation-tool-panel")).toBeNull();
      expect(screen.getByTestId("composer")).toBeInTheDocument();
      expect(screen.getByTestId("route-probe")).toHaveTextContent(
        "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1"
      );
    });
  });

  it("会话列表展开时左滑主舞台只会收起列表，不会切到工具页", async () => {
    const view = renderDraftConversationPage();
    const stage = view.container.querySelector(".mobile-conversation-stage") as HTMLElement;

    fireEvent.touchStart(stage, {
      touches: [{ clientX: 300, clientY: 180 }],
      changedTouches: [{ clientX: 300, clientY: 180 }]
    });
    fireEvent.touchMove(stage, {
      touches: [{ clientX: 168, clientY: 186 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 168, clientY: 186 }]
    });

    await waitFor(() => {
      expect(view.container.querySelector(".mobile-conversation-preview-rail")).toBeNull();
      expect(view.container.querySelector(".mobile-conversation-tool-panel")).toBeNull();
    });

    fireEvent.touchStart(stage, {
      changedTouches: [{ clientX: 320, clientY: 180 }]
    });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 180, clientY: 186 }]
    });

    await waitFor(() => {
      expect(screen.getByTestId("file-context-panel")).toBeInTheDocument();
    });
  });

  it("工具页在标签按钮上也支持左右滑动切换标签", async () => {
    window.localStorage.setItem("mobile.conversation.preview.mode", "immersive");
    renderDraftConversationPage({
      initialEntry:
        "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1&toolPanel=files",
      withRouteProbe: true
    });

    const filesTab = await screen.findByRole("tab", { name: t("shell.filesEntry") });

    fireEvent.touchStart(filesTab, {
      changedTouches: [{ clientX: 240, clientY: 180 }]
    });
    fireEvent.touchEnd(filesTab, {
      changedTouches: [{ clientX: 112, clientY: 186 }]
    });

    await waitFor(() => {
      expect(screen.getByTestId("git-sidebar")).toBeInTheDocument();
      expect(screen.getByTestId("route-probe")).toHaveTextContent("toolPanel=git");
    });
  });

  it("移动端点击顶部工作区切换后，仍会进入目标工作区会话列表", async () => {
    const selectWorkspace = vi.fn();
    mockUseWorkbenchShell.mockReturnValue(
      createMobileWorkbenchShellValue({
        selectWorkspace,
        navigationGroups: [
          {
            workspace: {
              id: "workspace-1",
              name: "工作区一",
              path: "/Users/jackson/workspace-1"
            },
            sessions: []
          },
          {
            workspace: {
              id: "workspace-2",
              name: "工作区二",
              path: "/Users/jackson/workspace-2"
            },
            sessions: []
          }
        ]
      })
    );

    renderDraftConversationPage({ withRouteProbe: true });

    fireEvent.click(screen.getByRole("button", { name: t("shell.workspaceHomeSwitcherLabel") }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /工作区二/
      })
    );

    await waitFor(() => {
      expect(selectWorkspace).toHaveBeenCalledWith("workspace-2", {
        hostId: "current",
        workspaceId: "workspace-2"
      });
      expect(screen.getByTestId("route-probe")).toHaveTextContent("/workspaces/workspace-2/sessions");
    });
  });

  it("子工作树里的并行会话也会把导航摘要同步给 runtime store", async () => {
    mockUseWorkbenchShell.mockReturnValue(
      createMobileWorkbenchShellValue({
        navigationGroups: [
          {
            workspace: {
              id: "workspace-1",
              name: "工作区一",
              path: "/Users/jackson/workspace-1"
            },
            sessions: [],
            childWorktrees: [
              {
                workspace: {
                  id: "workspace-isolated-1",
                  name: "并行工作树一",
                  path: "/Users/jackson/workspace-1/.worktrees/parallel-1"
                },
                meta: {
                  id: "worktree-meta-1",
                  rootWorkspaceId: "workspace-1",
                  parentWorkspaceId: "workspace-1",
                  branchName: "parallel/member-1",
                  linkedSessionId: "session-live-1",
                  lifecycleStatus: "active",
                  createdAt: "2026-04-24T08:00:00.000Z",
                  updatedAt: "2026-04-24T08:00:00.000Z"
                },
                sessions: [
                  {
                    ...mockLiveRuntimeState.session,
                    sessionId: "session-live-1",
                    workspaceId: "workspace-isolated-1",
                    parallelGroup: {
                      groupId: "parallel-group-1",
                      role: "member",
                      memberCount: 2,
                      sourceType: "new",
                      sourceSessionId: null,
                      anchorSessionId: "session-anchor-1",
                      colorToken: "parallel-group-1"
                    },
                    sessionIsolatedWorkspace: {
                      id: "isolated-record-1",
                      workspaceId: "workspace-isolated-1",
                      sourceWorkspaceId: "workspace-1",
                      branchName: "parallel/member-1",
                      lifecycleStatus: "active",
                      promotedAt: null,
                      createdAt: "2026-04-24T08:00:00.000Z",
                      updatedAt: "2026-04-24T08:00:00.000Z"
                    }
                  }
                ],
                children: []
              }
            ]
          }
        ]
      })
    );

    renderLiveConversationPage({
      initialEntry: "/workspaces/workspace-isolated-1/sessions/session-live-1"
    });

    await waitFor(() => {
      expect(mockRuntimeStoreApplyNavigationSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-live-1",
          workspaceId: "workspace-isolated-1"
        })
      );
    });
  });
});

function renderDraftConversationPage(options?: {
  initialEntry?: string;
  withRouteProbe?: boolean;
}) {
  const initialEntry =
    options?.initialEntry
    ?? "/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1";
  const withRouteProbe = options?.withRouteProbe ?? false;

  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/workspaces/:workspaceId/sessions/:sessionId"
          element={
            <>
              <ConversationPage />
              {withRouteProbe ? <RouteProbe /> : null}
            </>
          }
        />
        <Route
          path="/workspaces/:workspaceId/sessions"
          element={withRouteProbe ? <RouteProbe /> : null}
        />
      </Routes>
    </MemoryRouter>
  );
}

function createDeferred() {
  let resolve: (() => void) | null = null;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });

  return {
    promise,
    resolve: resolve!
  };
}

function readLatestComposerProps(): {
  hasActiveRun?: boolean | null;
  canInterrupt?: boolean | null;
  isSubmitting?: boolean;
  isRunning?: boolean;
  initialModel?: string | null;
  initialProviderConfigMode?: "global-default" | "cc-switch-preset";
  initialProviderPresetId?: string | null;
} | null {
  const latestCall = mockComposerPanel.mock.calls[mockComposerPanel.mock.calls.length - 1];
  return (latestCall?.[0] as {
    hasActiveRun?: boolean | null;
    canInterrupt?: boolean | null;
    isSubmitting?: boolean;
    isRunning?: boolean;
    initialModel?: string | null;
    initialProviderConfigMode?: "global-default" | "cc-switch-preset";
    initialProviderPresetId?: string | null;
  } | undefined) ?? null;
}

function renderLiveConversationPage(options?: {
  initialEntry?: string;
  withRouteProbe?: boolean;
}) {
  const initialEntry =
    options?.initialEntry
    ?? "/workspaces/workspace-1/sessions/session-live-1";
  const withRouteProbe = options?.withRouteProbe ?? false;

  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/workspaces/:workspaceId/sessions/:sessionId"
          element={
            <>
              <ConversationPage />
              {withRouteProbe ? <RouteProbe /> : null}
            </>
          }
        />
        <Route
          path="/workspaces/:workspaceId/sessions"
          element={withRouteProbe ? <RouteProbe /> : null}
        />
      </Routes>
    </MemoryRouter>
  );
}

function createMobileWorkbenchShellValue(overrides: Record<string, unknown> = {}) {
  return {
    shellMode: "mobile",
    navigationGroups: [
      {
        workspace: {
          id: "workspace-1",
          name: "工作区一",
          path: "/Users/jackson/workspace-1"
        },
        sessions: [
          {
            sessionId: "session-live-1",
            workspaceId: "workspace-1",
            provider: "codex",
            providerSessionId: "provider-session-live-1",
            rawStoreRef: "store://session-live-1",
            parentSessionId: null,
            forkMethod: null,
            forkSourceType: null,
            forkSourceSessionId: null,
            forkSourceMessageId: null,
            isSubagent: false,
            subagentLabel: null,
            isArchived: false,
            isFavorite: false,
            title: "父会话",
            messageCount: 4,
            lastMessageAt: "2026-03-28T08:00:00.000Z",
            createdAt: "2026-03-28T07:50:00.000Z",
            updatedAt: "2026-03-28T08:00:00.000Z",
            syncStatus: "idle",
            syncCursor: null,
            lastSyncAt: null,
            lastErrorCode: null,
            lastErrorDetail: null,
            resumedAt: null,
            runningState: "idle",
            activitySource: "none",
            lastEventAt: "2026-03-28T08:00:00.000Z",
            completedAt: null,
            lastSeenAt: null,
            activityState: "idle"
          }
        ]
      }
    ],
    requestNavigationRefresh: vi.fn(),
    selectWorkspace: vi.fn(),
    setSessionWorkspace: vi.fn(),
    resolveNavigationWorkspaceRef: (workspaceId: string, options?: {
      preferredTargetHostId?: string | null;
      fallbackToCurrent?: boolean;
    }) => {
      if (options?.preferredTargetHostId) {
        return {
          hostId: options.preferredTargetHostId,
          workspaceId
        };
      }

      return {
        hostId: "current",
        workspaceId
      };
    },
    upsertNavigationSession: vi.fn(),
    markNavigationSessionSeen: vi.fn(),
    favoriteSessions: [],
    archiveSession: vi.fn(),
    unarchiveSession: vi.fn(),
    startDraftSession: vi.fn(),
    ...overrides
  };
}

function RouteProbe() {
  const location = useLocation();
  return (
    <>
      <div data-testid="route-probe">{location.pathname + location.search}</div>
      <div data-testid="route-probe-state">
        {JSON.stringify(summarizeRouteState(location.state))}
      </div>
    </>
  );
}

function summarizeRouteState(state: unknown) {
  if (!state || typeof state !== "object") {
    return null;
  }

  const routeState = state as {
    bootstrap?: {
      sessionId?: unknown;
      messages?: Array<{
        role?: unknown;
        content?: unknown;
        rawRef?: unknown;
        attachments?: unknown;
        attachmentPayloads?: unknown;
      }>;
    };
  };
  const bootstrap = routeState.bootstrap;

  if (!bootstrap || typeof bootstrap !== "object") {
    return null;
  }

  return {
    sessionId: typeof bootstrap.sessionId === "string" ? bootstrap.sessionId : null,
    messages: Array.isArray(bootstrap.messages)
      ? bootstrap.messages.map((message) => ({
          role: typeof message?.role === "string" ? message.role : null,
          content: typeof message?.content === "string" ? message.content : null,
          rawRef: typeof message?.rawRef === "string" ? message.rawRef : null,
          attachmentCount: Array.isArray(message?.attachments) ? message.attachments.length : 0,
          attachmentPayloadCount: Array.isArray(message?.attachmentPayloads)
            ? message.attachmentPayloads.length
            : 0
        }))
      : []
  };
}
