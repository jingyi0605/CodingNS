import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  ButlerControlSession,
  ButlerProfile,
  SessionListItem
} from "../../types/domain.js";
import type { ButlerControlSessionRepository } from "../../storage/repositories/butler-control-session-repository.js";
import {
  ensureButlerWorkspaceIsolation,
  type ButlerProfileService
} from "./butler-profile-service.js";
import type { ButlerAuthService } from "./butler-auth-service.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { SessionHistoryService } from "../sessions/session-history-service.js";
import type { SessionLiveRuntimeService } from "../sessions/session-live-runtime-service.js";
import type { ButlerContextAggregator, ButlerPromptContext } from "./context-aggregator.js";
import type { ButlerWorkspaceCredential } from "./butler-auth-service.js";
import type { SkillManagerService } from "../skills/skill-manager-service.js";

export interface ButlerControlSessionView extends ButlerControlSession {
  session: SessionListItem;
}

export interface StartButlerControlSessionInput {
  content?: string;
  clientRequestId?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
}

export interface SendButlerControlMessageInput extends StartButlerControlSessionInput {
  content?: string;
}

export class ButlerControlSessionService {
  constructor(
    private readonly butlerProfileService: ButlerProfileService,
    private readonly butlerControlSessionRepository: ButlerControlSessionRepository,
    private readonly workspaceService: Pick<WorkspaceService, "importWorkspace">,
    private readonly sessionHistoryService: Pick<
      SessionHistoryService,
      "getSession" | "resumeSession"
    >,
    private readonly sessionLiveRuntimeService: Pick<
      SessionLiveRuntimeService,
      "startLiveSession" | "sendLiveMessage"
    >,
    private readonly butlerContextAggregator: Pick<ButlerContextAggregator, "resolvePromptContext">,
    private readonly butlerAuthService: Pick<ButlerAuthService, "ensureWorkspaceCredential" | "getCredentialFilePath">,
    private readonly skillManagerService: Pick<SkillManagerService, "getOverview" | "importUnmanagedSkill">,
    private readonly codexHomeDir: string | null = null,
    private readonly sourceCodexHomeDir: string | null = null
  ) {}

  getCurrentSession(userId: string): ButlerControlSessionView | null {
    const profile = this.butlerProfileService.ensureInitialized();
    const current = this.butlerControlSessionRepository.findLatestByProvider(profile.providerId);

    if (!current) {
      return null;
    }

    return this.toView(current, userId);
  }

  resetCurrentSession(): void {
    const profile = this.butlerProfileService.ensureInitialized();
    const current = this.butlerControlSessionRepository.findLatestByProvider(profile.providerId);

    if (!current || current.status === "closed") {
      return;
    }

    this.butlerControlSessionRepository.update({
      ...current,
      status: "closed",
      updatedAt: nowIso()
    });
  }

  async startSession(
    userId: string,
    input: StartButlerControlSessionInput = {}
  ): Promise<ButlerControlSessionView> {
    const profile = this.butlerProfileService.ensureInitialized();
    const content = normalizeControlContent(input.content, "");
    const promptContext = await this.butlerContextAggregator.resolvePromptContext(userId, input.content ?? null);
    const workspace = this.prepareWorkspace(profile, promptContext, userId);
    const current = this.butlerControlSessionRepository.findLatestByProvider(profile.providerId);

    if (current && current.status !== "closed") {
      this.butlerControlSessionRepository.update({
        ...current,
        status: "closed",
        updatedAt: nowIso()
      });
    }

    const started = await this.sessionLiveRuntimeService.startLiveSession({
      workspaceId: workspace.id,
      userId,
      provider: profile.providerId,
      content,
      clientRequestId: normalizeNullableText(input.clientRequestId),
      runtimeOptions: {
        model: normalizeNullableText(input.model),
        reasoningLevel: normalizeNullableText(input.reasoningLevel),
        permissionMode: normalizeNullableText(input.permissionMode),
        attachments: []
      }
    });
    const timestamp = started.acceptedAt;
    const created = this.butlerControlSessionRepository.create({
      id: createId(),
      providerId: profile.providerId,
      sessionId: started.sessionId,
      status: "running",
      lastContextVersion: promptContext.version,
      lastSummary: summarizeMessage(content),
      createdAt: timestamp,
      updatedAt: timestamp
    });

    return this.toView(created, userId);
  }

  async resumeCurrentSession(
    userId: string
  ): Promise<ButlerControlSessionView & {
    resumedAt: string;
    provider: string;
    providerSessionId: string;
  }> {
    const profile = this.butlerProfileService.ensureInitialized();
    const current = this.requireCurrentSession(profile.providerId);
    const promptContext = await this.butlerContextAggregator.resolvePromptContext(userId, null);
    this.syncWorkspaceContext(profile, promptContext, userId);

    try {
      const resumed = await this.sessionHistoryService.resumeSession(current.sessionId);
      const updated = this.butlerControlSessionRepository.update({
        ...current,
        status: "running",
        lastContextVersion: promptContext.version,
        updatedAt: resumed.resumedAt
      });

      return {
        ...this.toView(updated, userId),
        resumedAt: resumed.resumedAt,
        provider: resumed.provider,
        providerSessionId: resumed.providerSessionId
      };
    } catch (error) {
      this.markFailed(current, "控制会话续接失败");
      throw error;
    }
  }

  async sendMessage(
    userId: string,
    input: SendButlerControlMessageInput
  ): Promise<{
    controlSession: ButlerControlSessionView;
    sessionId: string;
    provider: string;
    providerSessionId: string;
    acceptedAt: string;
    clientRequestId: string | null;
    message: Awaited<ReturnType<SessionLiveRuntimeService["sendLiveMessage"]>>["message"];
  }> {
    const profile = this.butlerProfileService.ensureInitialized();
    const current = this.requireCurrentSession(profile.providerId);
    const content = normalizeControlContent(input.content, "");
    const promptContext = await this.butlerContextAggregator.resolvePromptContext(userId, content);
    this.syncWorkspaceContext(profile, promptContext, userId);

    try {
      const result = await this.sessionLiveRuntimeService.sendLiveMessage({
        sessionId: current.sessionId,
        userId,
        content,
        clientRequestId: normalizeNullableText(input.clientRequestId),
        runtimeOptions: {
          model: normalizeNullableText(input.model),
          reasoningLevel: normalizeNullableText(input.reasoningLevel),
          permissionMode: normalizeNullableText(input.permissionMode),
          attachments: []
        }
      });
      const updated = this.butlerControlSessionRepository.update({
        ...current,
        status: "running",
        lastContextVersion: promptContext.version,
        lastSummary: summarizeMessage(content),
        updatedAt: result.acceptedAt
      });

      return {
        controlSession: this.toView(updated, userId),
        sessionId: result.sessionId,
        provider: result.provider,
        providerSessionId: result.providerSessionId,
        acceptedAt: result.acceptedAt,
        clientRequestId: result.clientRequestId,
        message: result.message
      };
    } catch (error) {
      this.markFailed(current, summarizeMessage(content));
      throw error;
    }
  }

  private requireCurrentSession(providerId: ButlerProfile["providerId"]): ButlerControlSession {
    const current = this.butlerControlSessionRepository.findLatestByProvider(providerId);

    if (!current || current.status === "closed") {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_CONTROL_SESSION_NOT_FOUND",
        detail: "当前 provider 下还没有可用的助手控制会话"
      });
    }

    return current;
  }

  private toView(record: ButlerControlSession, userId: string): ButlerControlSessionView {
    return {
      ...record,
      session: this.sessionHistoryService.getSession(record.sessionId, userId)
    };
  }

  private prepareWorkspace(profile: ButlerProfile, promptContext: ButlerPromptContext, userId: string) {
    this.syncWorkspaceContext(profile, promptContext, userId);
    return this.workspaceService.importWorkspace(profile.workspacePath, "代码助手");
  }

  private syncWorkspaceContext(profile: ButlerProfile, promptContext: ButlerPromptContext, userId: string): void {
    fs.mkdirSync(profile.workspacePath, { recursive: true });
    ensureButlerWorkspaceIsolation(profile.workspacePath);
    const auth = this.butlerAuthService.ensureWorkspaceCredential(profile.workspacePath, userId);
    writeInstructionFiles(profile, promptContext, auth, this.butlerAuthService.getCredentialFilePath(profile.workspacePath));
    syncCodexInstructionConfig(
      profile,
      this.skillManagerService,
      this.codexHomeDir,
      this.sourceCodexHomeDir
    );
  }

  private markFailed(record: ButlerControlSession, fallbackSummary: string): void {
    this.butlerControlSessionRepository.update({
      ...record,
      status: "failed",
      lastSummary: record.lastSummary ?? fallbackSummary,
      updatedAt: nowIso()
    });
  }
}

function writeInstructionFiles(
  profile: ButlerProfile,
  promptContext: ButlerPromptContext,
  auth: ButlerWorkspaceCredential,
  authFilePath: string
): void {
  const rootAgentsPath = path.join(profile.workspacePath, "AGENTS.md");
  writeFileIfChanged(rootAgentsPath, composeInstructionContent(profile, promptContext));

  if (profile.agentsMode === "file" && profile.agentsFilePath) {
    writeFileIfChanged(profile.agentsFilePath, composeInstructionContent(profile, promptContext));
  }

  if (profile.providerId === "claude-code") {
    const claudeFilePath = path.join(profile.workspacePath, "CLAUDE.md");
    writeFileIfChanged(claudeFilePath, composeInstructionContent(profile, promptContext));
  }

  writeFileIfChanged(
    path.join(profile.workspacePath, "BUTLER_CONTEXT.md"),
    `${promptContext.prompt.trim()}\n`
  );
  writeFileIfChanged(
    path.join(profile.workspacePath, "BUTLER_API.md"),
    buildApiGuideContent(auth, authFilePath)
  );
}

function syncCodexInstructionConfig(
  profile: ButlerProfile,
  skillManagerService: Pick<SkillManagerService, "getOverview" | "importUnmanagedSkill">,
  codexHomeDir: string | null,
  sourceCodexHomeDir: string | null
): void {
  if (profile.providerId !== "codex" || !codexHomeDir?.trim()) {
    return;
  }

  const targetHomeDir = path.resolve(codexHomeDir);
  const sourceHomeDir = resolveSourceCodexHomeDir(sourceCodexHomeDir, targetHomeDir);
  const sourceConfigPath = path.join(sourceHomeDir, "config.toml");
  const instructionFilePath =
    profile.agentsMode === "file" && profile.agentsFilePath
      ? path.resolve(profile.agentsFilePath)
      : path.join(profile.workspacePath, "AGENTS.md");
  const sourceConfigContent =
    sourceHomeDir !== targetHomeDir && fs.existsSync(sourceConfigPath) && fs.statSync(sourceConfigPath).isFile()
      ? fs.readFileSync(sourceConfigPath, "utf8")
      : "";
  const configContent = composeCodexConfigContent(sourceConfigContent, instructionFilePath);

  fs.mkdirSync(targetHomeDir, { recursive: true });
  removeFileIfExists(path.join(targetHomeDir, "AGENTS.md"));
  removeFileIfExists(path.join(targetHomeDir, "AGENTS.override.md"));
  // 助手需要独立规则，但不能因为独立 home 丢掉 Codex 登录态。
  syncOptionalFile(
    path.join(sourceHomeDir, "auth.json"),
    path.join(targetHomeDir, "auth.json")
  );
  syncButlerCodexSkill(
    skillManagerService,
    path.join(targetHomeDir, "skills", "codingns-assistant")
  );
  writeFileIfChanged(path.join(targetHomeDir, "config.toml"), `${configContent}\n`);
}

function syncButlerCodexSkill(
  skillManagerService: Pick<SkillManagerService, "getOverview" | "importUnmanagedSkill">,
  targetSkillPath: string
): void {
  const skillDirectoryName = "codingns-assistant";
  const overview = skillManagerService.getOverview({
    targetCli: ["codex"]
  });
  const managedSkill = overview.managedSkills.find(
    (item) => item.skill.directoryName === skillDirectoryName
  );

  if (managedSkill) {
    syncOptionalDirectory(managedSkill.ssotPath, targetSkillPath);
    return;
  }

  const unmanagedEntry = overview.unmanagedEntries.find(
    (entry) => entry.targetCli === "codex" && entry.directoryName === skillDirectoryName
  );

  if (unmanagedEntry) {
    const imported = skillManagerService.importUnmanagedSkill({
      targetCli: "codex",
      directoryPath: unmanagedEntry.directoryPath,
      expectedContentHash: unmanagedEntry.contentHash
    });
    syncOptionalDirectory(imported.ssotPath, targetSkillPath);
    return;
  }

  fs.rmSync(targetSkillPath, { recursive: true, force: true });
}

function resolveSourceCodexHomeDir(sourceCodexHomeDir: string | null, targetHomeDir: string): string {
  const configuredSource = sourceCodexHomeDir?.trim();

  if (configuredSource) {
    const resolvedConfiguredSource = path.resolve(configuredSource);

    if (resolvedConfiguredSource !== targetHomeDir) {
      return resolvedConfiguredSource;
    }
  }

  const fallbackHomeDir = path.resolve(path.join(os.homedir(), ".codex"));

  if (fallbackHomeDir !== targetHomeDir) {
    return fallbackHomeDir;
  }

  return targetHomeDir;
}

function composeCodexConfigContent(sourceConfigContent: string, instructionFilePath: string): string {
  const normalizedSource = sourceConfigContent
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("model_instructions_file");
    })
    .join("\n")
    .trim();

  return [
    "# 代码助手专用 Codex 配置（系统自动生成）",
    normalizedSource,
    `model_instructions_file = ${toTomlString(instructionFilePath)}`
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

function writeFileIfChanged(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === content) {
    return;
  }

  fs.writeFileSync(filePath, content, "utf8");
}

function composeInstructionContent(
  profile: ButlerProfile,
  promptContext: ButlerPromptContext
): string {
  return `${profile.agentsContent.trim()}

## 代码助手运行附加说明（系统自动生成）

- 当前工作目录是代码助手专用目录，只使用这里的助手规则，不回退到普通项目会话规则。
- 你是代码助手控制面，不是项目实现者。默认职责只有：查看、分析、归纳、补查信息、安排下一步、把指令发送给真实项目会话或终端。
- 禁止直接改业务项目代码、禁止直接生成补丁并落盘、禁止自己在项目目录里写实现。用户要推进开发时，只能通过内部 API 续接/新建项目会话、发送消息、查询结果，或者操作受控终端。
- 如果用户要求“修改代码”“继续实现”“修 bug”，先定位目标项目和目标会话；没有会话就先新建/续接项目会话，再把任务发给那个会话继续做，不要自己在 Butler 工作目录里动手。
- 当前聚合后的平台摘要写在 \`BUTLER_CONTEXT.md\`，先看这里，不要把所有项目原始记录一股脑塞进回答。
- 当前摘要作用域是：${promptContext.scope === "project" ? `项目 ${promptContext.projectId}` : "全局总览"}。
- 你自己的主工具入口不是一堆 HTTP 路由，而是 \`codingns assistant ...\`。真正执行前，先用 \`codingns assistant --help\`、\`codingns assistant help <group>\`、\`codingns assistant <group> <action> --help\` 按需查命令。
- 如果当前 Codex 环境能发现 \`codingns-assistant\` skill，优先按这个 skill 的流程工作：先查能力，再查项目/会话/终端，再决定是否发送消息、fork 或发终端输入。
- 默认查询顺序固定为：先看 \`BUTLER_CONTEXT.md\`，再用 \`codingns assistant capabilities list\` 确认能力，再按 \`projects / sessions / terminals\` 分组查具体对象；不要先翻一大堆旧 REST 文档。
- 如果你在跟进开发会话，且目标或上下文里提到了 spec，只能围绕 spec 明确写出的必做项推进，不能顺着建议项无限扩展开发范围。
- 如果当前没有 spec，就先从用户要求和会话现状里归纳一句核心任务，后续只围绕这个核心任务推进；不要把建议项、最佳实践、顺手优化当成必做项。
- 如果用户的问题里已经带了项目名、会话名、错误词或任务关键词，先通过 \`codingns assistant projects --help\`、\`codingns assistant sessions --help\` 选对命令，再查目标对象；如果用户明确点名历史会话或归档会话，按 help 提示补充筛选参数。
- 如果 \`BUTLER_CONTEXT.md\` 里的项目数或会话数是 0，不能直接下结论，必须先跑 \`codingns assistant capabilities list\` 和 \`codingns assistant projects list\` 确认真实状态。
- 如果用户追问的细节超出当前摘要，先明确缺口，再按 \`BUTLER_API.md\` 里记录的 CLI 顺序补查项目、会话、消息窗口或终端历史。
- 如果用户追问会话内容，先定位 \`sessionId\`，再优先用 \`codingns assistant sessions messages <sessionId>\` 查看最近消息，不要只复述摘要。
- 需要推进开发时，优先用 \`codingns assistant sessions send <sessionId> --message ...\`；只有明确需要 shell 链路时，才用 \`codingns assistant terminals send <terminalId> --input ...\`。
- 不要编造不存在的项目状态；信息不足时直接说缺什么。
`;
}

function buildApiGuideContent(auth: ButlerWorkspaceCredential, authFilePath: string): string {
  return `# 代码助手 CLI 与按需补查指南

默认不要直接背 HTTP 路由。先用 \`codingns assistant ...\` 和分层 help 按需查询。

## 固定认证方式

- Butler 专用凭证文件：\`${path.basename(authFilePath)}\`
- 凭证文件路径：\`${authFilePath}\`
- 当前 API 基地址：\`${auth.apiBaseUrl}\`
- 先从这个文件导出环境变量，再执行 \`codingns assistant ...\`。

## 推荐先准备一次环境变量

\`\`\`bash
export CODINGNS_BASE_URL="$(jq -r '.apiBaseUrl' "${authFilePath}")"
export CODINGNS_ACCESS_TOKEN="$(jq -r '.accessToken' "${authFilePath}")"
\`\`\`

## 默认读取顺序

1. 先读 \`BUTLER_CONTEXT.md\` 的当前摘要。
2. 先跑 \`codingns assistant capabilities list\`，确认当前开放能力。
3. 不知道怎么查时，先跑 \`codingns assistant --help\`、\`codingns assistant help projects\`、\`codingns assistant help sessions\`、\`codingns assistant help terminals\`。
4. 要找项目时，先 \`codingns assistant projects list\`，需要详情时再 \`projects get <projectId>\`。
5. 要找会话时，先 \`codingns assistant sessions list --project <projectId>\`，再按需要用 \`sessions get\`、\`sessions runtime\`、\`sessions messages\`。
6. 要推进开发时，优先 \`codingns assistant sessions send <sessionId> --message "..."\`。
7. 只有明确需要 shell 链路时，先 \`terminals list\`、\`terminals history\`，再决定是否 \`terminals send\`。
8. 要开新分支时，再用 \`codingns assistant sessions fork <sessionId>\`。

## 执行边界

- 你不能直接修改项目代码，也不能把自己当成项目执行会话。
- 需要推进开发时，只能通过下面这些 CLI 命令驱动真实项目会话或受控终端。
- 需要命令结果时，优先查终端历史；确实要执行命令，再向受控终端发送输入。
- 需要分叉会话时，统一走 \`codingns assistant sessions fork\`，不要自己伪造一条“新上下文”继续编。

## help 入口

\`\`\`bash
codingns assistant --help
codingns assistant help projects
codingns assistant help sessions
codingns assistant sessions send --help
codingns assistant terminals send --help
\`\`\`

## 常用命令

- \`codingns assistant capabilities list\`：查看当前 Butler 可用能力。
- \`codingns assistant projects list\`：列出托管项目。
- \`codingns assistant projects get <projectId>\`：读取项目详情和项目下可操作会话。
- \`codingns assistant sessions list --project <projectId>\`：列出项目会话。
- \`codingns assistant sessions get <sessionId>\`：读取真实会话详情。
- \`codingns assistant sessions messages <sessionId> --limit 40\`：读取最近消息窗口。
- \`codingns assistant sessions runtime <sessionId>\`：查看会话是否还在运行。
- \`codingns assistant sessions send <sessionId> --message "..."\`：向真实项目会话发消息。
- \`codingns assistant sessions fork <sessionId> --message-id <messageId>\`：从消息点 fork 新会话。
- \`codingns assistant terminals list --project-id <projectId>\`：列出项目下终端。
- \`codingns assistant terminals history <terminalId> --limit 50\`：读取终端最近输出。
- \`codingns assistant terminals send <terminalId> --input "npm test\\n"\`：向终端发送输入。

## 底层说明

- 上面这些命令最终还是调用宿主系统的 \`/api/assistant/*\`。
- 只有当 CLI 还没覆盖某个极少数细节时，才回退到底层 HTTP。
`;
}

function toTomlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function removeFileIfExists(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  if (fs.statSync(filePath).isFile()) {
    fs.rmSync(filePath, { force: true });
  }
}

function syncOptionalFile(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    removeFileIfExists(targetPath);
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  if (fs.existsSync(targetPath) && fs.readFileSync(targetPath).equals(fs.readFileSync(sourcePath))) {
    return;
  }

  fs.copyFileSync(sourcePath, targetPath);
}

function syncOptionalDirectory(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    fs.rmSync(targetPath, { recursive: true, force: true });
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

function normalizeControlContent(value: string | undefined, fallback: string): string {
  const normalized = value?.trim() ?? fallback.trim();

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "发送控制会话消息必须提供 content",
      field: "content"
    });
  }

  return normalized;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function summarizeMessage(content: string): string {
  return content.length > 120 ? `${content.slice(0, 117)}...` : content;
}
