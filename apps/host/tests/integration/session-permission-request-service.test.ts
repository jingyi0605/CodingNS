import { describe, expect, it } from "vitest";
import {
  resolveClaudePreToolUseHookMatchers
} from "@codingns/session-sync-core/runtime/claude-runtime";

import {
  buildClaudeAskUserQuestionAnswers,
  buildDeepSeekHarnessApprovalResponse,
  buildDeepSeekHarnessQuestionResponse,
  normalizeClaudeElicitationRequest,
  normalizeClaudePreToolUseRequest,
  normalizeCodexServerRequest,
  normalizeOpenCodePermissionRequest,
  resolveClaudeBlockingRequestTimeoutMs,
  resolveClaudeSafeShellAutoApprovalReason
} from "../../src/modules/sessions/session-permission-request-service.js";

describe("session-permission-request-service normalizers", () => {
  it("Claude 完整权限模式下仍然注入 AskUserQuestion hook", () => {
    expect(resolveClaudePreToolUseHookMatchers("bypassPermissions")).toEqual([
      "AskUserQuestion",
      "ExitPlanMode"
    ]);
  });

  it("Claude 非完整权限模式下继续注入权限申请和问题 hook", () => {
    expect(resolveClaudePreToolUseHookMatchers("default")).toEqual([
      "Bash",
      "Edit",
      "Write",
      "MultiEdit",
      "NotebookEdit",
      "AskUserQuestion",
      "ExitPlanMode"
    ]);
  });

  it("会把 Claude ExitPlanMode 映射成独立的计划审批请求", () => {
    const request = normalizeClaudePreToolUseRequest({
      provider: "claude-code",
      sessionId: "session-plan-1",
      providerSessionId: "claude-session-plan-1",
      createdAt: "2026-06-13T10:00:00.000Z",
      payload: {
        hook_event_name: "PreToolUse",
        session_id: "claude-session-plan-1",
        cwd: "/tmp/workspace",
        tool_name: "ExitPlanMode",
        tool_input: {
          allowedPrompts: [
            {
              tool: "Bash",
              prompt: "run tests"
            }
          ]
        }
      }
    });

    expect(request.kind).toBe("plan_approval");
    expect(request.toolName).toBe("ExitPlanMode");
    expect(request.title).toBe("Claude 请求确认执行计划");
    expect(request.summary).toContain("run tests");
    expect(request.actions.map((action) => action.value)).toEqual([
      "allow",
      "deny"
    ]);
  });

  it("会把 Claude PreToolUse 的 Bash 请求映射成统一命令审批", () => {
    const request = normalizeClaudePreToolUseRequest({
      provider: "claude-code",
      sessionId: "session-1",
      providerSessionId: "claude-session-1",
      createdAt: "2026-03-30T10:00:00.000Z",
      payload: {
        hook_event_name: "PreToolUse",
        session_id: "claude-session-1",
        cwd: "/tmp/workspace",
        tool_name: "Bash",
        tool_input: {
          command: "rm -rf /tmp/build"
        }
      }
    });

    expect(request.provider).toBe("claude-code");
    expect(request.kind).toBe("command");
    expect(request.command).toBe("rm -rf /tmp/build");
    expect(request.actions.map((action) => action.value)).toEqual([
      "allow",
      "allow_session",
      "deny"
    ]);
  });

  it("会把 Claude PreToolUse 的 Read 请求映射成可做会话级默认允许的审批", () => {
    const request = normalizeClaudePreToolUseRequest({
      provider: "claude-code",
      sessionId: "session-1",
      providerSessionId: "claude-session-1",
      createdAt: "2026-03-30T10:00:00.000Z",
      payload: {
        hook_event_name: "PreToolUse",
        session_id: "claude-session-1",
        cwd: "/tmp/workspace",
        tool_name: "Read",
        tool_input: {
          file_path: "/tmp/workspace/references/cli-workflow.md"
        }
      }
    });

    expect(request.provider).toBe("claude-code");
    expect(request.kind).toBe("tool_call");
    expect(request.paths).toEqual(["/tmp/workspace/references/cli-workflow.md"]);
    expect(request.actions.map((action) => action.value)).toEqual([
      "allow",
      "allow_session",
      "deny"
    ]);
  });

  it("会把 Claude AskUserQuestion 映射成可提交选项的问题请求", () => {
    const request = normalizeClaudePreToolUseRequest({
      provider: "claude-code",
      sessionId: "session-ask-1",
      providerSessionId: "claude-session-ask-1",
      createdAt: "2026-06-13T10:00:00.000Z",
      payload: {
        hook_event_name: "PreToolUse",
        session_id: "claude-session-ask-1",
        cwd: "/tmp/workspace",
        tool_name: "AskUserQuestion",
        tool_input: {
          questions: [
            {
              id: "intent",
              header: "意图",
              question: "你想做哪类工作？",
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
          ]
        }
      }
    });

    expect(request.kind).toBe("user_input");
    expect(request.toolName).toBe("AskUserQuestion");
    expect(request.title).toBe("Claude 需要你回答问题");
    expect(request.actions.map((action) => action.value)).toEqual(["submit"]);
    expect(request.questions).toEqual([
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
    ]);
  });

  it("会把 Claude Elicitation 映射成可提交答案的问题请求", () => {
    const request = normalizeClaudeElicitationRequest({
      provider: "claude-code",
      sessionId: "session-elicitation-1",
      providerSessionId: "claude-session-elicitation-1",
      createdAt: "2026-06-13T10:00:00.000Z",
      payload: {
        hook_event_name: "Elicitation",
        session_id: "claude-session-elicitation-1",
        cwd: "/tmp/workspace",
        title: "需要确认环境",
        prompt: "请选择本轮要使用的环境",
        options: [
          {
            label: "开发环境",
            description: "继续本地调试"
          },
          {
            label: "测试环境",
            description: "改成联调验证"
          }
        ]
      }
    });

    expect(request.kind).toBe("user_input");
    expect(request.toolName).toBe("Elicitation");
    expect(request.title).toBe("需要确认环境");
    expect(request.summary).toBe("请选择本轮要使用的环境");
    expect(request.questions[0]).toMatchObject({
      id: "elicitation",
      header: "需要确认环境",
      question: "请选择本轮要使用的环境"
    });
    expect(request.actions.map((action) => action.value)).toEqual(["submit"]);
  });

  it("问题回答不设置超时，但计划审批和普通权限仍保留原有超时", () => {
    expect(resolveClaudeBlockingRequestTimeoutMs("user_input")).toBeNull();
    expect(resolveClaudeBlockingRequestTimeoutMs("plan_approval")).toBe(600_000);
    expect(resolveClaudeBlockingRequestTimeoutMs("command")).toBe(90_000);
  });

  it("DeepSeek Harness 问题回复符合 /api/respond 的批量答案协议", () => {
    expect(buildDeepSeekHarnessQuestionResponse(
      {
        providerSessionId: "harness-session-1",
        questions: [
          {
            id: "mode",
            header: "方式",
            question: "选择工作方式",
            allowOther: true,
            secret: false,
            multiSelect: false,
            options: [
              { label: "原型", description: null },
              { label: "设计", description: null }
            ]
          },
          {
            id: "targets",
            header: "目标",
            question: "选择目标",
            allowOther: false,
            secret: false,
            multiSelect: true,
            options: [
              { label: "代码", description: null },
              { label: "文档", description: null }
            ]
          }
        ]
      },
      {
        mode: ["其他方式"],
        targets: ["代码", "文档"]
      }
    )).toEqual({
      sessionId: "harness-session-1",
      answer: {
        answers: [
          { id: "mode", selected: [], custom: "其他方式" },
          { id: "targets", selected: ["代码", "文档"] }
        ]
      }
    });
  });

  it("DeepSeek Harness 审批回复携带会话和审批 ID", () => {
    expect(buildDeepSeekHarnessApprovalResponse({
      providerSessionId: "harness-session-2",
      approvalId: "approval-1"
    }, "allowed-once")).toEqual({
      sessionId: "harness-session-2",
      approvalId: "approval-1",
      outcome: "allowed-once"
    });
  });

  it("会按 Claude AskUserQuestion 协议把答案转成问题文本键", () => {
    const answers = buildClaudeAskUserQuestionAnswers(
      {
        language: ["Python"],
        features: ["测试", "重构"],
        ignored: ["不会透传"]
      },
      [
        {
          id: "language",
          header: "语言",
          question: "选语言",
          allowOther: true,
          secret: false,
          multiSelect: false,
          options: []
        },
        {
          id: "features",
          header: "功能",
          question: "选功能",
          allowOther: true,
          secret: false,
          multiSelect: true,
          options: []
        }
      ]
    );

    expect(answers).toEqual({
      "选语言": "Python",
      "选功能": "测试, 重构"
    });
  });

  it("会保留 Claude 兼容 provider 的原始 providerId", () => {
    const request = normalizeClaudePreToolUseRequest({
      provider: "legna-code",
      sessionId: "session-4",
      providerSessionId: "legna-session-1",
      createdAt: "2026-04-26T10:00:00.000Z",
      payload: {
        hook_event_name: "PreToolUse",
        session_id: "legna-session-1",
        cwd: "/tmp/workspace",
        tool_name: "Read",
        tool_input: {
          file_path: "/tmp/workspace/LEGNA.md"
        }
      }
    });

    expect(request.provider).toBe("legna-code");
    expect(request.paths).toEqual(["/tmp/workspace/LEGNA.md"]);
  });

  it("会把 OpenCode permission 对象映射成统一权限申请", () => {
    const request = normalizeOpenCodePermissionRequest({
      sessionId: "session-2",
      providerSessionId: "opencode-session-1",
      createdAt: "2026-03-30T10:00:00.000Z",
      permission: {
        id: "perm-1",
        sessionID: "opencode-session-1",
        title: "Allow writing generated files",
        metadata: {
          path: "/tmp/workspace/src/generated",
          fileSystem: {
            write: ["/tmp/workspace/src/generated"]
          },
          network: {
            enabled: true
          }
        }
      }
    });

    expect(request.provider).toBe("opencode");
    expect(request.kind).toBe("file_change");
    expect(request.paths).toContain("/tmp/workspace/src/generated");
    expect(request.actions.map((action) => action.value)).toEqual(["once", "always", "reject"]);
  });

  it("会把 Codex app-server 的 commandExecution 审批请求映射成统一模型", () => {
    const request = normalizeCodexServerRequest("session-3", "codex-thread-1", {
      id: 1,
      method: "item/commandExecution/requestApproval",
      params: {
        itemId: "item-command-1",
        threadId: "codex-thread-1",
        turnId: "turn-1",
        command: "git push origin main",
        cwd: "/tmp/workspace",
        reason: "Needs network access",
        networkApprovalContext: {
          host: "github.com",
          protocol: "https"
        },
        commandActions: [
          {
            type: "unknown",
            command: "git push origin main"
          }
        ]
      }
    });

    expect(request).not.toBeNull();
    expect(request?.provider).toBe("codex");
    expect(request?.kind).toBe("command");
    expect(request?.command).toBe("git push origin main");
    expect(request?.actions.map((action) => action.value)).toEqual([
      "accept",
      "acceptForSession",
      "decline",
      "cancel"
    ]);
  });

  it("会自动放行 Claude 助手会话里的安全只读 shell 命令", () => {
    expect(resolveClaudeSafeShellAutoApprovalReason("pwd")).toBe(
      "CodingNS 已自动放行助手会话里的安全只读命令"
    );
    expect(resolveClaudeSafeShellAutoApprovalReason("sed -n '1,20p' src/app.ts")).toBe(
      "CodingNS 已自动放行助手会话里的安全只读命令"
    );
    expect(resolveClaudeSafeShellAutoApprovalReason("git status --short")).toBe(
      "CodingNS 已自动放行助手会话里的安全只读命令"
    );
  });

  it("不会自动放行带副作用或带 shell 控制符的命令", () => {
    expect(resolveClaudeSafeShellAutoApprovalReason("sed -i 's/a/b/' src/app.ts")).toBeNull();
    expect(resolveClaudeSafeShellAutoApprovalReason("find . -delete")).toBeNull();
    expect(resolveClaudeSafeShellAutoApprovalReason("git branch -D feature/foo")).toBeNull();
    expect(resolveClaudeSafeShellAutoApprovalReason("pwd && ls")).toBeNull();
  });
});
