import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ParallelSessionGroupDetailDto, ProviderCapabilitiesDto, ProviderId } from "../api/conversation-api";
import { t } from "../../../shared/i18n";
import { ParallelSessionCreateModal } from "./ParallelSessionCreateModal";

const mockCreateParallelGroupFromWorkspace = vi.fn();
const mockCreateParallelGroupFromSession = vi.fn();
const mockAppendParallelGroupMembers = vi.fn();
const mockListProviderCapabilities = vi.fn();
const mockListProviderCatalog = vi.fn();
const mockGetProviderCapabilities = vi.fn();
const mockFetchModelManagementSnapshot = vi.fn();
const mockGetDefaultSessionPermissionMode = vi.fn(() => "bypassPermissions");

vi.mock("../../../preferences/default-session-permission-mode", () => ({
  getDefaultSessionPermissionMode: () => mockGetDefaultSessionPermissionMode()
}));

vi.mock("../api/conversation-api", async () => {
  const actual = await vi.importActual<typeof import("../api/conversation-api")>(
    "../api/conversation-api"
  );

  return {
    ...actual,
    appendParallelGroupMembers: (...args: unknown[]) =>
      mockAppendParallelGroupMembers(...args),
    createParallelGroupFromWorkspace: (...args: unknown[]) =>
      mockCreateParallelGroupFromWorkspace(...args),
    createParallelGroupFromSession: (...args: unknown[]) =>
      mockCreateParallelGroupFromSession(...args),
    getProviderCapabilities: (...args: unknown[]) =>
      mockGetProviderCapabilities(...args),
    listProviderCatalog: (...args: unknown[]) =>
      mockListProviderCatalog(...args),
    listProviderCapabilities: (...args: unknown[]) =>
      mockListProviderCapabilities(...args)
  };
});

vi.mock("../../settings/api/model-switch-api", async () => {
  const actual = await vi.importActual<typeof import("../../settings/api/model-switch-api")>(
    "../../settings/api/model-switch-api"
  );

  return {
    ...actual,
    fetchModelManagementSnapshot: (...args: unknown[]) =>
      mockFetchModelManagementSnapshot(...args)
  };
});

describe("ParallelSessionCreateModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchModelManagementSnapshot.mockResolvedValue({
      scannedAt: "2026-04-25T10:00:00.000Z",
      items: [
        {
          app: "codex",
          displayName: "Codex",
          cliAvailable: true,
          status: "ready",
          statusText: null,
          currentPresetId: "preset-default",
          currentPresetName: "默认",
          currentModel: "gpt-5.4",
          options: [
            {
              id: "preset-team-a",
              name: "Team A",
              model: "gpt-5.4",
              summary: "Team A summary",
              isCurrent: false
            },
            {
              id: "preset-team-b",
              name: "Team B",
              model: "gpt-5.3-codex",
              summary: "Team B summary",
              isCurrent: false
            }
          ]
        }
      ]
    });
    mockListProviderCatalog.mockResolvedValue([
      { provider: "codex", displayName: "Codex", enabled: true },
      { provider: "claude-code", displayName: "Claude Code", enabled: true },
      { provider: "opencode", displayName: "OpenCode", enabled: true },
      { provider: "gemini", displayName: "Gemini", enabled: false },
      { provider: "kimi", displayName: "Kimi", enabled: false }
    ]);
    mockListProviderCapabilities.mockResolvedValue({
      codex: createCapabilities("codex", [
        { id: "provider-default", name: "跟随 CLI 默认模型", usesProviderDefault: true },
        { id: "codex-max", name: "Codex Max" },
        { id: "codex-fast", name: "Codex Fast" }
      ]),
      "claude-code": createCapabilities("claude-code", [
        { id: "provider-default", name: "跟随 CLI 默认模型", usesProviderDefault: true },
        { id: "claude-sonnet", name: "Claude Sonnet" }
      ]),
      opencode: createCapabilities("opencode", [
        { id: "provider-default", name: "跟随 CLI 默认模型", usesProviderDefault: true },
        { id: "opencode-pro", name: "OpenCode Pro" }
      ]),
      gemini: {
        ...createCapabilities("gemini"),
        canStartSession: false,
        limitations: ["未安装 Gemini CLI"]
      },
      kimi: {
        ...createCapabilities("kimi"),
        canStartSession: false,
        limitations: ["未安装 Kimi CLI"]
      }
    });
    mockGetProviderCapabilities.mockImplementation(async (provider: ProviderId, _workspaceId?: string, providerConfig?: {
      providerConfigMode?: "global-default" | "cc-switch-preset";
      providerPresetId?: string | null;
    }) => {
      if (provider === "codex" && providerConfig?.providerConfigMode === "cc-switch-preset") {
        return createCapabilities("codex", [
          { id: "provider-default", name: "跟随 CLI 默认模型", usesProviderDefault: true },
          { id: "gpt-5.4", name: "gpt-5.4" }
        ]);
      }

      return createCapabilities(provider);
    });
  });

  it("公共提示词为空时会直接提示，不会提交", async () => {
    const user = userEvent.setup();

    renderModal();

    await user.click(screen.getByRole("button", { name: t("shell.parallelCreateSubmit") }));

    expect(await screen.findByText(t("shell.parallelCreatePromptRequired"))).toBeInTheDocument();
    expect(mockCreateParallelGroupFromWorkspace).not.toHaveBeenCalled();
  });

  it("提交并行创建时会把全局默认权限模式一起带上", async () => {
    const user = userEvent.setup();
    mockCreateParallelGroupFromWorkspace.mockResolvedValue(createSuccessDetail());

    renderModal();

    await user.type(
      screen.getByLabelText(t("shell.parallelCreateSharedPromptLabel")),
      "同一个需求走两条实现线"
    );
    await user.click(screen.getByRole("button", { name: t("shell.parallelCreateSubmit") }));

    expect(mockCreateParallelGroupFromWorkspace).toHaveBeenCalledWith(
      "workspace-1",
      expect.objectContaining({
        permissionMode: "bypassPermissions"
      })
    );
  });

  it("成员部分失败时会把错误挂到对应成员卡片，并允许继续查看已创建分屏", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const partialDetail = createPartialDetail();
    mockCreateParallelGroupFromWorkspace.mockResolvedValue(partialDetail);

    renderModal({ onCreated });

    await user.type(
      screen.getByLabelText(t("shell.parallelCreateSharedPromptLabel")),
      "同一个问题分别给出两种实现方向"
    );
    await user.click(screen.getByRole("button", { name: t("shell.parallelCreateSubmit") }));

    expect(
      await screen.findByText(
        t("shell.parallelCreatePartialFailure", {
          successCount: 1,
          failureCount: 1
        })
      )
    ).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: t("shell.parallelCreateContinuePartial") })
    ).toBeInTheDocument();

    const memberTwoCard = screen.getByText(t("shell.parallelCreateMemberTitle", { index: 2 })).closest(".parallel-create-member-card");

    if (!(memberTwoCard instanceof HTMLElement)) {
      throw new Error("未找到成员 2 卡片");
    }

    expect(within(memberTwoCard).getByText(t("shell.parallelCreateMemberFailed"))).toBeInTheDocument();
    expect(within(memberTwoCard).getByText(t("shell.parallelCreateMemberErrorTitle"))).toBeInTheDocument();
    expect(within(memberTwoCard).getByText("fork failed")).toBeInTheDocument();

    const memberOneCard = screen.getByText(t("shell.parallelCreateMemberTitle", { index: 1 })).closest(".parallel-create-member-card");

    if (!(memberOneCard instanceof HTMLElement)) {
      throw new Error("未找到成员 1 卡片");
    }

    expect(within(memberOneCard).getByText(t("shell.parallelCreateMemberSucceeded"))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t("shell.parallelCreateContinuePartial") }));

    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(partialDetail);
  });

  it("会改成纵向渐进式表单，并且只显示已安装供应商和对应模型", async () => {
    const user = userEvent.setup();

    renderModal();

    expect(screen.getAllByText(t("shell.parallelCreateSharedPromptLabel")).length).toBeGreaterThan(0);
    expect(screen.getByText(t("shell.parallelCreateMembersTitle"))).toBeInTheDocument();
    expect(screen.getAllByText(t("shell.parallelCreateMemberPromptLabel")).length).toBeGreaterThan(0);

    const [providerSelect] = await screen.findAllByLabelText(
      t("shell.createSessionProviderLabel"),
      { selector: "select" }
    );

    expect(within(providerSelect).getByRole("option", { name: "Codex" })).toBeInTheDocument();
    expect(within(providerSelect).getByRole("option", { name: "Claude Code" })).toBeInTheDocument();
    expect(within(providerSelect).getByRole("option", { name: "OpenCode" })).toBeInTheDocument();
    expect(within(providerSelect).queryByRole("option", { name: "Gemini" })).not.toBeInTheDocument();
    expect(within(providerSelect).queryByRole("option", { name: "Kimi" })).not.toBeInTheDocument();

    expect(screen.getAllByRole("button", { name: t("shell.parallelCreateModelLabel") })).toHaveLength(2);

    await user.selectOptions(providerSelect, "opencode");

    const memberOneCard = screen.getByText(t("shell.parallelCreateMemberTitle", { index: 1 })).closest(".parallel-create-member-card");

    if (!(memberOneCard instanceof HTMLElement)) {
      throw new Error("未找到成员 1 卡片");
    }

    const modelSelect = within(memberOneCard).getByLabelText(
      t("shell.parallelCreateModelLabel"),
      { selector: "select" }
    );

    expect(await within(modelSelect).findByRole("option", { name: "OpenCode Pro" })).toBeInTheDocument();
  });

  it("provider catalog 禁用某项时，即使 capability 还可用，也不会继续出现在并行创建入口", async () => {
    mockListProviderCatalog.mockResolvedValueOnce([
      { provider: "codex", displayName: "Codex", enabled: true },
      { provider: "claude-code", displayName: "Claude Code", enabled: true },
      { provider: "opencode", displayName: "OpenCode", enabled: false },
      { provider: "gemini", displayName: "Gemini", enabled: false },
      { provider: "kimi", displayName: "Kimi", enabled: false }
    ]);

    renderModal();

    const [providerSelect] = await screen.findAllByLabelText(
      t("shell.createSessionProviderLabel"),
      { selector: "select" }
    );

    expect(within(providerSelect).getByRole("option", { name: "Codex" })).toBeInTheDocument();
    expect(within(providerSelect).getByRole("option", { name: "Claude Code" })).toBeInTheDocument();
    expect(within(providerSelect).queryByRole("option", { name: "OpenCode" })).not.toBeInTheDocument();
  });

  it("给已有并行组追加成员时，会锁定顶部消息并把数量限制在剩余槽位内", () => {
    render(
      <ParallelSessionCreateModal
        open
        source={{
          kind: "group",
          groupId: "parallel-group-1",
          workspaceId: "workspace-1",
          workspaceName: "项目一",
          sharedPrompt: "请围绕同一个需求继续并行推进",
          currentMemberCount: 3,
          defaultProvider: "codex"
        }}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: t("shell.parallelAppendModalTitle") })).toBeInTheDocument();
    const promptField = screen.getByLabelText(t("shell.parallelAppendSharedPromptLabel"));
    expect(promptField).toHaveValue("请围绕同一个需求继续并行推进");
    expect(promptField).toHaveAttribute("readonly");
    expect(screen.getByRole("group", { name: t("shell.parallelAppendCountLabel") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "2" })).not.toBeInTheDocument();
  });

  it("Codex 成员会显示双列 deployment 选择，并把 preset 选择一起提交", async () => {
    const user = userEvent.setup();
    mockCreateParallelGroupFromWorkspace.mockResolvedValue(createSuccessDetail());

    renderModal();

    await user.type(
      screen.getByLabelText(t("shell.parallelCreateSharedPromptLabel")),
      "并行验证 preset"
    );

    const [deploymentTrigger] = await screen.findAllByRole("button", {
      name: t("shell.parallelCreateModelLabel")
    });
    await user.click(deploymentTrigger);
    await user.click(await screen.findByRole("option", { name: /Team A/ }));
    await user.click(await screen.findByRole("option", { name: "gpt-5.4" }));
    await user.click(screen.getByRole("button", { name: t("shell.parallelCreateSubmit") }));

    expect(mockGetProviderCapabilities).toHaveBeenCalledWith(
      "codex",
      "workspace-1",
      {
        providerConfigMode: "cc-switch-preset",
        providerPresetId: "preset-team-a"
      }
    );
    expect(mockCreateParallelGroupFromWorkspace).toHaveBeenCalledWith(
      "workspace-1",
      expect.objectContaining({
        members: expect.arrayContaining([
          expect.objectContaining({
            provider: "codex",
            model: "gpt-5.4",
            providerConfigMode: "cc-switch-preset",
            providerPresetId: "preset-team-a"
          })
        ])
      })
    );
  });

  it("供应商只有一个 preset 时会隐藏配置文件列，只显示模型列表", async () => {
    const user = userEvent.setup();
    mockFetchModelManagementSnapshot.mockResolvedValueOnce({
      scannedAt: "2026-04-25T10:00:00.000Z",
      items: [
        {
          app: "codex",
          displayName: "Codex",
          cliAvailable: true,
          status: "ready",
          statusText: null,
          currentPresetId: "preset-default",
          currentPresetName: "默认",
          currentModel: "gpt-5.4",
          options: [
            {
              id: "preset-default",
              name: "默认",
              model: "gpt-5.4",
              summary: null,
              isCurrent: true
            }
          ]
        }
      ]
    });

    renderModal();

    const [deploymentTrigger] = await screen.findAllByRole("button", {
      name: t("shell.parallelCreateModelLabel")
    });
    await user.click(deploymentTrigger);

    expect(screen.queryByText(t("conversation.deploymentConfigColumn"))).not.toBeInTheDocument();
    expect(screen.getAllByText(t("conversation.deploymentModelColumn")).length).toBeGreaterThan(0);
    expect(screen.getByRole("option", { name: "Codex Max" })).toBeInTheDocument();
  });
});

function renderModal(options?: {
  onCreated?: (detail: ParallelSessionGroupDetailDto) => void | Promise<void>;
}) {
  const onCreated = options?.onCreated ?? vi.fn();

  return render(
    <ParallelSessionCreateModal
      open
      source={{
        kind: "workspace",
        workspaceId: "workspace-1",
        workspaceName: "项目一",
        defaultProvider: "codex"
      }}
      onClose={vi.fn()}
      onCreated={onCreated}
    />
  );
}

function createCapabilities(
  provider: ProviderId,
  modelOptions: ProviderCapabilitiesDto["modelOptions"] = [
    { id: "provider-default", name: "跟随 CLI 默认模型", usesProviderDefault: true }
  ]
): ProviderCapabilitiesDto {
  return {
    provider,
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
    modelOptions,
    limitations: []
  };
}

function createPartialDetail(): ParallelSessionGroupDetailDto {
  return {
    group: {
      id: "parallel-group-1",
      workspaceId: "workspace-1",
      sourceType: "new",
      sourceSessionId: null,
      sourceMessageId: null,
      sharedPrompt: "同一个问题分别给出两种实现方向",
      requestedCount: 2,
      anchorSessionId: "session-1",
      status: "active",
      createdByUserId: "user-1",
      createdAt: "2026-04-23T12:00:00.000Z",
      updatedAt: "2026-04-23T12:00:00.000Z",
      deletedAt: null
    },
    members: [
      {
        member: {
          groupId: "parallel-group-1",
          sessionId: "session-1",
          ordinal: 0,
          role: "anchor",
          provider: "codex",
          model: null,
          memberPrompt: null,
          workspaceIsolationMode: "none",
          temporaryWorkspaceId: null,
          createdAt: "2026-04-23T12:00:00.000Z",
          updatedAt: "2026-04-23T12:00:00.000Z",
          deletedAt: null
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
          isFavorite: false,
          title: "成员一",
          messageCount: 0,
          lastMessageAt: null,
          createdAt: "2026-04-23T12:00:00.000Z",
          updatedAt: "2026-04-23T12:00:00.000Z",
          syncStatus: null,
          syncCursor: null,
          lastSyncAt: null,
          lastErrorCode: null,
          lastErrorDetail: null,
          resumedAt: null,
          runningState: null,
          activitySource: "none",
          lastEventAt: null,
          completedAt: null,
          lastSeenAt: null,
          activityState: "idle"
        },
        sessionIsolatedWorkspace: null
      }
    ],
    memberFailures: [
      {
        ordinal: 1,
        provider: "claude-code",
        model: null,
        workspaceIsolationMode: "none",
        errorCode: "PARALLEL_MEMBER_CREATE_FAILED",
        detail: "fork failed"
      }
    ]
  };
}

function createSuccessDetail(): ParallelSessionGroupDetailDto {
  return {
    group: {
      id: "parallel-group-1",
      workspaceId: "workspace-1",
      sourceType: "new",
      sourceSessionId: null,
      sourceMessageId: null,
      sharedPrompt: "同一个需求走两条实现线",
      requestedCount: 2,
      anchorSessionId: "session-1",
      status: "active",
      createdByUserId: "user-1",
      createdAt: "2026-04-23T12:00:00.000Z",
      updatedAt: "2026-04-23T12:00:00.000Z",
      deletedAt: null
    },
    members: [],
    memberFailures: []
  };
}
