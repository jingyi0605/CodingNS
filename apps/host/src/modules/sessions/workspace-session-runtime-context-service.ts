import fs from "node:fs";
import path from "node:path";

import type { SessionBinding } from "../../types/domain.js";
import type { WorkspaceSessionAuthService } from "./workspace-session-auth-service.js";

const WORKSPACE_SESSION_ASSISTANT_FILE = "WORKSPACE_SESSION_ASSISTANT.md";

export class WorkspaceSessionRuntimeContextService {
  constructor(
    private readonly workspaceSessionAuthService: Pick<
      WorkspaceSessionAuthService,
      "ensureWorkspaceCredential" | "getCredentialFilePath"
    >
  ) {}

  syncRuntimeContext(input: {
    sessionId: string;
    userId: string;
    workspaceId: string;
    projectId?: string | null;
    provider: SessionBinding["provider"];
    runtimeHomeDir: string;
  }): void {
    const credential = this.workspaceSessionAuthService.ensureWorkspaceCredential({
      runtimeHomeDir: input.runtimeHomeDir,
      userId: input.userId,
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      sessionId: input.sessionId
    });
    const authFilePath = this.workspaceSessionAuthService.getCredentialFilePath(input.runtimeHomeDir);
    const instructionPath = path.join(
      input.runtimeHomeDir,
      input.provider === "claude-code" ? "CLAUDE.md" : WORKSPACE_SESSION_ASSISTANT_FILE
    );

    fs.mkdirSync(input.runtimeHomeDir, { recursive: true });
    fs.writeFileSync(instructionPath, `${buildWorkspaceAssistantInstructions({
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      authFilePath
    })}\n`, "utf8");

    if (input.provider === "codex") {
      const configPath = path.join(input.runtimeHomeDir, "config.toml");
      if (fs.existsSync(configPath) && fs.statSync(configPath).isFile()) {
        const current = fs.readFileSync(configPath, "utf8");
        const lines = current
          .split(/\r?\n/)
          .filter((line) => !line.trim().startsWith("model_instructions_file"));
        lines.push(`model_instructions_file = ${JSON.stringify(instructionPath)}`);
        fs.writeFileSync(configPath, `${lines.filter((line) => line.length > 0).join("\n")}\n`, "utf8");
      }
    }

    // 这里保留一份显式可读认证信息，供 CLI 自动发现或运行时环境变量指向。
    fs.writeFileSync(authFilePath, `${JSON.stringify(credential, null, 2)}\n`, "utf8");
  }
}

function buildWorkspaceAssistantInstructions(input: {
  workspaceId: string;
  projectId: string | null;
  authFilePath: string;
}): string {
  return `# 工作区会话助手规则

- 当前会话是工作区普通会话，不是 Butler 控制面，也不是全局管理员。
- 当前受控范围固定为 workspaceId=\`${input.workspaceId}\`${input.projectId ? `，projectId=\`${input.projectId}\`` : ""}。
- 助手正式能力必须优先走 \`codingns assistant ...\` 或对应 \`/api/assistant/*\` 入口，不要自己拼私有 HTTP。
- 文档操作优先走 \`assistant office.document.*\`。
- 浏览器操作优先走 \`assistant office.browser.*\`。
- 运维任务优先走 \`assistant office.ops.*\`。
- 新建终端优先走 \`assistant terminals create\`。
- 写终端、执行运维、merge 工作树前，必须先征得用户确认。
- 不要尝试跨工作区、跨项目，或调用当前未开放能力。
- 当前工作区会话 scoped 认证文件：\`${input.authFilePath}\`。
`;
}
