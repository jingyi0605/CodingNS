import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  ButlerAgentsMode,
  ButlerFocusProfile,
  ButlerPersonaProfile,
  ButlerProfile,
  ButlerProfileProviderId
} from "../../types/domain.js";
import type { ButlerProfileRepository } from "../../storage/repositories/butler-profile-repository.js";
import type { ButlerProjectRepository } from "../../storage/repositories/butler-project-repository.js";
import type { ProviderControlRepository } from "../../storage/repositories/provider-control-repository.js";
import { createProviderDisabledError } from "../provider/provider-disabled.js";

const BUTLER_PROFILE_ID_PREFIX = "default";
const DEFAULT_BUTLER_DISPLAY_NAME = "代码助手";
const DEFAULT_BUTLER_WORKSPACE_DIRNAME = "butler-workspace";
const SUPPORTED_PROVIDERS: ButlerProfileProviderId[] = ["codex", "claude-code"];
const PROVIDER_ERROR_DETAIL = "providerId 只允许为 codex 或 claude-code";
const SUPPORTED_AGENTS_MODES: ButlerAgentsMode[] = ["inline", "file"];
const SUPPORTED_PERSONA_TONES = ["direct", "steady", "friendly"] as const;
const SUPPORTED_PERSONA_LANGUAGES = ["zh-CN", "en-US", "bilingual"] as const;
const SUPPORTED_SUMMARY_STYLES = ["brief", "structured", "thorough"] as const;
const SUPPORTED_RISK_PREFERENCES = ["conservative", "balanced", "proactive"] as const;
const SUPPORTED_REPORT_PRIORITIES = ["risk", "blocker", "verification", "progress"] as const;
const DEFAULT_SUMMARY_DEBOUNCE_SECONDS = 300;
const MIN_SUMMARY_DEBOUNCE_SECONDS = 60;
const MAX_SUMMARY_DEBOUNCE_SECONDS = 3_600;

export interface ButlerProfileInitInput {
  displayName?: unknown;
  providerId?: unknown;
  workspacePath?: unknown;
  agentsMode?: unknown;
  agentsFilePath?: unknown;
  agentsContent?: unknown;
  persona?: unknown;
  focus?: unknown;
}

export interface ButlerProfilePatchInput extends ButlerProfileInitInput {}

export class ButlerProfileService {
  private readonly providerControlRepository: Pick<ProviderControlRepository, "get">;

  constructor(
    private readonly butlerProfileRepository: ButlerProfileRepository,
    private readonly butlerProjectRepository: Pick<ButlerProjectRepository, "list">,
    private readonly dataRootDir: string = path.resolve("data", "host"),
    providerControlRepository: Pick<ProviderControlRepository, "get"> | null = null
  ) {
    this.providerControlRepository = providerControlRepository ?? {
      get: (providerId: string) => ({
        providerId: providerId.trim(),
        enabled: true,
        updatedAt: ""
      })
    };
  }

  getProfile(userId?: string): ButlerProfile | null {
    const profile = this.butlerProfileRepository.find(userId);
    return profile ? hydrateStoredProfile(profile) : null;
  }

  isSetupCompleted(userId?: string): boolean {
    return this.getProfile(userId)?.setupCompleted === true;
  }

  initProfile(userId: string, input: ButlerProfileInitInput): ButlerProfile {
    const current = this.getProfile(userId);

    if (current?.setupCompleted) {
      throw createButlerAlreadyInitializedError();
    }

    const timestamp = nowIso();
    const profile = buildButlerProfileRecord(
      userId,
      input,
      timestamp,
      current,
      this.butlerProjectRepository,
      this.dataRootDir,
      this.providerControlRepository
    );

    try {
      return current
        ? this.butlerProfileRepository.update(profile)
        : this.butlerProfileRepository.create(profile);
    } catch (error) {
      if (isSqlitePrimaryKeyConflict(error) && this.isSetupCompleted(userId)) {
        throw createButlerAlreadyInitializedError();
      }

      throw error;
    }
  }

  updateProfile(userId: string, input: ButlerProfilePatchInput): ButlerProfile {
    const current = this.getProfile(userId);

    if (!current) {
      throw new AppError({
        statusCode: 409,
        errorCode: "BUTLER_PROFILE_NOT_INITIALIZED",
        detail: "代码助手尚未完成初始化"
      });
    }

    const updated = buildButlerProfileRecord(
      userId,
      input,
      current.initializedAt,
      current,
      this.butlerProjectRepository,
      this.dataRootDir,
      this.providerControlRepository
    );

    return this.butlerProfileRepository.update(updated);
  }

  ensureInitialized(userId?: string): ButlerProfile {
    const profile = this.getProfile(userId);

    if (!profile) {
      throw new AppError({
        statusCode: 409,
        errorCode: "BUTLER_PROFILE_NOT_INITIALIZED",
        detail: "代码助手尚未完成初始化，不能启动控制会话"
      });
    }

    return profile;
  }
}

function buildButlerProfileRecord(
  userId: string,
  input: ButlerProfileInitInput | ButlerProfilePatchInput,
  initializedAt: string,
  current: ButlerProfile | null,
  butlerProjectRepository: Pick<ButlerProjectRepository, "list">,
  dataRootDir: string,
  providerControlRepository: Pick<ProviderControlRepository, "get">
): ButlerProfile {
  const displayName =
    input.displayName !== undefined
      ? normalizeDisplayName(input.displayName)
      : current?.displayName ?? DEFAULT_BUTLER_DISPLAY_NAME;
  const workspacePath =
    input.workspacePath !== undefined
      ? normalizeWorkspacePath(input.workspacePath, butlerProjectRepository)
      : current?.workspacePath ?? resolveDefaultWorkspacePath(dataRootDir, butlerProjectRepository);
  const providerId =
    input.providerId !== undefined
      ? normalizeProviderId(input.providerId)
      : current?.providerId ?? invalidField("providerId", PROVIDER_ERROR_DETAIL);
  if (!providerControlRepository.get(providerId).enabled) {
    throw createProviderDisabledError(providerId, "providerId");
  }
  const agentsMode =
    input.agentsMode !== undefined
      ? normalizeAgentsMode(input.agentsMode)
      : current?.agentsMode ?? "inline";
  const persona =
    input.persona !== undefined
      ? normalizePersona(input.persona)
      : current?.persona ?? createDefaultPersona();
  const focus =
    input.focus !== undefined
      ? normalizeFocus(input.focus)
      : current?.focus ?? createDefaultFocus();
  const generatedAgentsContent = buildGeneratedAgentsContent({
    displayName,
    providerId,
    persona,
    focus
  });
  const agentsConfig = resolveAgentsConfig(
    input,
    current,
    workspacePath,
    agentsMode,
    generatedAgentsContent
  );

  return {
    id: `${BUTLER_PROFILE_ID_PREFIX}:${userId}`,
    userId,
    displayName,
    providerId,
    workspacePath,
    agentsMode,
    agentsFilePath: agentsConfig.agentsFilePath,
    agentsContent: agentsConfig.agentsContent,
    persona,
    focus,
    setupCompleted: true,
    initializedAt,
    updatedAt: nowIso()
  };
}

function createButlerAlreadyInitializedError(): AppError {
  return new AppError({
    statusCode: 409,
    errorCode: "BUTLER_PROFILE_ALREADY_INITIALIZED",
    detail: "代码助手已经初始化，不能重复初始化"
  });
}

function isSqlitePrimaryKeyConflict(error: unknown): boolean {
  const errorCode =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : null;

  return (
    error instanceof Error
    && (error.message.includes("UNIQUE constraint failed: butler_profiles.id")
      || errorCode === "SQLITE_CONSTRAINT_PRIMARYKEY")
  );
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidField("displayName", "displayName 必须是非空字符串");
  }

  const normalized = value.trim();

  if (!normalized) {
    throw invalidField("displayName", "displayName 必须是非空字符串");
  }

  return normalized;
}

function normalizeProviderId(value: unknown): ButlerProfileProviderId {
  if (typeof value !== "string") {
    throw invalidField("providerId", PROVIDER_ERROR_DETAIL);
  }

  const normalized = value.trim() as ButlerProfileProviderId;

  if (!SUPPORTED_PROVIDERS.includes(normalized)) {
    throw invalidField("providerId", PROVIDER_ERROR_DETAIL);
  }

  return normalized;
}

function hydrateStoredProviderId(value: unknown): ButlerProfileProviderId {
  return normalizeProviderId(value);
}

function normalizeWorkspacePath(
  value: unknown,
  butlerProjectRepository: Pick<ButlerProjectRepository, "list">
): string {
  if (typeof value !== "string") {
    throw invalidField("workspacePath", "workspacePath 必须是绝对目录路径");
  }

  const normalized = value.trim();

  if (!normalized) {
    throw invalidField("workspacePath", "workspacePath 不能为空");
  }

  return finalizeWorkspacePath(normalized, butlerProjectRepository);
}

function resolveDefaultWorkspacePath(
  dataRootDir: string,
  butlerProjectRepository: Pick<ButlerProjectRepository, "list">
): string {
  return finalizeWorkspacePath(path.join(dataRootDir, DEFAULT_BUTLER_WORKSPACE_DIRNAME), butlerProjectRepository);
}

function finalizeWorkspacePath(
  targetPath: string,
  butlerProjectRepository: Pick<ButlerProjectRepository, "list">
): string {
  const resolved = path.resolve(targetPath);

  if (!path.isAbsolute(resolved)) {
    throw invalidField("workspacePath", "workspacePath 必须是绝对目录路径");
  }

  if (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) {
    throw invalidField("workspacePath", "workspacePath 必须指向目录");
  }

  const duplicatedProject = butlerProjectRepository
    .list()
    .find((project) => path.resolve(project.repoRoot) === resolved);

  if (duplicatedProject) {
    throw invalidField("workspacePath", "workspacePath 不能直接复用某个项目仓库目录");
  }

  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function normalizeAgentsMode(value: unknown): ButlerAgentsMode {
  if (typeof value !== "string") {
    throw invalidField("agentsMode", "agentsMode 只允许为 inline 或 file");
  }

  const normalized = value.trim() as ButlerAgentsMode;

  if (!SUPPORTED_AGENTS_MODES.includes(normalized)) {
    throw invalidField("agentsMode", "agentsMode 只允许为 inline 或 file");
  }

  return normalized;
}

function resolveAgentsConfig(
  input: ButlerProfileInitInput | ButlerProfilePatchInput,
  current: ButlerProfile | null,
  workspacePath: string,
  agentsMode: ButlerAgentsMode,
  generatedAgentsContent: string
): {
  agentsFilePath: string | null;
  agentsContent: string;
} {
  const hasAgentsFilePath = Object.prototype.hasOwnProperty.call(input, "agentsFilePath");
  const hasAgentsContent = Object.prototype.hasOwnProperty.call(input, "agentsContent");
  const hasGeneratedSeedChange =
    current === null
    || input.displayName !== undefined
    || input.persona !== undefined
    || input.focus !== undefined
    || input.agentsMode !== undefined;
  const nextAgentsFilePath = hasAgentsFilePath
    ? normalizeOptionalFilePath(input.agentsFilePath, workspacePath)
    : current?.agentsFilePath ?? path.join(workspacePath, "AGENTS.md");
  const explicitAgentsContent = hasAgentsContent
    ? normalizeOptionalContent(input.agentsContent)
    : null;

  if (agentsMode === "inline") {
    const agentsContent =
      explicitAgentsContent
      ?? (hasGeneratedSeedChange ? generatedAgentsContent : current?.agentsContent)
      ?? generatedAgentsContent;

    return {
      agentsFilePath: null,
      agentsContent
    };
  }

  const agentsFilePath = nextAgentsFilePath ?? path.join(workspacePath, "AGENTS.md");

  if (!isPathWithinWorkspace(workspacePath, agentsFilePath)) {
    throw invalidField("agentsFilePath", "AGENTS.md 必须位于助手工作目录内");
  }

  if (explicitAgentsContent) {
    writeAgentsFile(agentsFilePath, explicitAgentsContent);
    return {
      agentsFilePath,
      agentsContent: explicitAgentsContent
    };
  }

  if (fs.existsSync(agentsFilePath) && !hasGeneratedSeedChange) {
    return {
      agentsFilePath,
      agentsContent: readAgentsFile(agentsFilePath)
    };
  }

  writeAgentsFile(agentsFilePath, generatedAgentsContent);

  return {
    agentsFilePath,
    agentsContent: generatedAgentsContent
  };
}

function normalizeOptionalFilePath(value: unknown, workspacePath: string): string | null {
  if (value === null) {
    return null;
  }

  if (value === undefined) {
    return path.join(workspacePath, "AGENTS.md");
  }

  if (typeof value !== "string") {
    throw invalidField("agentsFilePath", "agentsFilePath 必须是绝对文件路径");
  }

  const normalized = value.trim();

  if (!normalized) {
    return path.join(workspacePath, "AGENTS.md");
  }

  const resolved = path.resolve(normalized);

  if (!path.isAbsolute(resolved)) {
    throw invalidField("agentsFilePath", "agentsFilePath 必须是绝对文件路径");
  }

  return resolved;
}

function normalizeOptionalContent(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw invalidField("agentsContent", "agentsContent 必须是字符串");
  }

  const normalized = value.trim();
  return normalized || null;
}

function readAgentsFile(filePath: string): string {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw invalidField("agentsFilePath", "agentsFilePath 必须指向已存在的 AGENTS.md 文件");
  }

  const content = fs.readFileSync(filePath, "utf8").trim();

  if (!content) {
    throw invalidField("agentsFilePath", "AGENTS.md 文件内容不能为空");
  }

  return content;
}

function writeAgentsFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content.trim()}\n`, "utf8");
}

function normalizePersona(value: unknown): ButlerPersonaProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidField("persona", "persona 必须是对象");
  }

  const record = value as Record<string, unknown>;
  const tone = normalizeEnumText(record.tone, "persona.tone", SUPPORTED_PERSONA_TONES);
  const language = normalizeEnumText(record.language, "persona.language", SUPPORTED_PERSONA_LANGUAGES);
  const summaryStyle = normalizeEnumText(
    record.summaryStyle,
    "persona.summaryStyle",
    SUPPORTED_SUMMARY_STYLES
  );

  return {
    ...record,
    tone,
    language,
    summaryStyle
  };
}

function normalizeFocus(value: unknown): ButlerFocusProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidField("focus", "focus 必须是对象");
  }

  const record = value as Record<string, unknown>;
  const projectIds = record.projectIds === undefined
    ? []
    : normalizeStringArray(record.projectIds, "focus.projectIds");
  const riskPreference = normalizeEnumText(
    record.riskPreference,
    "focus.riskPreference",
    SUPPORTED_RISK_PREFERENCES
  );
  const reportPriority = normalizePriorityArray(record.reportPriority);
  const summaryDebounceSeconds = normalizeSummaryDebounceSeconds(record.summaryDebounceSeconds);

  return {
    ...record,
    projectIds,
    riskPreference,
    reportPriority,
    summaryDebounceSeconds
  };
}

function createDefaultPersona(): ButlerPersonaProfile {
  return {
    tone: "direct",
    language: "zh-CN",
    summaryStyle: "brief"
  };
}

function createDefaultFocus(): ButlerFocusProfile {
  return {
    projectIds: [],
    riskPreference: "conservative",
    reportPriority: ["risk", "blocker", "verification"],
    summaryDebounceSeconds: DEFAULT_SUMMARY_DEBOUNCE_SECONDS
  };
}

function normalizeSummaryDebounceSeconds(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_SUMMARY_DEBOUNCE_SECONDS;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidField("focus.summaryDebounceSeconds", "focus.summaryDebounceSeconds 必须是整数秒数");
  }

  const normalized = Math.trunc(value);

  if (
    normalized < MIN_SUMMARY_DEBOUNCE_SECONDS
    || normalized > MAX_SUMMARY_DEBOUNCE_SECONDS
  ) {
    throw invalidField(
      "focus.summaryDebounceSeconds",
      `focus.summaryDebounceSeconds 必须在 ${MIN_SUMMARY_DEBOUNCE_SECONDS} 到 ${MAX_SUMMARY_DEBOUNCE_SECONDS} 秒之间`
    );
  }

  return normalized;
}

function normalizeEnumText<T extends readonly string[]>(
  value: unknown,
  field: string,
  supportedValues: T
): T[number] {
  if (typeof value !== "string") {
    throw invalidField(field, `${field} 必须是受支持的字符串`);
  }

  const normalized = value.trim() as T[number];

  if (!supportedValues.includes(normalized)) {
    throw invalidField(field, `${field} 必须是受支持的字符串`);
  }

  return normalized;
}

function normalizeStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw invalidField(field, `${field} 必须是字符串数组`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw invalidField(field, `${field}[${index}] 必须是非空字符串`);
    }

    return item.trim();
  });
}

function normalizePriorityArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidField("focus.reportPriority", "focus.reportPriority 至少要有一个优先级");
  }

  const normalized = value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw invalidField("focus.reportPriority", `focus.reportPriority[${index}] 必须是非空字符串`);
    }

    const priority = item.trim();

    if (!SUPPORTED_REPORT_PRIORITIES.includes(priority as (typeof SUPPORTED_REPORT_PRIORITIES)[number])) {
      throw invalidField("focus.reportPriority", `不支持的汇报优先级：${priority}`);
    }

    return priority;
  });

  return Array.from(new Set(normalized));
}

function buildGeneratedAgentsContent(input: {
  displayName: string;
  providerId: ButlerProfileProviderId;
  persona: ButlerPersonaProfile;
  focus: ButlerFocusProfile;
}): string {
  return [
    "# AGENTS.md",
    `你是代码助手「${input.displayName}」。`,
    `在对话中，你必须以“${input.displayName}”作为自称，让用户知道这是独立的助手身份，不是普通项目会话。`,
    "这套规则只服务于代码助手工作目录，不继承普通项目工作区的会话规则。",
    "如果上层仓库、默认配置或普通项目会话规则和这里冲突，以这里的助手规则为准。",
    "",
    "## 回答要求",
    "- 先给结论，再给证据，最后给下一步建议。",
    "- 只基于当前对话需要的摘要信息回答；不够时明确说明缺口，并继续补查真实项目、会话、巡视、验证信息。",
    "- 不要把无关项目的原始记录整批塞进回答，更不要编造状态。",
    "- 会话跟进时，如果目标或上下文提到了 spec，只能围绕 spec 明确写出的必做项推进，不能顺着建议项无限扩展。",
    "- 如果没有 spec，就先归纳当前核心任务，然后只围绕这一个核心任务推进；重构、优化、顺手补充都默认不是必做项。",
    "",
    "## 初始化偏好（系统自动生成）",
    `- 当前 provider：${input.providerId}`,
    `- 语气：${describeTone(input.persona.tone)}`,
    `- 使用语言：${describeLanguage(input.persona.language)}`,
    `- 总结风格：${describeSummaryStyle(input.persona.summaryStyle)}`,
    `- 风险倾向：${describeRiskPreference(input.focus.riskPreference)}`,
    `- 汇报优先级：${describeReportPriority(input.focus.reportPriority)}`,
    `- 会话摘要防抖：${describeSummaryDebounceSeconds(input.focus.summaryDebounceSeconds)}`
  ].join("\n");
}

function hydrateStoredProfile(profile: ButlerProfile): ButlerProfile {
  return {
    ...profile,
    providerId: hydrateStoredProviderId(profile.providerId),
    persona: normalizePersona(profile.persona),
    focus: normalizeFocus(profile.focus)
  };
}

function describeTone(value: string): string {
  switch (value) {
    case "friendly":
      return "友好耐心，但不绕弯";
    case "steady":
      return "稳健克制，重点清楚";
    case "direct":
    default:
      return "直接明确，不说空话";
  }
}

function describeLanguage(value: string): string {
  switch (value) {
    case "en-US":
      return "优先英文";
    case "bilingual":
      return "中英双语，必要时先中文后英文";
    case "zh-CN":
    default:
      return "优先简体中文";
  }
}

function describeSummaryStyle(value: string): string {
  switch (value) {
    case "thorough":
      return "完整展开，适合复杂问题";
    case "structured":
      return "分段清晰，便于快速扫描";
    case "brief":
    default:
      return "简明扼要，先说重点";
  }
}

function describeRiskPreference(value: string): string {
  switch (value) {
    case "proactive":
      return "主动暴露潜在风险，宁可早提醒";
    case "balanced":
      return "平衡推进和风险控制";
    case "conservative":
    default:
      return "保守稳妥，先避免误判和误操作";
  }
}

function describeReportPriority(values: string[]): string {
  return values.map((value) => {
    switch (value) {
      case "blocker":
        return "阻塞";
      case "verification":
        return "验证";
      case "progress":
        return "进展";
      case "risk":
      default:
        return "风险";
    }
  }).join("、");
}

function describeSummaryDebounceSeconds(value: number): string {
  if (value % 60 === 0) {
    return `${value / 60} 分钟`;
  }

  return `${value} 秒`;
}

function isPathWithinWorkspace(workspacePath: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(workspacePath), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function invalidField(field: string, detail: string): never {
  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail,
    field
  });
}
