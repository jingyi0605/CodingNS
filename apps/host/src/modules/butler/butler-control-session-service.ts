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
    syncCodexInstructionConfig(profile, this.codexHomeDir, this.sourceCodexHomeDir);
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
  writeFileIfChanged(path.join(targetHomeDir, "config.toml"), `${configContent}\n`);
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
- 当前聚合后的平台摘要写在 \`BUTLER_CONTEXT.md\`，先看这里，不要把所有项目原始记录一股脑塞进回答。
- 当前摘要作用域是：${promptContext.scope === "project" ? `项目 ${promptContext.projectId}` : "全局总览"}。
- 如果用户的问题里已经带了项目名、会话名、错误词或任务关键词，优先按 \`BUTLER_API.md\` 调 \`GET /api/butler/search?q=...\` 命中摘要，再决定要不要继续翻原始消息；如果用户明确点名历史会话或归档会话，记得加 \`includeArchived=true\`。
- 如果 \`BUTLER_CONTEXT.md\` 里的项目数或会话数是 0，不能直接下结论，必须先按 \`BUTLER_API.md\` 实查一次 \`GET /api/butler/overview\` 和 \`GET /api/butler/projects\`。
- 如果用户追问的细节超出当前摘要，先明确缺口，再要求宿主系统按 \`BUTLER_API.md\` 的说明补查具体项目、会话、巡视或验证信息。
- 如果用户追问会话内容，先定位 \`sessionId\`，再调用 \`GET /api/sessions/:sessionId/messages?direction=backward&limit=40\` 查看最近消息，不要只复述摘要。
- 不要编造不存在的项目状态；信息不足时直接说缺什么。
`;
}

function buildApiGuideContent(auth: ButlerWorkspaceCredential, authFilePath: string): string {
  return `# 代码助手内部补查接口

这些接口由宿主系统提供，用于按需补查信息，不应该在每轮对话默认全量注入。

## 固定认证方式

- Butler 专用凭证文件：\`${path.basename(authFilePath)}\`
- 凭证文件路径：\`${authFilePath}\`
- 当前 API 基地址：\`${auth.apiBaseUrl}\`
- 调内部接口时固定读取这个文件，不要每轮重新摸索认证方式。
- 请求头固定为：\`Authorization: Bearer <BUTLER_AUTH.json.accessToken>\`

## 默认读取顺序

1. 先读 \`BUTLER_CONTEXT.md\` 的当前摘要。
2. 用户的问题里带了项目名、会话名、报错词、任务词时，先补查 \`GET /api/butler/search?q=...\`，优先命中摘要层；如果用户明确点名历史会话或归档会话，改用 \`GET /api/butler/search?q=...&includeArchived=true\`。
3. 如果摘要里项目数或会话数是 0，先补查 \`GET /api/butler/overview\` 和 \`GET /api/butler/projects\`，确认不是旧摘要。
4. 用户问全局情况时，补查 \`GET /api/butler/overview\`。
5. 用户明确追问某个项目时，补查 \`GET /api/butler/projects/:projectId/context\`。
6. 用户追问某个会话内容时，先拿到 \`sessionId\`，再补查 \`GET /api/sessions/:sessionId/messages?direction=backward&limit=40\`。
7. 仍然不够时，再按既有 butler 细节接口查询项目、会话、记忆、巡视、验证对象。

## 调用示例

\`\`\`bash
TOKEN="$(jq -r '.accessToken' "${authFilePath}")"
BASE_URL="$(jq -r '.apiBaseUrl' "${authFilePath}")"
curl -H "Authorization: Bearer ${"$"}TOKEN" "${"$"}BASE_URL/api/butler/overview"
\`\`\`

## 可用接口

- \`GET /api/butler/overview\`：全局聚合总览，只返回摘要层和行动层。
- \`GET /api/butler/projects\`：当前 Butler 视图中的项目列表。
- \`GET /api/butler/context-snapshot\`：完整聚合快照，仍然只返回摘要字段，不返回全量原始正文。
- \`GET /api/butler/search?q=...\`：Butler 摘要优先检索入口，先按项目、会话、记忆、巡视、验证摘要做命中。
- \`GET /api/butler/search?q=...&includeArchived=true\`：当用户明确要查历史会话或归档会话时，扩展到归档摘要。
- \`GET /api/butler/projects/:projectId/context\`：单项目聚合上下文，用于回答项目级追问。
- \`GET /api/butler/projects/:projectId/sessions\`：项目会话列表。
- \`GET /api/butler/projects/:projectId/memories\`：项目记忆摘要列表。
- \`GET /api/butler/projects/:projectId/patrol-runs\`：项目巡视记录列表。
- \`GET /api/butler/projects/:projectId/verifications\`：项目验证记录列表。
- \`GET /api/sessions/:sessionId/messages?direction=backward&limit=40\`：读取某个真实会话最近几十条消息。
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
