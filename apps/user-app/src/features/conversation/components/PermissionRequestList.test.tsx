import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PermissionRequestList } from "./PermissionRequestList";

vi.mock("../capability/provider-ui", () => ({
  getProviderDisplayName: () => "Claude Code",
  getProviderIcon: () => "/mock-provider-icon.png"
}));

describe("PermissionRequestList", () => {
  it("非 user_input 请求只要选了附加选项，也会把答案一起提交", async () => {
    const onReply = vi.fn().mockResolvedValue(undefined);

    render(
      <PermissionRequestList
        requests={[
          {
            id: "permission-1",
            sessionId: "session-1",
            provider: "claude-code",
            providerSessionId: "provider-session-1",
            requestKey: "request-1",
            kind: "command",
            status: "pending",
            title: "Claude 请求执行命令",
            summary: "读取文件",
            detail: null,
            reason: null,
            toolName: "Read",
            command: null,
            cwd: "/tmp/workspace",
            paths: ["/tmp/workspace/references/cli-workflow.md"],
            permissionProfile: null,
            questions: [
              {
                id: "scope",
                header: "授权范围",
                question: "这次批准要持续多久？",
                allowOther: false,
                secret: false,
                options: [
                  {
                    label: "本次会话不再读取",
                    description: "同路径读取在本会话内默认放行"
                  }
                ]
              }
            ],
            actions: [
              {
                value: "allow",
                label: "允许",
                tone: "primary",
                description: "允许本次读取"
              }
            ],
            rawPayload: null,
            createdAt: "2026-04-18T09:00:00.000Z",
            updatedAt: "2026-04-18T09:00:00.000Z",
            resolvedAt: null
          }
        ]}
        replyingRequestId={null}
        onReply={onReply}
      />
    );

    fireEvent.click(screen.getByRole("radio"));
    fireEvent.click(screen.getByRole("button", { name: "允许" }));

    await waitFor(() => {
      expect(onReply).toHaveBeenCalledWith("permission-1", {
        action: "allow",
        answers: {
          scope: ["本次会话不再读取"]
        }
      });
    });
  });

  it("Claude 问题请求可以提交选项答案", async () => {
    const onReply = vi.fn().mockResolvedValue(undefined);

    render(
      <PermissionRequestList
        requests={[
          {
            id: "permission-ask-1",
            sessionId: "session-1",
            provider: "claude-code",
            providerSessionId: "provider-session-1",
            requestKey: "toolu-ask-1",
            kind: "user_input",
            status: "pending",
            title: "Claude 需要你选择问题类型",
            summary: "请选择任务类型",
            detail: null,
            reason: null,
            toolName: "AskUserQuestion",
            command: null,
            cwd: "/tmp/workspace",
            paths: [],
            permissionProfile: null,
            questions: [
              {
                id: "intent",
                header: "意图",
                question: "你想做哪类工作？",
                allowOther: true,
                secret: false,
                multiSelect: false,
                options: [
                  {
                    label: "开发任务",
                    description: "有具体功能要实现"
                  },
                  {
                    label: "演示",
                    description: "只看功能演示"
                  }
                ]
              }
            ],
            actions: [
              {
                value: "submit",
                label: "提交选择",
                tone: "primary",
                description: "把选择结果交给 Claude"
              }
            ],
            rawPayload: null,
            createdAt: "2026-06-13T09:00:00.000Z",
            updatedAt: "2026-06-13T09:00:00.000Z",
            resolvedAt: null
          }
        ]}
        replyingRequestId={null}
        onReply={onReply}
      />
    );

    const submitButton = screen.getByRole("button", { name: "提交选择" });
    expect(submitButton).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: /开发任务/ }));
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(onReply).toHaveBeenCalledWith("permission-ask-1", {
        action: "submit",
        answers: {
          intent: ["开发任务"]
        }
      });
    });
  });

  it("Claude 问题请求可以提交其他答案", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn().mockResolvedValue(undefined);

    render(
      <PermissionRequestList
        requests={[
          {
            id: "permission-ask-2",
            sessionId: "session-1",
            provider: "claude-code",
            providerSessionId: "provider-session-1",
            requestKey: "toolu-ask-2",
            kind: "user_input",
            status: "pending",
            title: "Claude 需要你选择问题类型",
            summary: "请选择任务类型",
            detail: null,
            reason: null,
            toolName: "AskUserQuestion",
            command: null,
            cwd: "/tmp/workspace",
            paths: [],
            permissionProfile: null,
            questions: [
              {
                id: "intent",
                header: "意图",
                question: "你想做哪类工作？",
                allowOther: true,
                secret: false,
                multiSelect: false,
                options: [
                  {
                    label: "开发任务",
                    description: null
                  }
                ]
              }
            ],
            actions: [
              {
                value: "submit",
                label: "提交选择",
                tone: "primary",
                description: "把选择结果交给 Claude"
              }
            ],
            rawPayload: null,
            createdAt: "2026-06-13T09:00:00.000Z",
            updatedAt: "2026-06-13T09:00:00.000Z",
            resolvedAt: null
          }
        ]}
        replyingRequestId={null}
        onReply={onReply}
      />
    );

    await user.type(screen.getByPlaceholderText("Type your answer"), "我想先看演示");
    fireEvent.click(screen.getByRole("button", { name: "提交选择" }));

    await waitFor(() => {
      expect(onReply).toHaveBeenCalledWith("permission-ask-2", {
        action: "submit",
        answers: {
          intent: ["我想先看演示"]
        }
      });
    });
  });

  it("plan 审批摘要会按 markdown 渲染", () => {
    render(
      <PermissionRequestList
        requests={[
          {
            id: "permission-plan-1",
            sessionId: "session-1",
            provider: "claude-code",
            providerSessionId: "provider-session-1",
            requestKey: "exit-plan-1",
            kind: "plan_approval",
            status: "pending",
            title: "Claude 请求确认执行计划",
            summary: "## 本轮计划\n\n- 先确认方案\n- 再继续执行",
            detail: null,
            reason: null,
            toolName: "ExitPlanMode",
            command: null,
            cwd: "/tmp/workspace",
            paths: [],
            permissionProfile: null,
            questions: [],
            actions: [
              {
                value: "allow",
                label: "批准计划",
                tone: "primary",
                description: "允许继续执行"
              }
            ],
            rawPayload: null,
            createdAt: "2026-06-14T09:00:00.000Z",
            updatedAt: "2026-06-14T09:00:00.000Z",
            resolvedAt: null
          }
        ]}
        replyingRequestId={null}
        onReply={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "本轮计划" })).toBeInTheDocument();
    expect(screen.getByText("先确认方案")).toBeInTheDocument();
    expect(screen.getByText("再继续执行")).toBeInTheDocument();
  });

  it("顶部审批区不再显示说明文案，并且 plan 摘要容器可滚动", () => {
    render(
      <PermissionRequestList
        requests={[
          {
            id: "permission-plan-scroll-1",
            sessionId: "session-1",
            provider: "claude-code",
            providerSessionId: "provider-session-1",
            requestKey: "exit-plan-scroll-1",
            kind: "plan_approval",
            status: "pending",
            title: "Claude 请求确认执行计划",
            summary: Array.from({ length: 24 }, (_, index) => `- 第 ${index + 1} 段计划`).join("\n"),
            detail: null,
            reason: null,
            toolName: "ExitPlanMode",
            command: null,
            cwd: "/tmp/workspace",
            paths: [],
            permissionProfile: null,
            questions: [],
            actions: [
              {
                value: "allow",
                label: "批准计划",
                tone: "primary",
                description: "允许继续执行"
              }
            ],
            rawPayload: null,
            createdAt: "2026-06-14T09:00:00.000Z",
            updatedAt: "2026-06-14T09:00:00.000Z",
            resolvedAt: null
          }
        ]}
        replyingRequestId={null}
        onReply={vi.fn()}
      />
    );

    expect(screen.queryByText("这里把供应商原生的权限申请统一收口，不再让你面对三套不同的确认框。")).not.toBeInTheDocument();
    const planScroll = document.querySelector(".permission-request-plan-summary-scroll");
    expect(planScroll).not.toBeNull();
    expect(planScroll?.classList.contains("permission-request-plan-summary-scroll")).toBe(true);
  });

  it("长问题表单会把问题区做成可滚动容器，避免整页卡死", () => {
    render(
      <PermissionRequestList
        requests={[
          {
            id: "permission-ask-long-1",
            sessionId: "session-1",
            provider: "claude-code",
            providerSessionId: "provider-session-1",
            requestKey: "toolu-ask-long-1",
            kind: "user_input",
            status: "pending",
            title: "Claude 需要你回答问题",
            summary: "请把偏好补充完整",
            detail: null,
            reason: null,
            toolName: "AskUserQuestion",
            command: null,
            cwd: "/tmp/workspace",
            paths: [],
            permissionProfile: null,
            questions: Array.from({ length: 8 }, (_, index) => ({
              id: `question-${index + 1}`,
              header: `问题 ${index + 1}`,
              question: `第 ${index + 1} 个问题要怎么选？`,
              allowOther: false,
              secret: false,
              multiSelect: false,
              options: [
                {
                  label: `选项 A-${index + 1}`,
                  description: "一段比较长的说明，用来把整张表单撑高，验证问题区本身可以滚动。"
                },
                {
                  label: `选项 B-${index + 1}`,
                  description: "另一段比较长的说明，用来把整张表单撑高，验证问题区本身可以滚动。"
                }
              ]
            })),
            actions: [
              {
                value: "submit",
                label: "提交选择",
                tone: "primary",
                description: "把选择结果交给 Claude"
              }
            ],
            rawPayload: null,
            createdAt: "2026-06-14T09:00:00.000Z",
            updatedAt: "2026-06-14T09:00:00.000Z",
            resolvedAt: null
          }
        ]}
        replyingRequestId={null}
        onReply={vi.fn()}
      />
    );

    const questionBlock = document.querySelector(".permission-request-scrollable-questions");
    expect(questionBlock).not.toBeNull();
    expect(questionBlock?.classList.contains("permission-request-scrollable-questions")).toBe(true);
  });

  it("问题审批和计划审批会带不同的视觉主题 class", () => {
    render(
      <PermissionRequestList
        requests={[
          {
            id: "permission-theme-ask-1",
            sessionId: "session-1",
            provider: "claude-code",
            providerSessionId: "provider-session-1",
            requestKey: "ask-1",
            kind: "user_input",
            status: "pending",
            title: "Claude 需要你回答问题",
            summary: "请选择任务类型",
            detail: null,
            reason: null,
            toolName: "AskUserQuestion",
            command: null,
            cwd: "/tmp/workspace",
            paths: [],
            permissionProfile: null,
            questions: [],
            actions: [
              {
                value: "submit",
                label: "提交选择",
                tone: "primary",
                description: "把选择结果交给 Claude"
              }
            ],
            rawPayload: null,
            createdAt: "2026-06-15T09:00:00.000Z",
            updatedAt: "2026-06-15T09:00:00.000Z",
            resolvedAt: null
          },
          {
            id: "permission-theme-plan-1",
            sessionId: "session-1",
            provider: "claude-code",
            providerSessionId: "provider-session-1",
            requestKey: "plan-1",
            kind: "plan_approval",
            status: "pending",
            title: "Claude 请求确认执行计划",
            summary: "## 本轮计划",
            detail: null,
            reason: null,
            toolName: "ExitPlanMode",
            command: null,
            cwd: "/tmp/workspace",
            paths: [],
            permissionProfile: null,
            questions: [],
            actions: [
              {
                value: "allow",
                label: "批准计划",
                tone: "primary",
                description: "允许继续执行"
              }
            ],
            rawPayload: null,
            createdAt: "2026-06-15T09:00:00.000Z",
            updatedAt: "2026-06-15T09:00:00.000Z",
            resolvedAt: null
          }
        ]}
        replyingRequestId={null}
        onReply={vi.fn()}
      />
    );

    expect(document.querySelector(".permission-request-card-user_input")).not.toBeNull();
    expect(document.querySelector(".permission-request-card-plan_approval")).not.toBeNull();
  });
});
