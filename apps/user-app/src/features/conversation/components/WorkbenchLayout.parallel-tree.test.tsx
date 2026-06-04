import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { authStore } from "../../auth/store/auth-store";
import { clientConfigStore } from "../../../config/client-config-store";
import { localUiPreferenceStore } from "../../../preferences/local-ui-preference-store";
import { clearViewSnapshot, writeViewSnapshot } from "../../../shared/cache/view-snapshot-cache";
import { t } from "../../../shared/i18n";
import { ToastProvider } from "../../../shared/toast";
import {
  flattenVisibleSessionTree,
  getTreeNodeChildren,
  getVisibleSessionTreeNodes,
  reorderWorkspaceGroups
} from "./WorkbenchLayout";
import {
  ButlerAuxiliaryProbe,
  CurrentLocationProbe,
  MockWebSocket,
  NoSnapshotWebSocket,
  StartDraftSessionProbe,
  WORKBENCH_NAVIGATION_SNAPSHOT_KEY,
  clickOpenSessionToastActionByTitle,
  createAvailableCapabilities,
  createDragDataTransfer,
  createJsonResponse,
  createPermissionRequest,
  createSessionSummary,
  createSkillOverviewResponse,
  createUnavailableCapabilities,
  createWorkbenchSnapshot,
  createWorkbenchWorktreeNode,
  createWorkspace,
  createWorkspaceManagementSummary,
  findSessionCardByTitle,
  findWorkspaceGroupByName,
  getSessionCardByTitle,
  mockAffairsLibraryFetch,
  mockNavigator,
  openFilesExternalWindowMock,
  openGitExternalWindowMock,
  openProcessesExternalWindowMock,
  openSessionCardContextMenu,
  querySessionCardsByTitle,
  readWorkspaceGroupOrder,
  registerWorkbenchLayoutTestHooks,
  renderWorkbenchRoute,
  showDesktopContextMenuMock
} from "./WorkbenchLayout.test-support";

describe("WorkbenchLayout", () => {
  registerWorkbenchLayoutTestHooks();

  it("并行锚点展开后不会再复制锚点记录，成员会直接挂在原树结构下", async () => {
    const parallelGroup = {
      groupId: "parallel-group-1",
      memberCount: 2,
      sourceType: "fork" as const,
      sourceSessionId: "session-anchor",
      anchorSessionId: "session-anchor",
      colorToken: "parallel-group-1"
    };
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-anchor",
            title: "Codex 锚点",
            workspaceId: "workspace-1",
            provider: "codex",
            parallelGroup: {
              ...parallelGroup,
              role: "anchor"
            }
          }),
          createSessionSummary({
            sessionId: "session-member",
            title: "Claude 成员",
            workspaceId: "workspace-1",
            provider: "claude-code",
            parallelGroup: {
              ...parallelGroup,
              role: "member"
            },
            displayParentSessionId: "session-anchor"
          })
        ]
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/providers/")) {
        return createJsonResponse(createAvailableCapabilities("codex"));
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-anchor");

    const anchorCard = await findSessionCardByTitle("Codex 锚点");
    expect(within(anchorCard).getByText(t("shell.parallelGroupBadge", { count: 2 }))).toBeInTheDocument();
    await userEvent.click(within(anchorCard).getByRole("button", { name: t("shell.subagentExpand") }));

    const rootTreeNode = anchorCard.closest(".workbench-session-tree-node");

    if (!(rootTreeNode instanceof HTMLElement)) {
      throw new Error("未找到锚点树节点");
    }

    expect(within(rootTreeNode).getAllByText("Codex 锚点")).toHaveLength(1);
    expect(within(rootTreeNode).getByText("Claude 成员")).toBeInTheDocument();
    expect(screen.queryByText(t("shell.parallelGroupAnchorBadge"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("shell.parallelGroupMemberBadge"))).not.toBeInTheDocument();
  });

  it("并行成员展开后仍可继续展开自己的子 Agent 列表", async () => {
    const parallelGroup = {
      groupId: "parallel-group-1",
      memberCount: 2,
      sourceType: "fork" as const,
      sourceSessionId: "session-anchor",
      anchorSessionId: "session-anchor",
      colorToken: "parallel-group-1"
    };
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-anchor",
            title: "并行锚点",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "anchor"
            }
          }),
          createSessionSummary({
            sessionId: "session-member",
            title: "并行成员",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "member"
            },
            displayParentSessionId: "session-anchor"
          }),
          createSessionSummary({
            sessionId: "session-member-subagent",
            title: "成员子 Agent",
            workspaceId: "workspace-1",
            parentSessionId: "session-member",
            isSubagent: true,
            subagentLabel: "worker"
          })
        ]
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/providers/")) {
        return createJsonResponse(createAvailableCapabilities("codex"));
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-anchor");

    const anchorCard = await findSessionCardByTitle("并行锚点");
    await userEvent.click(within(anchorCard).getByRole("button", { name: t("shell.subagentExpand") }));

    const memberCard = await findSessionCardByTitle("并行成员");
    const memberExpandButton = within(memberCard).getByRole("button", { name: t("shell.subagentExpand") });
    expect(memberExpandButton).toBeInTheDocument();

    await userEvent.click(memberExpandButton);

    expect(await screen.findByText("成员子 Agent")).toBeInTheDocument();
    const memberTreeNode = memberCard.closest(".workbench-session-tree-node");

    if (!(memberTreeNode instanceof HTMLElement)) {
      throw new Error("未找到并行成员树节点");
    }

    expect(within(memberTreeNode).getByText("成员子 Agent")).toBeInTheDocument();
  });

  it("并行成员的子 Agent 位于 child worktree 时，仍会显示在当前会话树下", async () => {
    const parallelGroup = {
      groupId: "parallel-group-1",
      memberCount: 2,
      sourceType: "fork" as const,
      sourceSessionId: "session-anchor",
      anchorSessionId: "session-anchor",
      colorToken: "parallel-group-1"
    };
    const promotedWorkspace = {
      id: "isolated-1",
      workspaceId: "workspace-1-child",
      sourceWorkspaceId: "workspace-1",
      branchName: "parallel/member-1",
      lifecycleStatus: "active" as const,
      promotedAt: null,
      createdAt: "2026-04-24T08:00:00.000Z",
      updatedAt: "2026-04-24T08:00:00.000Z"
    };
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-anchor",
            title: "并行锚点",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "anchor"
            }
          }),
          createSessionSummary({
            sessionId: "session-member",
            title: "并行成员",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "member"
            },
            displayParentSessionId: "session-anchor",
            sessionIsolatedWorkspace: promotedWorkspace
          })
        ],
        childWorktrees: [
          createWorkbenchWorktreeNode({
            workspace: createWorkspace("workspace-1-child", "并行成员工作区"),
            displayName: "parallel/member-1",
            branchName: "parallel/member-1",
            sessions: [
              createSessionSummary({
                sessionId: "session-member-subagent",
                title: "工作树子 Agent",
                workspaceId: "workspace-1-child",
                parentSessionId: "session-member",
                isSubagent: true,
                subagentLabel: "worker"
              })
            ]
          })
        ]
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/providers/")) {
        return createJsonResponse(createAvailableCapabilities("codex"));
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-anchor");

    const anchorCard = await findSessionCardByTitle("并行锚点");
    await userEvent.click(within(anchorCard).getByRole("button", { name: t("shell.subagentExpand") }));

    const memberCard = await findSessionCardByTitle("并行成员");
    await userEvent.click(within(memberCard).getByRole("button", { name: t("shell.subagentExpand") }));

    expect(await screen.findByText("工作树子 Agent")).toBeInTheDocument();
  });

  it("并行成员的子 Agent 同时存在根工作区投影和 child worktree 原始记录时，只在并行成员下显示一次", async () => {
    const parallelGroup = {
      groupId: "parallel-group-1",
      memberCount: 2,
      sourceType: "fork" as const,
      sourceSessionId: "session-anchor",
      anchorSessionId: "session-anchor",
      colorToken: "parallel-group-1"
    };
    const promotedWorkspace = {
      id: "isolated-1",
      workspaceId: "workspace-1-child",
      sourceWorkspaceId: "workspace-1",
      branchName: "parallel/member-1",
      lifecycleStatus: "active" as const,
      promotedAt: null,
      createdAt: "2026-04-24T08:00:00.000Z",
      updatedAt: "2026-04-24T08:00:00.000Z"
    };
    const duplicatedSubagent = createSessionSummary({
      sessionId: "session-member-subagent",
      title: "工作树子 Agent",
      workspaceId: "workspace-1",
      parentSessionId: "session-member",
      displayParentSessionId: "session-member",
      isSubagent: true,
      subagentLabel: "worker"
    });
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-anchor",
            title: "并行锚点",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "anchor"
            }
          }),
          createSessionSummary({
            sessionId: "session-member",
            title: "并行成员",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "member"
            },
            displayParentSessionId: "session-anchor",
            sessionIsolatedWorkspace: promotedWorkspace
          }),
          duplicatedSubagent
        ],
        childWorktrees: [
          createWorkbenchWorktreeNode({
            workspace: createWorkspace("workspace-1-child", "并行成员工作区"),
            displayName: "parallel/member-1",
            branchName: "parallel/member-1",
            sessions: [
              createSessionSummary({
                sessionId: "session-member-subagent",
                title: "工作树子 Agent",
                workspaceId: "workspace-1-child",
                parentSessionId: "session-member",
                isSubagent: true,
                subagentLabel: "worker"
              })
            ]
          })
        ]
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/providers/")) {
        return createJsonResponse(createAvailableCapabilities("codex"));
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-anchor");

    const anchorCard = await findSessionCardByTitle("并行锚点");
    await userEvent.click(within(anchorCard).getByRole("button", { name: t("shell.subagentExpand") }));

    const memberCard = await findSessionCardByTitle("并行成员");
    await userEvent.click(within(memberCard).getByRole("button", { name: t("shell.subagentExpand") }));

    const memberTreeNode = memberCard.closest(".workbench-session-tree-node");

    if (!(memberTreeNode instanceof HTMLElement)) {
      throw new Error("未找到并行成员树节点");
    }

    expect(querySessionCardsByTitle("工作树子 Agent")).toHaveLength(1);
    expect(within(memberTreeNode).getByText("工作树子 Agent")).toBeInTheDocument();
  });

  it("并行成员的 child worktree 子 Agent 不会再作为工作树根记录重复显示", async () => {
    const parallelGroup = {
      groupId: "parallel-group-1",
      memberCount: 2,
      sourceType: "fork" as const,
      sourceSessionId: "session-anchor",
      anchorSessionId: "session-anchor",
      colorToken: "parallel-group-1"
    };
    const promotedWorkspace = {
      id: "isolated-1",
      workspaceId: "workspace-1-child",
      sourceWorkspaceId: "workspace-1",
      branchName: "parallel/member-1",
      lifecycleStatus: "active" as const,
      promotedAt: null,
      createdAt: "2026-04-24T08:00:00.000Z",
      updatedAt: "2026-04-24T08:00:00.000Z"
    };
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-anchor",
            title: "并行锚点",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "anchor"
            }
          }),
          createSessionSummary({
            sessionId: "session-member",
            title: "并行成员",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "member"
            },
            displayParentSessionId: "session-anchor",
            sessionIsolatedWorkspace: promotedWorkspace
          })
        ],
        childWorktrees: [
          createWorkbenchWorktreeNode({
            workspace: createWorkspace("workspace-1-child", "并行成员工作区"),
            displayName: "parallel/member-1",
            branchName: "parallel/member-1",
            sessions: [
              createSessionSummary({
                sessionId: "session-member-subagent",
                title: "工作树子 Agent",
                workspaceId: "workspace-1-child",
                parentSessionId: "session-member",
                isSubagent: true,
                subagentLabel: "worker"
              })
            ]
          })
        ]
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/providers/")) {
        return createJsonResponse(createAvailableCapabilities("codex"));
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-anchor");

    const anchorCard = await findSessionCardByTitle("并行锚点");
    await userEvent.click(within(anchorCard).getByRole("button", { name: t("shell.subagentExpand") }));

    const memberCard = await findSessionCardByTitle("并行成员");
    await userEvent.click(within(memberCard).getByRole("button", { name: t("shell.subagentExpand") }));

    const worktreeGroup = await findWorkspaceGroupByName("parallel/member-1");
    await userEvent.click(within(worktreeGroup).getByRole("button", { name: t("shell.worktreeExpand") }));

    expect(within(worktreeGroup).queryByText("工作树子 Agent")).toBeNull();
    expect(querySessionCardsByTitle("工作树子 Agent")).toHaveLength(1);
  });

  it("存在 child worktree 子 Agent 时，仍会保留并行锚点记录", async () => {
    const parallelGroup = {
      groupId: "parallel-group-1",
      memberCount: 2,
      sourceType: "fork" as const,
      sourceSessionId: "session-anchor",
      anchorSessionId: "session-anchor",
      colorToken: "parallel-group-1"
    };
    const promotedWorkspace = {
      id: "isolated-1",
      workspaceId: "workspace-1-child",
      sourceWorkspaceId: "workspace-1",
      branchName: "parallel/member-1",
      lifecycleStatus: "active" as const,
      promotedAt: null,
      createdAt: "2026-04-24T08:00:00.000Z",
      updatedAt: "2026-04-24T08:00:00.000Z"
    };
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "TEST002"),
        sessions: [
          createSessionSummary({
            sessionId: "session-anchor",
            title: "并行锚点",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "anchor"
            }
          }),
          createSessionSummary({
            sessionId: "session-member",
            title: "并行成员",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "member"
            },
            displayParentSessionId: "session-anchor",
            sessionIsolatedWorkspace: promotedWorkspace
          })
        ],
        childWorktrees: [
          createWorkbenchWorktreeNode({
            workspace: createWorkspace("workspace-1-child", "并行成员工作区"),
            displayName: "parallel/member-1",
            branchName: "parallel/member-1",
            sessions: [
              createSessionSummary({
                sessionId: "session-member-subagent",
                title: "工作树子 Agent",
                workspaceId: "workspace-1-child",
                parentSessionId: "session-member",
                isSubagent: true,
                subagentLabel: "worker"
              })
            ]
          })
        ]
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/providers/")) {
        return createJsonResponse(createAvailableCapabilities("codex"));
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-anchor");

    const anchorCard = await findSessionCardByTitle("并行锚点");
    expect(anchorCard).toBeInTheDocument();
    expect(querySessionCardsByTitle("并行锚点")).toHaveLength(1);
  });

  it("并行锚点会额外显示一条对应的并行会话记录，并把直属子 Agent 挂到下一层", async () => {
    const parallelGroup = {
      groupId: "parallel-group-1",
      memberCount: 2,
      sourceType: "new" as const,
      sourceSessionId: null,
      anchorSessionId: "session-anchor",
      colorToken: "parallel-group-1"
    };
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "TEST002"),
        sessions: [
          createSessionSummary({
            sessionId: "session-anchor",
            title: "并行锚点",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "anchor"
            }
          }),
          createSessionSummary({
            sessionId: "session-member",
            title: "并行成员",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "member"
            },
            displayParentSessionId: "session-anchor"
          }),
          createSessionSummary({
            sessionId: "anchor-subagent",
            title: "锚点直属子 Agent",
            workspaceId: "workspace-1",
            parentSessionId: "session-anchor",
            isSubagent: true,
            subagentLabel: "worker"
          }),
          createSessionSummary({
            sessionId: "member-subagent",
            title: "成员直属子 Agent",
            workspaceId: "workspace-1",
            parentSessionId: "session-member",
            isSubagent: true,
            subagentLabel: "worker"
          })
        ]
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/providers/")) {
        return createJsonResponse(createAvailableCapabilities("codex"));
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-anchor");

    const anchorCard = await findSessionCardByTitle("并行锚点");
    await userEvent.click(within(anchorCard).getByRole("button", { name: t("shell.subagentExpand") }));

    const memberCard = await findSessionCardByTitle("并行成员");
    const anchorCards = querySessionCardsByTitle("并行锚点");
    const anchorDepths = anchorCards.map((card) => card.getAttribute("data-depth"));
    const projectedAnchorCard = anchorCards.find((card) => card.getAttribute("data-depth") === "1");

    if (!(projectedAnchorCard instanceof HTMLElement)) {
      throw new Error("未找到锚点对应的并行会话记录");
    }

    expect(anchorCards).toHaveLength(2);
    expect(anchorDepths).toEqual(["0", "1"]);
    expect(memberCard).toHaveAttribute("data-depth", "1");
    expect(screen.queryByText("锚点直属子 Agent")).not.toBeInTheDocument();
    expect(screen.queryByText("成员直属子 Agent")).not.toBeInTheDocument();

    await userEvent.click(within(projectedAnchorCard).getByRole("button", { name: t("shell.subagentExpand") }));

    const anchorSubagentCard = await findSessionCardByTitle("锚点直属子 Agent");
    expect(anchorSubagentCard).toHaveAttribute("data-depth", "2");
    expect(screen.queryByText("成员直属子 Agent")).not.toBeInTheDocument();

    await userEvent.click(within(memberCard).getByRole("button", { name: t("shell.subagentExpand") }));

    const memberSubagentCard = await findSessionCardByTitle("成员直属子 Agent");
    expect(memberSubagentCard).toHaveAttribute("data-depth", "2");

    await userEvent.click(within(projectedAnchorCard).getByRole("button", { name: t("shell.subagentCollapse") }));
    expect(screen.queryByText("锚点直属子 Agent")).not.toBeInTheDocument();
    expect(screen.getByText("成员直属子 Agent")).toBeInTheDocument();
  });

  it("三个并行会话各自的子 Agent 只显示在对应并行会话下面", async () => {
    const parallelGroup = {
      groupId: "parallel-group-1",
      memberCount: 3,
      sourceType: "new" as const,
      sourceSessionId: null,
      anchorSessionId: "session-anchor",
      colorToken: "parallel-group-1"
    };
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "TEST002"),
        sessions: [
          createSessionSummary({
            sessionId: "session-anchor",
            title: "并行锚点",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "anchor"
            }
          }),
          createSessionSummary({
            sessionId: "session-member-1",
            title: "并行成员一",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "member"
            },
            displayParentSessionId: "session-anchor"
          }),
          createSessionSummary({
            sessionId: "session-member-2",
            title: "并行成员二",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "member"
            },
            displayParentSessionId: "session-anchor"
          }),
          createSessionSummary({
            sessionId: "anchor-subagent",
            title: "锚点子 Agent",
            workspaceId: "workspace-1",
            parentSessionId: "session-anchor",
            isSubagent: true,
            subagentLabel: "worker"
          }),
          createSessionSummary({
            sessionId: "member-1-subagent",
            title: "成员一子 Agent",
            workspaceId: "workspace-1",
            parentSessionId: "session-member-1",
            isSubagent: true,
            subagentLabel: "worker"
          }),
          createSessionSummary({
            sessionId: "member-2-subagent",
            title: "成员二子 Agent",
            workspaceId: "workspace-1",
            parentSessionId: "session-member-2",
            isSubagent: true,
            subagentLabel: "worker"
          })
        ]
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/providers/")) {
        return createJsonResponse(createAvailableCapabilities("codex"));
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-anchor");

    const rootAnchorCard = await findSessionCardByTitle("并行锚点");
    await userEvent.click(within(rootAnchorCard).getByRole("button", { name: t("shell.subagentExpand") }));

    const anchorCards = querySessionCardsByTitle("并行锚点");
    const projectedAnchorCard = anchorCards.find((card) => card.getAttribute("data-depth") === "1");
    const memberOneCard = await findSessionCardByTitle("并行成员一");
    const memberTwoCard = await findSessionCardByTitle("并行成员二");

    if (!(projectedAnchorCard instanceof HTMLElement)) {
      throw new Error("未找到锚点对应的并行会话记录");
    }

    await userEvent.click(within(projectedAnchorCard).getByRole("button", { name: t("shell.subagentExpand") }));
    const projectedAnchorTreeNode = projectedAnchorCard.closest(".workbench-session-tree-node");

    if (!(projectedAnchorTreeNode instanceof HTMLElement)) {
      throw new Error("未找到锚点投影树节点");
    }

    expect(within(projectedAnchorTreeNode).getByText("锚点子 Agent")).toBeInTheDocument();
    expect(within(projectedAnchorTreeNode).queryByText("成员一子 Agent")).not.toBeInTheDocument();
    expect(within(projectedAnchorTreeNode).queryByText("成员二子 Agent")).not.toBeInTheDocument();

    await userEvent.click(within(memberOneCard).getByRole("button", { name: t("shell.subagentExpand") }));
    const memberOneTreeNode = memberOneCard.closest(".workbench-session-tree-node");

    if (!(memberOneTreeNode instanceof HTMLElement)) {
      throw new Error("未找到成员一树节点");
    }

    expect(within(memberOneTreeNode).getByText("成员一子 Agent")).toBeInTheDocument();
    expect(within(memberOneTreeNode).queryByText("锚点子 Agent")).not.toBeInTheDocument();
    expect(within(memberOneTreeNode).queryByText("成员二子 Agent")).not.toBeInTheDocument();

    await userEvent.click(within(memberTwoCard).getByRole("button", { name: t("shell.subagentExpand") }));
    const memberTwoTreeNode = memberTwoCard.closest(".workbench-session-tree-node");

    if (!(memberTwoTreeNode instanceof HTMLElement)) {
      throw new Error("未找到成员二树节点");
    }

    expect(within(memberTwoTreeNode).getByText("成员二子 Agent")).toBeInTheDocument();
    expect(within(memberTwoTreeNode).queryByText("锚点子 Agent")).not.toBeInTheDocument();
    expect(within(memberTwoTreeNode).queryByText("成员一子 Agent")).not.toBeInTheDocument();
  });

  it("并行锚点展开时会优先显示所有第一层并行会话，不会把后面的并行成员卡到展开更多子会话后面", async () => {
    const parallelGroup = {
      groupId: "parallel-group-1",
      memberCount: 3,
      sourceType: "new" as const,
      sourceSessionId: null,
      anchorSessionId: "session-anchor",
      colorToken: "parallel-group-1"
    };
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "TEST002"),
        sessions: [
          createSessionSummary({
            sessionId: "session-anchor",
            title: "并行锚点",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "anchor"
            }
          }),
          createSessionSummary({
            sessionId: "session-member-1",
            title: "并行成员一",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "member"
            },
            displayParentSessionId: "session-anchor"
          }),
          createSessionSummary({
            sessionId: "session-member-2",
            title: "并行成员二",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "member"
            },
            displayParentSessionId: "session-anchor"
          }),
          createSessionSummary({
            sessionId: "anchor-subagent-1",
            title: "锚点子 Agent 1",
            workspaceId: "workspace-1",
            parentSessionId: "session-anchor",
            isSubagent: true,
            subagentLabel: "worker"
          }),
          createSessionSummary({
            sessionId: "anchor-subagent-2",
            title: "锚点子 Agent 2",
            workspaceId: "workspace-1",
            parentSessionId: "session-anchor",
            isSubagent: true,
            subagentLabel: "worker"
          }),
          createSessionSummary({
            sessionId: "member-1-subagent-1",
            title: "成员一子 Agent 1",
            workspaceId: "workspace-1",
            parentSessionId: "session-member-1",
            isSubagent: true,
            subagentLabel: "worker"
          }),
          createSessionSummary({
            sessionId: "member-1-subagent-2",
            title: "成员一子 Agent 2",
            workspaceId: "workspace-1",
            parentSessionId: "session-member-1",
            isSubagent: true,
            subagentLabel: "worker"
          }),
          createSessionSummary({
            sessionId: "member-2-subagent-1",
            title: "成员二子 Agent 1",
            workspaceId: "workspace-1",
            parentSessionId: "session-member-2",
            isSubagent: true,
            subagentLabel: "worker"
          }),
          createSessionSummary({
            sessionId: "member-2-subagent-2",
            title: "成员二子 Agent 2",
            workspaceId: "workspace-1",
            parentSessionId: "session-member-2",
            isSubagent: true,
            subagentLabel: "worker"
          })
        ]
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/providers/")) {
        return createJsonResponse(createAvailableCapabilities("codex"));
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-anchor");

    const rootAnchorCard = await findSessionCardByTitle("并行锚点");
    const rootAnchorTreeNode = rootAnchorCard.closest(".workbench-session-tree-node");

    if (!(rootAnchorTreeNode instanceof HTMLElement)) {
      throw new Error("未找到锚点树节点");
    }

    await userEvent.click(within(rootAnchorCard).getByRole("button", { name: t("shell.subagentExpand") }));

    expect(await screen.findByText("并行成员一")).toBeInTheDocument();
    expect(await screen.findByText("并行成员二")).toBeInTheDocument();
    expect(within(rootAnchorTreeNode).getByRole("button", { name: t("shell.subagentExpandMore") })).toBeInTheDocument();
  });

  it("点击并行成员下的 child worktree 子 Agent 时，仍保持并行组页语境", async () => {
    const parallelGroup = {
      groupId: "parallel-group-1",
      memberCount: 2,
      sourceType: "fork" as const,
      sourceSessionId: "session-anchor",
      anchorSessionId: "session-anchor",
      colorToken: "parallel-group-1"
    };
    const promotedWorkspace = {
      id: "isolated-1",
      workspaceId: "workspace-1-child",
      sourceWorkspaceId: "workspace-1",
      branchName: "parallel/member-1",
      lifecycleStatus: "active" as const,
      promotedAt: null,
      createdAt: "2026-04-24T08:00:00.000Z",
      updatedAt: "2026-04-24T08:00:00.000Z"
    };
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "session-anchor",
            title: "并行锚点",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "anchor"
            }
          }),
          createSessionSummary({
            sessionId: "session-member",
            title: "并行成员",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "member"
            },
            displayParentSessionId: "session-anchor",
            sessionIsolatedWorkspace: promotedWorkspace
          })
        ],
        childWorktrees: [
          createWorkbenchWorktreeNode({
            workspace: createWorkspace("workspace-1-child", "并行成员工作区"),
            displayName: "parallel/member-1",
            branchName: "parallel/member-1",
            sessions: [
              createSessionSummary({
                sessionId: "session-member-subagent",
                title: "工作树子 Agent",
                workspaceId: "workspace-1-child",
                parentSessionId: "session-member",
                isSubagent: true,
                subagentLabel: "worker"
              })
            ]
          })
        ]
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/providers/")) {
        return createJsonResponse(createAvailableCapabilities("codex"));
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    const view = renderWorkbenchRoute("/workspaces/workspace-1/sessions/session-anchor");

    const anchorCard = await findSessionCardByTitle("并行锚点");
    await userEvent.click(within(anchorCard).getByRole("button", { name: t("shell.subagentExpand") }));

    const memberCard = await findSessionCardByTitle("并行成员");
    await userEvent.click(within(memberCard).getByRole("button", { name: t("shell.subagentExpand") }));

    const subagentCard = await findSessionCardByTitle("工作树子 Agent");
    await userEvent.click(within(subagentCard).getByRole("button", { name: /工作树子 Agent/ }));

    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe(
        "/workspaces/workspace-1-child/sessions/session-member-subagent"
      );
    });

    const shell = view.container.querySelector(".workbench-shell");

    expect(shell).toHaveAttribute("data-parallel-conversation-active", "true");
    expect(shell).toHaveAttribute("data-right-collapsed", "true");
    expect(screen.queryByRole("button", { name: t("shell.hideInfoSidebar") })).toBeNull();
  });

  it("补全并行成员后代树时，不会把原本可见的并行会话根卡片过滤掉", async () => {
    const parallelGroup = {
      groupId: "parallel-group-1",
      memberCount: 3,
      sourceType: "new" as const,
      sourceSessionId: null,
      anchorSessionId: "parallel-anchor",
      colorToken: "parallel-group-1"
    };
    const currentSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "TEST002"),
        sessions: [
          createSessionSummary({
            sessionId: "parallel-anchor",
            title: "子代理并发写100个笑话到MD文件",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "anchor"
            }
          }),
          createSessionSummary({
            sessionId: "parallel-member-1",
            title: "子代理并发写100个笑话到MD文件",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "member"
            },
            displayParentSessionId: "parallel-anchor"
          }),
          createSessionSummary({
            sessionId: "parallel-member-2",
            title: "子代理并发写100个笑话为MD文件",
            workspaceId: "workspace-1",
            parallelGroup: {
              ...parallelGroup,
              role: "member"
            },
            displayParentSessionId: "parallel-anchor"
          })
        ]
      }
    ]);

    MockWebSocket.workbenchSnapshot = currentSnapshot;
    global.fetch = vi.fn(async (rawInput: RequestInfo | URL) => {
      const url = typeof rawInput === "string" ? rawInput : rawInput.toString();

      if (url.endsWith("/api/workbench")) {
        return createJsonResponse(currentSnapshot);
      }

      if (url.includes("/api/providers/")) {
        return createJsonResponse(createAvailableCapabilities("opencode"));
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/parallel-anchor");

    expect(await findSessionCardByTitle("子代理并发写100个笑话到MD文件")).toBeInTheDocument();
  });

  it("并行标签使用专门的单行 badge 节点", async () => {
    MockWebSocket.workbenchSnapshot = createWorkbenchSnapshot([
      {
        workspace: createWorkspace("workspace-1", "项目一"),
        sessions: [
          createSessionSummary({
            sessionId: "parallel-anchor",
            workspaceId: "workspace-1",
            title: "锚点会话",
            parallelGroup: {
              groupId: "parallel-group-1",
              role: "anchor",
              memberCount: 3,
              sourceType: "new",
              sourceSessionId: null,
              anchorSessionId: "parallel-anchor",
              colorToken: "parallel-group-1"
            }
          })
        ]
      }
    ]);

    renderWorkbenchRoute("/workspaces/workspace-1/sessions/parallel-anchor");

    const badge = await screen.findByText(t("shell.parallelGroupBadge", { count: 3 }));
    expect(badge).toHaveClass("session-parallel-badge");
  });
});
