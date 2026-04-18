import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
