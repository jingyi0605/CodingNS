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
  supportsRunSteeringByDefault?: boolean;
  supportsQueueWhileRunningByDefault?: boolean;
  foldRulesMessagesByDefault?: boolean;
}

export const REGISTERED_PROVIDER_IDS: BuiltinProviderId[] = [
  "claude-code",
  "codex",
  "opencode",
  "gemini",
  "kimi"
];

export const SESSION_PROVIDER_PICKER_IDS: BuiltinProviderId[] = [
  "codex",
  "claude-code",
  "opencode",
  "gemini",
  "kimi"
];

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
    supportsRunSteeringByDefault: true,
    foldRulesMessagesByDefault: false
  },
  codex: {
    displayNameKey: "conversation.providerCodex",
    draftTitleKey: "conversation.draftTitleCodex",
    defaultModelLabelKey: "conversation.modelUseCliDefault",
    icon: codexIcon,
    defaultRunInputMode: "streaming_guidance",
    reasoningLevelPersists: true,
    defaultReasoningLevel: null,
    supportsSlashMenuByDefault: false,
    supportsRunSteeringByDefault: true,
    supportsQueueWhileRunningByDefault: true,
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

const BUNDLED_PROVIDER_ICONS = Array.from(
  new Set(Object.values(PROVIDER_METADATA).map((metadata) => metadata.icon))
);

let providerIconsWarmed = false;

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

export function isDraftProviderSupported(value: string | null): value is ProviderId {
  return Boolean(value && getProviderMetadata(value));
}

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

export function warmProviderIconCache() {
  if (providerIconsWarmed || typeof window === "undefined") {
    return;
  }

  providerIconsWarmed = true;

  BUNDLED_PROVIDER_ICONS.forEach((icon) => {
    const image = new window.Image();
    image.decoding = "async";
    image.src = icon;

    if (typeof image.decode === "function") {
      void image.decode().catch(() => undefined);
    }
  });
}

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
    supportsRunSteering: metadata?.supportsRunSteeringByDefault,
    supportsQueueWhileRunning: metadata?.supportsQueueWhileRunningByDefault,
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

  const provider = capabilities?.provider ?? null;
  const providerDefault = getProviderMetadata(provider)?.supportsQueueWhileRunningByDefault;

  if (providerDefault !== undefined) {
    return providerDefault;
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

  const provider = capabilities?.provider ?? null;
  return getProviderMetadata(provider)?.supportsRunSteeringByDefault
    ?? capabilities?.inRunInputMode === "streaming_guidance";
}

export function shouldPersistReasoningLevel(provider: ProviderId): boolean {
  const metadata = getProviderMetadata(provider);
  return metadata?.reasoningLevelPersists ?? false;
}

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

if (typeof window !== "undefined") {
  warmProviderIconCache();
}
