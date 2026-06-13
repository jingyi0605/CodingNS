import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveBuiltinSkillDirectory } from "../skills/builtin-skill-service.js";
import { CODINGNS_OPENCLI_BLOCK_BROWSER_DEPENDENT_COMMANDS_ENV } from "../opencli/opencli-runtime-guard.js";
import type { SessionBinding } from "../../types/domain.js";
import type { WorkspaceSessionAuthService } from "./workspace-session-auth-service.js";
import {
  buildWorkspaceOfficeMcpCommandArgs,
  CODEX_WORKSPACE_OFFICE_MCP_ENABLE_ENV,
  CODINGNS_OFFICE_MCP_AUTH_FILE_ENV,
  WORKSPACE_OFFICE_MCP_NAME
} from "./workspace-office-mcp-config.js";

const WORKSPACE_SESSION_ASSISTANT_FILE = "WORKSPACE_SESSION_ASSISTANT.md";
const WORKSPACE_SESSION_SKILL_DIRECTORY = "codingns-workspace-session";
const WORKSPACE_SESSION_COMPOSED_INSTRUCTION_FILE = "WORKSPACE_SESSION_COMPOSED.md";
const WORKSPACE_SESSION_ADDITIONAL_RULES_SECTION = `# 工作区会话附加规则\n\n下面这段规则由 Host 在工作区会话启动时显式注入，只对当前工作区会话生效。\n\n`;
const WORKSPACE_SESSION_TEMP_RULES_SECTION = `# 工作区会话临时规则\n\n下面这段规则只针对当前这次用户消息生效，用来约束命中的任务类型，不改项目里的 AGENTS.md。\n\n`;

interface WorkspaceSessionRuntimeContextServiceOptions {
  codexHomeDir?: string;
  claudeCodeHomeDir?: string;
  runtimeStorageRootDir?: string;
}

export class WorkspaceSessionRuntimeContextService {
  constructor(
    private readonly workspaceSessionAuthService: Pick<
      WorkspaceSessionAuthService,
      "ensureWorkspaceCredential" | "getCredentialFilePath"
    >,
    private readonly options: WorkspaceSessionRuntimeContextServiceOptions = {}
  ) {}

  syncRuntimeContext(input: {
    sessionId: string;
    userId: string;
    workspaceId: string;
    projectId?: string | null;
    provider: SessionBinding["provider"];
    runtimeHomeDir: string;
  }): {
    authFilePath: string;
    instructionFilePath: string;
    runtimeHomeDir: string;
    runtimeEnv: Record<string, string>;
  } {
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
    syncProviderRuntimeBase(input.runtimeHomeDir, input.provider, this.options);
    syncWorkspaceSessionSkill(input.runtimeHomeDir);
    fs.writeFileSync(instructionPath, `${buildWorkspaceAssistantInstructions({
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      authFilePath
    })}\n`, "utf8");

    // 这里保留一份显式可读认证信息，供 CLI 自动发现或运行时环境变量指向。
    fs.writeFileSync(authFilePath, `${JSON.stringify(credential, null, 2)}\n`, "utf8");
    configureWorkspaceOfficeMcpRuntime(input.runtimeHomeDir, {
      provider: input.provider,
      authFilePath
    });
    configureWorkspaceInstructionRuntime(input.runtimeHomeDir, {
      provider: input.provider,
      instructionFilePath: instructionPath
    });
    return {
      authFilePath,
      instructionFilePath: instructionPath,
      runtimeHomeDir: input.runtimeHomeDir,
      runtimeEnv: buildWorkspaceSessionRuntimeEnv(input.provider, authFilePath, instructionPath)
    };
  }

  syncRuntimeOfficeMcpContext(input: {
    sessionId: string;
    userId: string;
    workspaceId: string;
    projectId?: string | null;
    provider: SessionBinding["provider"];
    runtimeHomeDir: string;
  }): {
    authFilePath: string;
    runtimeHomeDir: string;
  } {
    const credential = this.workspaceSessionAuthService.ensureWorkspaceCredential({
      runtimeHomeDir: input.runtimeHomeDir,
      userId: input.userId,
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      sessionId: input.sessionId
    });
    const authFilePath = this.workspaceSessionAuthService.getCredentialFilePath(input.runtimeHomeDir);

    fs.mkdirSync(input.runtimeHomeDir, { recursive: true });

    // 这里只保留工作区 scoped auth 文件本身。
    // Codex 的 office MCP 现在改成 helper 启动 `codex app-server` 时临时注入 `-c mcp_servers...`，
    // 不再写入真实 home 的 config.toml，也不改 transcript/home 落盘语义。
    fs.writeFileSync(authFilePath, `${JSON.stringify(credential, null, 2)}\n`, "utf8");
    syncWorkspaceSessionSkill(input.runtimeHomeDir);
    configureWorkspaceOfficeMcpRuntime(input.runtimeHomeDir, {
      provider: input.provider,
      authFilePath
    });

    return {
      authFilePath,
      runtimeHomeDir: input.runtimeHomeDir
    };
  }

  prepareWorkspaceInstructionBundle(input: {
    sessionId: string;
    userId: string;
    workspaceId: string;
    workspacePath: string;
    projectId?: string | null;
    provider: SessionBinding["provider"];
    instructionOverlay?: string | null;
  }): {
    authFilePath: string;
    instructionFilePath: string;
    runtimeHomeDir: string;
    runtimeEnv: Record<string, string>;
  } {
    const runtimeHomeDir = resolveWorkspaceSessionRuntimeArtifactDir({
      workspacePath: input.workspacePath,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      runtimeStorageRootDir: this.options.runtimeStorageRootDir
    });
    const credential = this.workspaceSessionAuthService.ensureWorkspaceCredential({
      runtimeHomeDir,
      userId: input.userId,
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      sessionId: input.sessionId
    });
    const authFilePath = this.workspaceSessionAuthService.getCredentialFilePath(runtimeHomeDir);

    fs.mkdirSync(runtimeHomeDir, { recursive: true });
    syncProviderRuntimeBase(runtimeHomeDir, input.provider, this.options);
    syncWorkspaceSessionSkill(runtimeHomeDir);

    const baseInstruction = `${buildWorkspaceAssistantInstructions({
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      authFilePath
    })}\n`;
    const workspaceAgentsPath = path.join(input.workspacePath, "AGENTS.md");
    const composedInstructionPath = path.join(runtimeHomeDir, WORKSPACE_SESSION_COMPOSED_INSTRUCTION_FILE);
    const composedInstruction = composeWorkspaceInstructionDocument({
      workspaceAgentsPath,
      workspaceInstruction: baseInstruction,
      instructionOverlay: input.instructionOverlay ?? null
    });

    fs.writeFileSync(authFilePath, `${JSON.stringify(credential, null, 2)}\n`, "utf8");
    fs.writeFileSync(composedInstructionPath, composedInstruction, "utf8");
    configureWorkspaceOfficeMcpRuntime(runtimeHomeDir, {
      provider: input.provider,
      authFilePath
    });
    configureWorkspaceInstructionRuntime(runtimeHomeDir, {
      provider: input.provider,
      instructionFilePath: composedInstructionPath
    });

    return {
      authFilePath,
      instructionFilePath: composedInstructionPath,
      runtimeHomeDir,
      runtimeEnv: buildWorkspaceSessionRuntimeEnv(input.provider, authFilePath, composedInstructionPath)
    };
  }

  refreshWorkspaceInstructionBundle(input: {
    workspacePath: string;
    runtimeHomeDir: string;
  }): { instructionFilePath: string; refreshed: boolean } {
    const workspaceAgentsPath = path.join(input.workspacePath, "AGENTS.md");
    const instructionFilePath = path.join(input.runtimeHomeDir, WORKSPACE_SESSION_COMPOSED_INSTRUCTION_FILE);

    if (!fs.existsSync(instructionFilePath) || !fs.statSync(instructionFilePath).isFile()) {
      return {
        instructionFilePath,
        refreshed: false
      };
    }

    const currentContent = fs.readFileSync(instructionFilePath, "utf8");
    const nextContent = composeWorkspaceInstructionDocument({
      workspaceAgentsPath,
      workspaceInstruction: extractWorkspaceInstructionBody(currentContent),
      instructionOverlay: extractWorkspaceInstructionOverlay(currentContent)
    });

    if (currentContent === nextContent) {
      return {
        instructionFilePath,
        refreshed: false
      };
    }

    fs.writeFileSync(instructionFilePath, nextContent, "utf8");
    return {
      instructionFilePath,
      refreshed: true
    };
  }

  refreshWorkspaceInstructionBundlesForWorkspace(input: {
    workspaceId: string;
    workspacePath: string;
  }): {
    refreshedCount: number;
    scannedRuntimeHomeDirs: string[];
    updatedInstructionFiles: string[];
  } {
    const runtimeHomeDirs = collectWorkspaceSessionRuntimeHomeDirs({
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
      runtimeStorageRootDir: this.options.runtimeStorageRootDir
    });
    const scannedRuntimeHomeDirs: string[] = [];
    const updatedInstructionFiles: string[] = [];

    for (const runtimeHomeDir of runtimeHomeDirs) {
      scannedRuntimeHomeDirs.push(runtimeHomeDir);
      const result = this.refreshWorkspaceInstructionBundle({
        workspacePath: input.workspacePath,
        runtimeHomeDir
      });

      if (result.refreshed) {
        updatedInstructionFiles.push(result.instructionFilePath);
      }
    }

    return {
      refreshedCount: updatedInstructionFiles.length,
      scannedRuntimeHomeDirs,
      updatedInstructionFiles
    };
  }
}

function resolveWorkspaceSessionRuntimeArtifactDir(input: {
  workspacePath: string;
  workspaceId: string;
  sessionId: string;
  runtimeStorageRootDir?: string;
}): string {
  const globalRuntimeRootDir = input.runtimeStorageRootDir?.trim() ?? "";

  if (globalRuntimeRootDir) {
    return path.join(globalRuntimeRootDir, "workspace-session-runtime", input.workspaceId, input.sessionId);
  }

  return path.join(input.workspacePath, ".codingns", "workspace-session-runtime", input.sessionId);
}

function syncWorkspaceSessionSkill(runtimeHomeDir: string): void {
  const sourceDir = resolveBuiltinSkillDirectory(WORKSPACE_SESSION_SKILL_DIRECTORY);
  const targetSkillsDir = path.join(runtimeHomeDir, "skills");
  const targetDir = path.join(targetSkillsDir, WORKSPACE_SESSION_SKILL_DIRECTORY);

  fs.mkdirSync(targetSkillsDir, { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function syncProviderRuntimeBase(
  runtimeHomeDir: string,
  provider: SessionBinding["provider"],
  options: WorkspaceSessionRuntimeContextServiceOptions
): void {
  switch (provider) {
    case "codex":
      syncCodexRuntimeBase(runtimeHomeDir, options.codexHomeDir);
      return;
    case "claude-code":
      syncClaudeRuntimeBase(runtimeHomeDir, options.claudeCodeHomeDir);
      return;
    default:
      return;
  }
}

function syncCodexRuntimeBase(runtimeHomeDir: string, codexHomeDir?: string): void {
  const sourceHomeDir = codexHomeDir?.trim() ?? "";

  if (!sourceHomeDir || path.resolve(sourceHomeDir) === path.resolve(runtimeHomeDir)) {
    return;
  }

  syncOptionalFile(path.join(sourceHomeDir, "auth.json"), path.join(runtimeHomeDir, "auth.json"));
  syncOptionalDirectory(path.join(sourceHomeDir, "skills"), path.join(runtimeHomeDir, "skills"));

  const sourceConfigPath = path.join(sourceHomeDir, "config.toml");

  if (fs.existsSync(sourceConfigPath) && fs.statSync(sourceConfigPath).isFile()) {
    const targetConfigPath = path.join(runtimeHomeDir, "config.toml");

    if (!fs.existsSync(targetConfigPath)) {
      fs.copyFileSync(sourceConfigPath, targetConfigPath);
    }
  }
}

function syncClaudeRuntimeBase(runtimeHomeDir: string, claudeCodeHomeDir?: string): void {
  const sourceHomeDir = claudeCodeHomeDir?.trim() ?? "";

  if (!sourceHomeDir || path.resolve(sourceHomeDir) === path.resolve(runtimeHomeDir)) {
    return;
  }

  syncOptionalFile(path.join(sourceHomeDir, "config.json"), path.join(runtimeHomeDir, "config.json"));
  syncOptionalFile(path.join(sourceHomeDir, "project-config.json"), path.join(runtimeHomeDir, "project-config.json"));
  syncOptionalFile(path.join(sourceHomeDir, "settings.json"), path.join(runtimeHomeDir, "settings.json"));
  syncOptionalFile(path.join(sourceHomeDir, "settings.local.json"), path.join(runtimeHomeDir, "settings.local.json"));
  syncOptionalDirectory(path.join(sourceHomeDir, "plugins"), path.join(runtimeHomeDir, "plugins"));
  syncOptionalDirectory(path.join(sourceHomeDir, "skills"), path.join(runtimeHomeDir, "skills"));
}

function configureWorkspaceInstructionRuntime(
  runtimeHomeDir: string,
  input: {
    provider: SessionBinding["provider"];
    instructionFilePath: string;
  }
): void {
  if (input.provider === "codex") {
    const configPath = path.join(runtimeHomeDir, "config.toml");

    if (fs.existsSync(configPath) && fs.statSync(configPath).isFile()) {
      const current = fs.readFileSync(configPath, "utf8");
      const lines = current
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("model_instructions_file"));
      lines.push(`model_instructions_file = ${JSON.stringify(input.instructionFilePath)}`);
      fs.writeFileSync(configPath, `${lines.filter((line) => line.length > 0).join("\n")}\n`, "utf8");
    }
  }
}

function syncOptionalFile(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function syncOptionalDirectory(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

function configureWorkspaceOfficeMcpRuntime(
  runtimeHomeDir: string,
  input: {
    provider: SessionBinding["provider"];
    authFilePath: string;
  }
): void {
  switch (input.provider) {
    case "codex":
      return;
    case "claude-code":
      upsertClaudeMcpConfig(runtimeHomeDir, input.authFilePath);
      return;
    case "opencode":
      upsertOpenCodeMcpConfig(runtimeHomeDir, input.authFilePath);
      return;
    default:
      return;
  }
}

function upsertClaudeMcpConfig(runtimeHomeDir: string, authFilePath: string): void {
  const configPath = path.join(runtimeHomeDir, ".claude.json");
  const parsed = readJsonObject(configPath);
  const mcpCommandArgs = buildWorkspaceOfficeMcpCommandArgs(authFilePath);

  // 读取用户全局 ~/.claude.json 中的 mcpServers，合并到会话级配置中。
  // 这样用户在原生 Claude Code CLI 中注册的 MCP 服务器（如 zai-mcp-server）
  // 也能在工作区会话中自动可用，不需要手动重复配置。
  const globalConfigPath = path.join(os.homedir(), ".claude.json");
  const globalParsed = readJsonObject(globalConfigPath);
  const globalMcpServers = isPlainObject(globalParsed.mcpServers) ? globalParsed.mcpServers as Record<string, unknown> : {};
  // 排除 codingns-workspace-office，避免和会话级注入冲突
  const { [WORKSPACE_OFFICE_MCP_NAME]: _, ...safeGlobalMcpServers } = globalMcpServers;

  const next = {
    ...parsed,
    mcpServers: {
      ...safeGlobalMcpServers,
      ...(isPlainObject(parsed.mcpServers) ? parsed.mcpServers : {}),
      [WORKSPACE_OFFICE_MCP_NAME]: {
        type: "stdio",
        command: process.execPath,
        args: mcpCommandArgs,
        env: {
          [CODINGNS_OFFICE_MCP_AUTH_FILE_ENV]: authFilePath
        }
      }
    }
  };
  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function upsertOpenCodeMcpConfig(runtimeHomeDir: string, authFilePath: string): void {
  const configPath = path.join(runtimeHomeDir, "opencode.json");
  const parsed = readJsonObject(configPath);
  const mcpCommandArgs = buildWorkspaceOfficeMcpCommandArgs(authFilePath);
  const next = {
    ...parsed,
    mcp: {
      ...(isPlainObject(parsed.mcp) ? parsed.mcp : {}),
      [WORKSPACE_OFFICE_MCP_NAME]: {
        type: "local",
        enabled: true,
        command: [
          process.execPath,
          ...mcpCommandArgs
        ],
        environment: {
          [CODINGNS_OFFICE_MCP_AUTH_FILE_ENV]: authFilePath
        }
      }
    }
  };
  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
- 当前工作区会话已经暴露正式浏览器入口命令：\`codingns assistant office browser-profile-list\`、\`codingns assistant office browser-profile-create\`、\`codingns assistant office browser-task-create\`、\`codingns assistant office browser-task-get\`。
- 只要任务属于打开网页、登录网站、抓取页面、读取 DOM、截图、提交表单、下载文件这一类真实网页操作，默认先用 \`assistant office.browser.task.create\`，不要先落到 Codex 自带 Browser。
- 如果当前会话同时还能看到 \`$codingns-opencli\`，不要被它里面的站点命令带偏：公开页面、公开榜单、公开帖子、公开趋势数据才考虑它；登录态、验证码、订单、购物车、个人账户、后台页面、表单提交、下载文件、点击页面控件、复用人工已登录 Chrome/Edge 这类任务必须走 \`office.browser.*\`。
- 就算 \`codingns-opencli\` 里存在 \`taobao/*\`、\`jd/*\` 这类 browser-dependent 命令，也不能把它们当成工作区真实站点任务的默认入口。
- 涉及登录、验证码、二次确认弹窗、复杂前端站点、必须复用现有 Chrome/Edge 登录态这几类任务时，创建浏览器任务优先显式传 \`executionBackend=opencli_bridge\`，不要继续默认无头浏览器。
- 当 \`executionBackend=opencli_bridge\` 时，\`browser-task-create\` 可以不传 \`profileId\`；这条链路会直接走无感浏览器桥接，不再依赖 Profile。
- 只有任务本身明显适合无头执行，或者用户明确要求无头链路时，才继续使用默认 \`playwright\`。
- \`browser-task-create --input-json\` 必须传 JSON 对象，不要猜私有 body。最小模板直接照抄：\`{"startUrl":"https://example.invalid","actions":[{"type":"read_dom"}]}\`。
- 浏览器动作类型当前只支持：\`goto\`、\`click\`、\`fill\`、\`press\`、\`select\`、\`upload\`、\`download\`、\`wait\`、\`read_dom\`、\`extract_text\`、\`screenshot\`。
- 常见模板：打开页面读 DOM 用 \`{"startUrl":"https://target.example","actions":[{"type":"read_dom"}]}\`；打开页面截图用 \`{"startUrl":"https://target.example","actions":[{"type":"screenshot","fullPage":true}]}\`；等待后再读用 \`{"startUrl":"https://target.example","actions":[{"type":"wait","timeoutMs":3000},{"type":"read_dom"}]}\`。
- 不要回答“当前环境没有浏览器能力”或“没有暴露浏览器能力”；对真实站点任务，先查上面这组 \`codingns assistant office ...\` 命令的 \`--help\` 或直接调用它们。
- 只有本地预览、开发调试 \`localhost\` / \`127.0.0.1\` / \`::1\`，或用户明确要求当前 in-app browser 时，才优先使用 Codex 自带 Browser。
- 真实浏览器任务的最小顺序是：优先直接用 \`assistant office.browser.task.create\` 并显式传 \`executionBackend=opencli_bridge\`；只有用户明确要求无头 \`playwright\`，或者要手工管理独立浏览器资料目录时，再先查/建 Profile。
- 遇到真实站点浏览器任务，先查 \`browser-task-create --help\` 或工作区专用 skill 里的模板，不要退回去翻源码、编译产物或自己拼接口路径。
- 运维任务优先走 \`assistant office.ops.*\`。
- 新建终端优先走 \`assistant terminals create\`。
- 默认可直接执行只读型终端/浏览器操作；仅在会产生写入、删除、提交、支付、发布、merge、修改系统状态的操作前征得用户确认。
- 不要尝试跨工作区、跨项目，或调用当前未开放能力。
- 当前工作区会话 scoped 认证文件：\`${input.authFilePath}\`。
`;
}

function composeWorkspaceInstructionDocument(input: {
  workspaceAgentsPath: string;
  workspaceInstruction: string;
  instructionOverlay?: string | null;
}): string {
  const sections: string[] = [];

  if (fs.existsSync(input.workspaceAgentsPath) && fs.statSync(input.workspaceAgentsPath).isFile()) {
    const workspaceAgentsContent = fs.readFileSync(input.workspaceAgentsPath, "utf8").trim();

    if (workspaceAgentsContent.length > 0) {
      sections.push(workspaceAgentsContent);
    }
  }

  sections.push(`${WORKSPACE_SESSION_ADDITIONAL_RULES_SECTION}${input.workspaceInstruction.trim()}`);

  const normalizedOverlay = input.instructionOverlay?.trim() ?? "";

  if (normalizedOverlay.length > 0) {
    sections.push(`${WORKSPACE_SESSION_TEMP_RULES_SECTION}${normalizedOverlay}`);
  }

  return `${sections.join("\n\n")}\n`;
}

function extractWorkspaceInstructionBody(content: string): string {
  const markerIndex = content.indexOf(WORKSPACE_SESSION_ADDITIONAL_RULES_SECTION);

  if (markerIndex < 0) {
    return "";
  }

  const bodyStartIndex = markerIndex + WORKSPACE_SESSION_ADDITIONAL_RULES_SECTION.length;
  const overlayIndex = content.indexOf(WORKSPACE_SESSION_TEMP_RULES_SECTION, bodyStartIndex);
  const bodyEndIndex = overlayIndex >= 0 ? overlayIndex : content.length;

  return content.slice(bodyStartIndex, bodyEndIndex).trim();
}

function extractWorkspaceInstructionOverlay(content: string): string | null {
  const overlayIndex = content.indexOf(WORKSPACE_SESSION_TEMP_RULES_SECTION);

  if (overlayIndex < 0) {
    return null;
  }

  return content.slice(overlayIndex + WORKSPACE_SESSION_TEMP_RULES_SECTION.length).trimEnd();
}

function buildWorkspaceSessionRuntimeEnv(
  provider: SessionBinding["provider"],
  authFilePath: string,
  instructionFilePath: string
): Record<string, string> {
  const runtimeEnv: Record<string, string> = {
    CODINGNS_AUTH_FILE: authFilePath,
    BUTLER_AUTH_FILE: authFilePath,
    WORKSPACE_SESSION_AUTH_FILE: authFilePath,
    WORKSPACE_SESSION_ASSISTANT_FILE: instructionFilePath,
    [CODINGNS_OFFICE_MCP_AUTH_FILE_ENV]: authFilePath
  };

  if (provider === "codex") {
    runtimeEnv[CODEX_WORKSPACE_OFFICE_MCP_ENABLE_ENV] = "1";
  }

  runtimeEnv[CODINGNS_OPENCLI_BLOCK_BROWSER_DEPENDENT_COMMANDS_ENV] = "1";

  return runtimeEnv;
}

function collectWorkspaceSessionRuntimeHomeDirs(input: {
  workspaceId: string;
  workspacePath: string;
  runtimeStorageRootDir?: string;
}): string[] {
  const runtimeHomeDirs = new Set<string>();
  const localRuntimeRootDir = path.join(input.workspacePath, ".codingns", "workspace-session-runtime");

  collectDirectChildDirectories(localRuntimeRootDir, runtimeHomeDirs);

  const globalRuntimeRootDir = input.runtimeStorageRootDir?.trim() ?? "";
  if (globalRuntimeRootDir) {
    collectDirectChildDirectories(
      path.join(globalRuntimeRootDir, "workspace-session-runtime", input.workspaceId),
      runtimeHomeDirs
    );
  }

  return [...runtimeHomeDirs];
}

function collectDirectChildDirectories(rootDir: string, target: Set<string>): void {
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    return;
  }

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }

    target.add(path.join(rootDir, entry.name));
  }
}
