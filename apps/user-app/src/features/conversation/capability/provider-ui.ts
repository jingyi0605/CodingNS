import { t } from "../../../shared/i18n";
import type {
  InRunInputMode,
  ProviderCapabilitiesDto,
  ProviderId,
  ProviderModelOptionDto
} from "../api/conversation-api";

const REASONING_LEVEL_SET = new Set(["low", "medium", "high", "xhigh"]);

type ProviderIconVariant = "codex" | "claude" | "generic";

interface ProviderMetadata {
  displayNameKey: string;
  draftTitleKey: string;
  defaultModelLabelKey: string;
  defaultRunInputMode: InRunInputMode;
  reasoningLevelPersists: boolean;
  defaultReasoningLevel?: string | null;
  iconVariant: ProviderIconVariant;
  supportsSlashMenuByDefault?: boolean;
  foldRulesMessagesByDefault?: boolean;
}

// Provider 体系元数据：集中维护不同 provider 的前端行为差异
const PROVIDER_METADATA: Record<string, ProviderMetadata> = {
  "claude-code": {
    displayNameKey: "conversation.providerClaude",
    draftTitleKey: "conversation.draftTitleClaude",
    defaultModelLabelKey: "conversation.modelUseCliDefault",
    defaultRunInputMode: "streaming_guidance",
    reasoningLevelPersists: false,
    defaultReasoningLevel: undefined,
    iconVariant: "claude",
    supportsSlashMenuByDefault: true,
    foldRulesMessagesByDefault: false
  },
  codex: {
    displayNameKey: "conversation.providerCodex",
    draftTitleKey: "conversation.draftTitleCodex",
    defaultModelLabelKey: "conversation.modelUseCliDefault",
    defaultRunInputMode: "none",
    reasoningLevelPersists: true,
    defaultReasoningLevel: null,
    iconVariant: "codex",
    supportsSlashMenuByDefault: false,
    foldRulesMessagesByDefault: true
  },
  opencode: {
    displayNameKey: "conversation.providerOpenCode",
    draftTitleKey: "conversation.draftTitleOpenCode",
    defaultModelLabelKey: "conversation.modelUseCliDefault",
    defaultRunInputMode: "none",
    reasoningLevelPersists: false,
    defaultReasoningLevel: undefined,
    iconVariant: "generic",
    supportsSlashMenuByDefault: false,
    foldRulesMessagesByDefault: false
  }
};

function getProviderMetadata(provider: ProviderId | null): ProviderMetadata | null {
  if (!provider) {
    return null;
  }

  return PROVIDER_METADATA[provider] ?? null;
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
  return Boolean(value);
}

// 统一从 metadata 读取草稿标题，保持文案可控
export function getDraftTitle(provider: ProviderId | null): string {
  const metadata = getProviderMetadata(provider);
  return t(metadata?.draftTitleKey ?? "conversation.draftTitleCodex");
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
    supportsInterrupt: false,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: true,
    supportsAttachments: true,
    supportsPermissionPrompt: true,
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

// 不同 provider 可能需要不同图标外观，这里统一入口
export function getProviderIconVariant(provider: ProviderId | null): ProviderIconVariant {
  return getProviderMetadata(provider)?.iconVariant ?? "generic";
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
