import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ParallelSessionGroupDetailDto, ProviderCapabilitiesDto, ProviderId } from "../api/conversation-api";
import { t } from "../../../shared/i18n";
import { ParallelSessionCreateModal } from "./ParallelSessionCreateModal";

const mockCreateParallelGroupFromWorkspace = vi.fn();
const mockCreateParallelGroupFromSession = vi.fn();
const mockListProviderCapabilities = vi.fn();

vi.mock("../api/conversation-api", async () => {
  const actual = await vi.importActual<typeof import("../api/conversation-api")>(
    "../api/conversation-api"
  );

  return {
    ...actual,
    createParallelGroupFromWorkspace: (...args: unknown[]) =>
      mockCreateParallelGroupFromWorkspace(...args),
    createParallelGroupFromSession: (...args: unknown[]) =>
      mockCreateParallelGroupFromSession(...args),
    listProviderCapabilities: (...args: unknown[]) =>
      mockListProviderCapabilities(...args)
  };
});

describe("ParallelSessionCreateModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it("公共提示词为空时会直接提示，不会提交", async () => {
    const user = userEvent.setup();

    renderModal();

    await user.click(screen.getByRole("button", { name: t("shell.parallelCreateSubmit") }));

    expect(screen.getByText(t("shell.parallelCreatePromptRequired"))).toBeInTheDocument();
    expect(mockCreateParallelGroupFromWorkspace).not.toHaveBeenCalled();
  });

  it("成员部分失败时会把错误挂到对应成员卡片，并允许继续查看已创建分屏", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const partialDetail = createPartialDetail();
    mockCreateParallelGroupFromWorkspace.mockResolvedValue(partialDetail);

    renderModal({ onCreated });

    await user.type(
      screen.getByPlaceholderText(t("shell.parallelCreateSharedPromptPlaceholder")),
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
    const [modelSelect] = screen.getAllByLabelText(
      t("shell.parallelCreateModelLabel"),
      { selector: "select" }
    );

    expect(within(providerSelect).getByRole("option", { name: "Codex" })).toBeInTheDocument();
    expect(within(providerSelect).getByRole("option", { name: "Claude Code" })).toBeInTheDocument();
    expect(within(providerSelect).getByRole("option", { name: "OpenCode" })).toBeInTheDocument();
    expect(within(providerSelect).queryByRole("option", { name: "Gemini" })).not.toBeInTheDocument();
    expect(within(providerSelect).queryByRole("option", { name: "Kimi" })).not.toBeInTheDocument();

    expect(within(modelSelect).getByRole("option", { name: "Codex Max" })).toBeInTheDocument();
    expect(within(modelSelect).getByRole("option", { name: "Codex Fast" })).toBeInTheDocument();

    await user.selectOptions(providerSelect, "opencode");

    expect(await within(modelSelect).findByRole("option", { name: "OpenCode Pro" })).toBeInTheDocument();
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
