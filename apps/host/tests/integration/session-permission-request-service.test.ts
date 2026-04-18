import { describe, expect, it } from "vitest";

import {
  normalizeClaudePreToolUseRequest,
  normalizeCodexServerRequest,
  normalizeOpenCodePermissionRequest,
  resolveClaudeSafeShellAutoApprovalReason
} from "../../src/modules/sessions/session-permission-request-service.js";

describe("session-permission-request-service normalizers", () => {
  it("会把 Claude PreToolUse 的 Bash 请求映射成统一命令审批", () => {
    const request = normalizeClaudePreToolUseRequest({
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
