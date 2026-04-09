import { t } from "../../../shared/i18n";
import claudeCodeIcon from "../../../assets/provider-icons/claude-code.png";
import type {
  BuiltinProviderId,
  InRunInputMode,
  ProviderCapabilitiesDto,
  ProviderId,
  ProviderModelOptionDto
} from "../api/conversation-api";
import codexIcon from "../../../assets/provider-icons/codex.png";
import geminiIcon from "../../../assets/provider-icons/gemini.png";
import kimiIcon from "../../../assets/provider-icons/kimi.png";
import openCodeIcon from "../../../assets/provider-icons/opencode.png";

const REASONING_LEVEL_SET = new Set(["low", "medium", "high", "xhigh"]);

interface ProviderMetadata {
  displayNameKey: string;
  fullDisplayNameKey?: string;
  draftTitleKey: string;
  defaultModelLabelKey: string;
  icon: string;
  defaultRunInputMode: InRunInputMode;
  reasoningLevelPersists: boolean;
  defaultReasoningLevel?: string | null;
  supportsInterrupt?: boolean;
  supportsAttachments?: boolean;
  supportsPermissionPrompt?: boolean;
  supportsSlashMenuByDefault?: boolean;
  foldRulesMessagesByDefault?: boolean;
}

export const REGISTERED_PROVIDER_IDS: BuiltinProviderId[] = [
  "claude-code",
  "codex",
  "opencode",
  "gemini",
  "kimi"
];

// 会话创建入口：保持与当前已接入的稳定 provider 对齐。
export const SESSION_PROVIDER_PICKER_IDS: BuiltinProviderId[] = [
  "codex",
  "claude-code",
  "opencode",
  "gemini",
  "kimi"
];

// Provider 体系元数据：集中维护不同 provider 的前端行为差异
const PROVIDER_METADATA: Record<BuiltinProviderId, ProviderMetadata> = {
  "claude-code": {
    displayNameKey: "conversation.providerClaude",
    fullDisplayNameKey: "shell.providerClaudeCode",
    draftTitleKey: "conversation.draftTitleClaude",
    defaultModelLabelKey: "conversation.modelUseCliDefault",
    icon: claudeCodeIcon,
    defaultRunInputMode: "streaming_guidance",
    reasoningLevelPersists: false,
    defaultReasoningLevel: undefined,
    supportsSlashMenuByDefault: true,
    foldRulesMessagesByDefault: false
  },
  codex: {
    displayNameKey: "conversation.providerCodex",
    draftTitleKey: "conversation.draftTitleCodex",
    defaultModelLabelKey: "conversation.modelUseCliDefault",
    icon: codexIcon,
    defaultRunInputMode: "none",
    reasoningLevelPersists: true,
    defaultReasoningLevel: null,
    supportsSlashMenuByDefault: false,
    foldRulesMessagesByDefault: true
  },
  opencode: {
    displayNameKey: "conversation.providerOpenCode",
    draftTitleKey: "conversation.draftTitleOpenCode",
    defaultModelLabelKey: "conversation.modelUseCliDefault",
    icon: openCodeIcon,
    defaultRunInputMode: "none",
    reasoningLevelPersists: false,
    defaultReasoningLevel: undefined,
    supportsSlashMenuByDefault: false,
    foldRulesMessagesByDefault: false
  },
  gemini: {
    displayNameKey: "conversation.providerGemini",
    draftTitleKey: "conversation.draftTitleGemini",
    defaultModelLabelKey: "conversation.modelUseCliDefault",
    icon: geminiIcon,
    defaultRunInputMode: "none",
    reasoningLevelPersists: false,
    defaultReasoningLevel: null,
    supportsInterrupt: true,
    supportsAttachments: false,
    supportsPermissionPrompt: false,
    supportsSlashMenuByDefault: false,
    foldRulesMessagesByDefault: false
  },
  kimi: {
    displayNameKey: "conversation.providerKimi",
    draftTitleKey: "conversation.draftTitleKimi",
    defaultModelLabelKey: "conversation.modelUseCliDefault",
    icon: kimiIcon,
    defaultRunInputMode: "none",
    reasoningLevelPersists: false,
    defaultReasoningLevel: null,
    supportsInterrupt: true,
    supportsAttachments: false,
    supportsPermissionPrompt: false,
    supportsSlashMenuByDefault: false,
    foldRulesMessagesByDefault: true
  }
};

function isBuiltinProviderId(value: string): value is BuiltinProviderId {
  return REGISTERED_PROVIDER_IDS.includes(value as BuiltinProviderId);
}

function getProviderMetadata(provider: ProviderId | null): ProviderMetadata | null {
  if (!provider) {
    return null;
  }

  if (!isBuiltinProviderId(provider)) {
    return null;
  }

  return PROVIDER_METADATA[provider];
}

function createDefaultModelOptions(labelKey: string): ProviderModelOptionDto[] {
  return [
    {
      id: "provider-default",
      name: t(labelKey),
      usesProviderDefault: true
    }
  ];
}

function getMetadataModelOptions(provider: ProviderId | null): ProviderModelOptionDto[] {
  const metadata = getProviderMetadata(provider);
  return createDefaultModelOptions(metadata?.defaultModelLabelKey ?? "conversation.modelUseCliDefault");
}

// 草稿会话只要有 provider 值就默认可用，避免再按名字死写
export function isDraftProviderSupported(value: string | null): value is ProviderId {
  return Boolean(value && getProviderMetadata(value));
}

// 统一从 metadata 读取草稿标题，保持文案可控
export function getDraftTitle(provider: ProviderId | null): string {
  const metadata = getProviderMetadata(provider);
  return t(metadata?.draftTitleKey ?? "conversation.draftTitleCodex");
}

export function getProviderDisplayName(
  provider: ProviderId | null,
  mode: "compact" | "full" = "compact"
): string {
  const metadata = getProviderMetadata(provider);

  if (!metadata) {
    return provider?.trim() || t("conversation.providerCodex");
  }

  if (mode === "full" && metadata.fullDisplayNameKey) {
    return t(metadata.fullDisplayNameKey);
  }

  return t(metadata.displayNameKey);
}

export function getProviderIcon(provider: ProviderId | null): string {
  const metadata = getProviderMetadata(provider);
  return metadata?.icon ?? codexIcon;
}

// 构建草稿页面的能力快照，保持和 metadata 同步
export function createDraftCapabilities(provider: ProviderId): ProviderCapabilitiesDto {
  const metadata = getProviderMetadata(provider);

  return {
    provider,
    canStartSession: true,
    canResumeSession: true,
    canSendMessage: true,
    inRunInputMode: metadata?.defaultRunInputMode ?? "none",
    supportsSubagents: false,
    supportsInterrupt: metadata?.supportsInterrupt ?? false,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: true,
    supportsAttachments: metadata?.supportsAttachments ?? true,
    supportsPermissionPrompt: metadata?.supportsPermissionPrompt ?? true,
    supportsCheckpoint: false,
    modelOptions: getMetadataModelOptions(provider),
    defaultReasoningLevel: metadata?.defaultReasoningLevel,
    limitations: []
  };
}

export function getProviderFromCapabilities(capabilities: ProviderCapabilitiesDto | null): ProviderId {
  return capabilities?.provider ?? ("claude-code" as ProviderId);
}

export function shouldShowSlashMenu(capabilities: ProviderCapabilitiesDto | null): boolean {
  if (capabilities?.supportsSlashMenu !== undefined) {
    return capabilities.supportsSlashMenu;
  }

  const provider = capabilities?.provider ?? null;
  return getProviderMetadata(provider)?.supportsSlashMenuByDefault ?? false;
}

export function supportsReasoningSelector(capabilities: ProviderCapabilitiesDto | null): boolean {
  if (capabilities?.supportsReasoningSelector !== undefined) {
    return capabilities.supportsReasoningSelector;
  }

  return Boolean(
    capabilities?.modelOptions?.some(
      (option) =>
        option.supportedReasoningEfforts?.some((effort) => REASONING_LEVEL_SET.has(effort)) ?? false
    )
  );
}

export function allowsQueueDuringRun(
  capabilities: ProviderCapabilitiesDto | null,
  hasActiveRun: boolean | null
): boolean {
  if (capabilities?.supportsQueueWhileRunning !== undefined) {
    return capabilities.supportsQueueWhileRunning;
  }

  const inRunInput = capabilities?.inRunInputMode ?? "none";
  return (
    inRunInput === "queued_guidance"
    || inRunInput === "none"
    || (inRunInput === "streaming_guidance" && hasActiveRun === false)
  );
}

export function shouldSupportRunSteering(capabilities: ProviderCapabilitiesDto | null): boolean {
  if (capabilities?.supportsRunSteering !== undefined) {
    return capabilities.supportsRunSteering;
  }

  return capabilities?.inRunInputMode === "streaming_guidance";
}

// 某些 provider 需要记住推理档位，统一由 metadata 控制
export function shouldPersistReasoningLevel(provider: ProviderId): boolean {
  const metadata = getProviderMetadata(provider);
  return metadata?.reasoningLevelPersists ?? false;
}

// 规则消息合并默认行为也由 metadata 决定，以防散落的 provider 判断
export function shouldFoldRulesMessages(
  capabilities: ProviderCapabilitiesDto | null,
  fallbackProvider?: ProviderId | null
): boolean {
  if (capabilities?.supportsRulesMessageFolding !== undefined) {
    return capabilities.supportsRulesMessageFolding;
  }

  const provider = capabilities?.provider ?? fallbackProvider ?? null;
  return getProviderMetadata(provider)?.foldRulesMessagesByDefault ?? false;
}
