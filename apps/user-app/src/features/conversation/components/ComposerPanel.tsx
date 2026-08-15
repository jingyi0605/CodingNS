import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type Ref } from "react";
import { createPortal } from "react-dom";

import {
  ModalActions,
  ModalList,
  ModalListItem,
  ModalSection
} from "../../../components/ModalAtoms";
import { DesktopModal } from "../../../components/DesktopModal";
import { MobileSheet } from "../../../components/MobileSheet";
import { usePlatform } from "../../../platform/platform-provider";
import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import { normalizeTargetHostId } from "../../workbench/utils/resource-scope";
import {
  updatePreferences,
  usePreferencesSelector
} from "../../../preferences/preferences-store";
import { isPreferenceProviderId } from "../../../preferences/user-preference-store";
import { decideCapability } from "../capability/capability-gate";
import {
  allowsQueueDuringRun,
  createDraftCapabilities,
  getProviderDisplayName,
  getProviderFromCapabilities,
  shouldPersistReasoningLevel,
  shouldShowSlashMenu,
  shouldSupportRunSteering,
  supportsReasoningSelector
} from "../capability/provider-ui";
import { useEnabledProviderCatalog } from "../capability/use-enabled-provider-catalog";
import type {
  AttachmentPayload,
  ContextUsageDto,
  ForkSourceMessageSnapshotDto,
  MessageAttachmentDto,
  ProviderCapabilitiesDto,
  ProviderId,
  ProviderSessionStatValueDto,
  ProviderSessionStatMetricDto,
  ProviderSessionStatsDto,
  SessionRuntimePermissionStatusDto,
  SessionProviderConfigMode
} from "../api/conversation-api";
import type { SessionMessageViewModel } from "../runtime/session-runtime-machine";
import type { PreferenceReasoningLevel as ReasoningLevel } from "../../../preferences/types";
import {
  getProviderCapabilities,
  listProviderCapabilities,
  listQuickPhrases,
  replaceQuickPhrases
} from "../api/conversation-api";
import {
  fetchModelManagementSnapshot,
  type ModelManagementAppSnapshotDto,
  type ModelSwitchAppId
} from "../../settings/api/model-switch-api";
import { WorkbenchModal } from "./WorkbenchModal";
import { SessionTaskProgressButton } from "./SessionTaskProgressButton";
import { MacSelect, type MacSelectOption } from "./MacSelect";
import {
  createDeploymentPresetOptions,
  DeploymentMacSelect,
  GLOBAL_DEFAULT_PRESET_VALUE,
  isProviderDefaultModel,
  mapProviderToModelSwitchApp,
  normalizeProviderSelection,
  PROVIDER_DEFAULT_MODEL_ID,
  shouldShowDeploymentPresetColumn,
  type DeploymentPresetOption
} from "./provider-deployment";
import {
  clearComposerDraftRecord,
  createQuickPhraseRecord,
  DEFAULT_QUICK_PHRASES,
  persistComposerDraftRecord,
  readComposerDraftRecord,
  type QuickPhraseRecord,
  type StoredComposerDraftAttachment
} from "./composer-local-storage";
import { useWorkbenchShell } from "./WorkbenchLayout";
import {
  searchComposerMentionItems,
  type ComposerMentionFileItemDto,
  type ComposerMentionSkillItemDto
} from "../api/composer-mention-api";

export { resolveMacSelectPopoverWidth as resolveComposerMacSelectPopoverWidth } from "./MacSelect";

interface ComposerPanelProps {
  capabilities: ProviderCapabilitiesDto | null;
  placeholder?: string;
  draftStorageId?: string;
  initialModel?: string | null;
  workspaceId?: string | null;
  initialProviderConfigMode?: SessionProviderConfigMode;
  initialProviderPresetId?: string | null;
  onSessionSelectionChange?: (selection: {
    selectedModel: string | null;
    providerConfigMode: SessionProviderConfigMode;
    providerPresetId: string | null;
  }) => Promise<void>;
  forkDraft?: {
    sourceMessageId: string;
    sourceMessageSnapshot: ForkSourceMessageSnapshotDto;
    content: string;
    sourceProvider: ProviderId;
    workspaceId: string;
    targetProvider: ProviderId;
    targetModel: string | null;
    targetProviderConfigMode?: SessionProviderConfigMode;
    targetProviderPresetId?: string | null;
  } | null;
  onClearForkDraft?: () => void;
  onForkDraftChange?: (
    forkDraft: {
      sourceMessageId: string;
      sourceMessageSnapshot: ForkSourceMessageSnapshotDto;
      content: string;
      sourceProvider: ProviderId;
      workspaceId: string;
      targetProvider: ProviderId;
      targetModel: string | null;
      targetProviderConfigMode?: SessionProviderConfigMode;
      targetProviderPresetId?: string | null;
    } | null
  ) => void;
  panelRef?: Ref<HTMLElement>;
  portalContainer?: Element | null;
  hasActiveRun?: boolean | null;
  canInterrupt?: boolean | null;
  contextUsage?: ContextUsageDto | null;
  sessionStats?: ProviderSessionStatsDto | null;
  permissionStatus?: SessionRuntimePermissionStatusDto | null;
  taskProvider?: ProviderId | null;
  taskMessages?: SessionMessageViewModel[];
  hasPendingQueuedMessages?: boolean;
  isSubmitting: boolean;
  isRunning?: boolean;
  onInterrupt?: () => Promise<void> | void;
  onQueueSend?: (
    content: string,
    options?: {
      model?: string;
      reasoningLevel?: string;
      providerConfigMode?: SessionProviderConfigMode;
      providerPresetId?: string | null;
      attachments?: AttachmentPayload[];
      attachmentMeta?: MessageAttachmentDto[];
    }
  ) => Promise<void>;
  onSend: (
    content: string,
    options?: {
      model?: string;
      reasoningLevel?: string;
      providerConfigMode?: SessionProviderConfigMode;
      providerPresetId?: string | null;
      attachments?: AttachmentPayload[];
      attachmentMeta?: MessageAttachmentDto[];
    }
  ) => Promise<void>;
}

type ComposerMentionItem =
  | {
      id: string;
      type: "skill";
      name: string;
      subtitle: string;
      insertText: string;
    }
  | {
      id: string;
      type: "file";
      name: string;
      subtitle: string;
      insertText: string;
    };

type ComposerMentionSelection =
  | {
      id: string;
      type: "skill";
      label: string;
      token: string;
    }
  | {
      id: string;
      type: "file";
      label: string;
      token: string;
    };

type ParsedMentionDraft = {
  selections: ComposerMentionSelection[];
  plainText: string;
};

type ModelOption = {
  id: string;
  name: string;
  provider: ProviderId;
  usesProviderDefault?: boolean;
  supportedReasoningEfforts?: ReasoningLevel[];
  defaultReasoningEffort?: ReasoningLevel | null;
};

interface ComposerAttachment {
  id: string;
  file: File;
  kind: "image" | "file";
  previewUrl: string | null;
}

type ComposerSelectOption = MacSelectOption;

const FOCUS_COMPOSER_EVENT = "workbench:focus-composer";
const FORK_PROVIDER_IDS: ProviderId[] = [
  "codex",
  "claude-code",
  "opencode",
  "gemini",
  "kimi",
  "deepseek-harness"
];
const RECONSTRUCTED_FORK_TARGET_PROVIDERS = new Set<ProviderId>([
  "codex",
  "claude-code",
  "opencode",
  "deepseek-harness"
]);
const NATIVE_FORK_PROVIDERS = new Set<ProviderId>([
  "codex",
  "claude-code",
  "opencode",
  "deepseek-harness"
]);
const HIDDEN_FILE_INPUT_STYLE: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0
};

const composerDeploymentSnapshotCache = new Map<string, ModelManagementAppSnapshotDto>();

function buildComposerDeploymentSnapshotCacheKey(
  app: ModelSwitchAppId,
  targetHostId?: string | null
): string {
  const hostKey = normalizeTargetHostId(targetHostId) ?? "current";
  return `${hostKey}::${app}`;
}

function createFallbackModelOptions(provider: ProviderId): ModelOption[] {
  return [
    {
      id: PROVIDER_DEFAULT_MODEL_ID,
      name: t("conversation.modelUseCliDefault"),
      provider,
      usesProviderDefault: true
    }
  ];
}

function getFallbackModelOptions(provider: ProviderId): ModelOption[] {
  return createFallbackModelOptions(provider);
}

function getModelStorageKey(provider: ProviderId): string {
  return `composer-selected-model:${provider}`;
}

function getReasoningStorageKey(provider: ProviderId): string {
  return `composer-reasoning-level:${provider}`;
}

function createAttachmentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openFileInput(input: HTMLInputElement | null): void {
  if (!input) {
    return;
  }

  input.value = "";

  try {
    const showPicker = (input as HTMLInputElement & { showPicker?: () => void }).showPicker;

    if (typeof showPicker === "function") {
      showPicker.call(input);
      return;
    }
  } catch {
    // 某些移动端 WebView 会拒绝 showPicker，这里退回到 click。
  }

  input.click();
}

function base64ToFile(
  fileName: string,
  mimeType: string,
  contentBase64: string,
  lastModified: number
): File {
  const binary = globalThis.atob(contentBase64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return new File([bytes], fileName, {
    type: mimeType,
    lastModified
  });
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.trim().toLowerCase().startsWith("image/");
}

function resolveAttachmentMimeType(file: File): string {
  const normalized = file.type.trim().toLowerCase();
  return normalized.length > 0 ? normalized : "application/octet-stream";
}

function resolveAttachmentKind(file: File): "image" | "file" {
  return isImageMimeType(resolveAttachmentMimeType(file)) ? "image" : "file";
}

function createComposerAttachment(file: File, id = createAttachmentId()): ComposerAttachment {
  const kind = resolveAttachmentKind(file);

  return {
    id,
    file,
    kind,
    previewUrl: kind === "image" ? URL.createObjectURL(file) : null
  };
}

function restoreDraftAttachment(
  attachment: StoredComposerDraftAttachment
): ComposerAttachment {
  const file = base64ToFile(
    attachment.fileName,
    attachment.mimeType,
    attachment.contentBase64,
    attachment.lastModified
  );

  return createComposerAttachment(file, attachment.id);
}

function formatAttachmentSize(fileSize: number): string {
  if (fileSize < 1024) {
    return `${fileSize} B`;
  }

  if (fileSize < 1024 * 1024) {
    return `${(fileSize / 1024).toFixed(1)} KB`;
  }

  return `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
}

function buildForkDraftPreview(content: string): string {
  const normalized = content.trim().replace(/\s+/g, " ");

  if (normalized.length === 0) {
    return t("conversation.forkDraftEmpty");
  }

  return normalized.length > 140 ? `${normalized.slice(0, 140)}…` : normalized;
}

function extractMentionKeyword(content: string): string | null {
  const match = content.match(/(?:^|\s)@([^\s@]*)$/);

  if (!match) {
    return null;
  }

  return match[1] ?? "";
}

function replaceActiveMentionToken(content: string, insertText: string): string {
  return content.replace(/@([^\s@]*)$/, `${insertText} `);
}

function mapMentionSkillItem(item: ComposerMentionSkillItemDto): ComposerMentionItem {
  return {
    id: `skill:${item.id}`,
    type: "skill",
    name: item.name,
    subtitle: item.description,
    insertText: `@skill:${item.name}`
  };
}

function mapMentionFileItem(item: ComposerMentionFileItemDto): ComposerMentionItem {
  return {
    id: `file:${item.path}`,
    type: "file",
    name: item.name,
    subtitle: item.path,
    insertText: `@file:${item.path}`
  };
}

function parseMentionSelections(content: string): ComposerMentionSelection[] {
  const matches = Array.from(content.matchAll(/@(skill|file):([^\s]+)/g));

  return matches.map((match, index) => {
    const type = match[1] === "skill" ? "skill" : "file";
    const label = match[2] ?? "";
    const token = match[0] ?? "";

    return {
      id: `${type}:${label}:${index}`,
      type,
      label,
      token
    };
  });
}

function parseMentionDraft(content: string): ParsedMentionDraft {
  const selections = parseMentionSelections(content).map((item) => ({
    ...item,
    id: createMentionSelectionId(item.type, item.label)
  }));
  const plainText = content
    .replace(/@(skill|file):([^\s]+)/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return {
    selections,
    plainText
  };
}

function buildRawComposerContent(
  selections: ComposerMentionSelection[],
  plainText: string
): string {
  const tokenSegment = selections.map((item) => item.token).join(" ").trim();
  const textSegment = plainText.trim();

  if (tokenSegment && textSegment) {
    return `${tokenSegment}\n${textSegment}`;
  }

  return tokenSegment || textSegment;
}

function createMentionSelectionId(type: "skill" | "file", label: string): string {
  return `${type}:${label}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function resolveForkProviderDisabledReason(
  sourceProvider: ProviderId,
  candidateProvider: ProviderId
): string | null {
  if (candidateProvider === sourceProvider) {
    return NATIVE_FORK_PROVIDERS.has(candidateProvider)
      ? null
      : t("conversation.forkProviderNativeUnsupported");
  }

  return RECONSTRUCTED_FORK_TARGET_PROVIDERS.has(candidateProvider)
    ? null
    : t("conversation.forkProviderReconstructedUnsupported");
}

function isProviderStartDisabled(capabilities: ProviderCapabilitiesDto | null): boolean {
  return capabilities?.canStartSession === false;
}

function getProviderStartDisabledReason(capabilities: ProviderCapabilitiesDto | null): string | null {
  if (!isProviderStartDisabled(capabilities)) {
    return null;
  }

  return capabilities?.limitations[0] ?? t("conversation.capabilityDenied");
}

function toAttachmentMeta(file: File, id: string): MessageAttachmentDto {
  return {
    id,
    kind: resolveAttachmentKind(file),
    fileName: file.name,
    mimeType: resolveAttachmentMimeType(file),
    fileSize: file.size
  };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(reader.error ?? new Error("FILE_READ_FAILED"));
    };
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const base64 = result.includes(",") ? result.split(",").at(-1) ?? "" : result;
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

function revokeAttachmentPreviews(attachments: ComposerAttachment[]): void {
  attachments.forEach((attachment) => {
    if (!attachment.previewUrl) {
      return;
    }

    URL.revokeObjectURL(attachment.previewUrl);
  });
}

function mergeComposerAttachments(
  current: ComposerAttachment[],
  incomingFiles: File[]
): ComposerAttachment[] {
  const existingKeys = new Set(
    current.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`)
  );
  const next = [...current];

  incomingFiles.forEach((file) => {
    const key = `${file.name}:${file.size}:${file.lastModified}`;

    if (existingKeys.has(key)) {
      return;
    }

    existingKeys.add(key);
    next.push(createComposerAttachment(file));
  });

  return next;
}

function isComposerImeConfirming(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  composing: boolean,
  commitLocked: boolean
): boolean {
  const nativeEvent = event.nativeEvent;

  return (
    nativeEvent.isComposing
    || nativeEvent.keyCode === 229
    || composing
    || commitLocked
  );
}

export function ComposerPanel({
  capabilities,
  placeholder,
  draftStorageId,
  initialModel = null,
  workspaceId = null,
  initialProviderConfigMode = "global-default",
  initialProviderPresetId = null,
  onSessionSelectionChange,
  forkDraft = null,
  onClearForkDraft,
  onForkDraftChange,
  panelRef,
  portalContainer = null,
  hasActiveRun = null,
  canInterrupt = null,
  contextUsage = null,
  sessionStats = null,
  taskProvider = null,
  taskMessages = [],
  hasPendingQueuedMessages = false,
  isSubmitting,
  isRunning = false,
  onInterrupt,
  onQueueSend,
  onSend
}: ComposerPanelProps) {
  const platform = usePlatform();
  const libraryInputId = useId();
  const cameraInputId = useId();
  const [content, setContent] = useState("");
  const [mentionSelections, setMentionSelections] = useState<ComposerMentionSelection[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>("medium");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachmentSheetOpen, setAttachmentSheetOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [quickPhrases, setQuickPhrases] = useState<QuickPhraseRecord[]>(DEFAULT_QUICK_PHRASES);
  const [quickPhraseModalOpen, setQuickPhraseModalOpen] = useState(false);
  const [quickPhraseCreateModalOpen, setQuickPhraseCreateModalOpen] = useState(false);
  const [quickPhraseDraft, setQuickPhraseDraft] = useState("");
  const [quickPhraseSaving, setQuickPhraseSaving] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [mentionItems, setMentionItems] = useState<ComposerMentionItem[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [interrupting, setInterrupting] = useState(false);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [deploymentSnapshot, setDeploymentSnapshot] = useState<ModelManagementAppSnapshotDto | null>(null);
  const [deploymentSnapshotLoading, setDeploymentSnapshotLoading] = useState(false);
  const [deploymentCapabilities, setDeploymentCapabilities] = useState<ProviderCapabilitiesDto | null>(null);
  const [deploymentCapabilitiesLoading, setDeploymentCapabilitiesLoading] = useState(false);
  const initialProviderSelection = useMemo(
    () => normalizeProviderSelection(initialProviderConfigMode, initialProviderPresetId),
    [initialProviderConfigMode, initialProviderPresetId]
  );
  const [selectedProviderConfigMode, setSelectedProviderConfigMode] =
    useState<SessionProviderConfigMode>(initialProviderSelection.providerConfigMode);
  const [selectedProviderPresetId, setSelectedProviderPresetId] =
    useState<string | null>(initialProviderSelection.providerPresetId);
  const currentProviderSelection = useMemo(
    () => normalizeProviderSelection(selectedProviderConfigMode, selectedProviderPresetId),
    [selectedProviderConfigMode, selectedProviderPresetId]
  );
  const [forkCapabilities, setForkCapabilities] = useState<ProviderCapabilitiesDto | null>(null);
  const [forkCapabilitiesLoading, setForkCapabilitiesLoading] = useState(false);
  const [forkDeploymentSnapshot, setForkDeploymentSnapshot] =
    useState<ModelManagementAppSnapshotDto | null>(null);
  const [forkDeploymentSnapshotLoading, setForkDeploymentSnapshotLoading] = useState(false);
  const [forkProviderConfigMode, setForkProviderConfigMode] =
    useState<SessionProviderConfigMode>("global-default");
  const [forkProviderPresetId, setForkProviderPresetId] = useState<string | null>(null);
  const [forkProviderCapabilities, setForkProviderCapabilities] = useState<
    Partial<Record<ProviderId, ProviderCapabilitiesDto>>
  >({});
  const [pendingCrossProvider, setPendingCrossProvider] = useState<ProviderId | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const submitLockRef = useRef(false);
  const pendingSessionSelectionWriteRef = useRef<Promise<void>>(Promise.resolve());
  const composingRef = useRef(false);
  const compositionCommitLockRef = useRef(false);
  const compositionCommitUnlockTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const attachmentRegistryRef = useRef(new Set<string>());
  const attachmentDraftCacheRef = useRef(new Map<string, StoredComposerDraftAttachment>());
  const quickPhraseMutationVersionRef = useRef(0);
  const appliedInitialModelKeyRef = useRef<string | null>(null);
  const userSelectedModelRef = useRef(false);
  const userSelectedReasoningLevelRef = useRef(false);
  const mentionRequestIdRef = useRef(0);
  const deploymentCapabilitiesRequestIdRef = useRef(0);
  const forkCapabilitiesRequestIdRef = useRef(0);
  const forkProviderCapabilitiesRequestIdRef = useRef(0);
  const deploymentCapabilitiesAbortRef = useRef<AbortController | null>(null);
  const forkCapabilitiesAbortRef = useRef<AbortController | null>(null);
  const forkProviderCapabilitiesAbortRef = useRef<AbortController | null>(null);
  const { showToast } = useToast();
  const haptics = useHaptics();
  const { revealWorkspaceFile, currentTargetHostId } = useWorkbenchShell();

  const clearCompositionCommitLock = useCallback(() => {
    if (compositionCommitUnlockTimerRef.current !== null) {
      globalThis.clearTimeout(compositionCommitUnlockTimerRef.current);
      compositionCommitUnlockTimerRef.current = null;
    }

    compositionCommitLockRef.current = false;
  }, []);

  useEffect(() => clearCompositionCommitLock, [clearCompositionCommitLock]);

  const provider = capabilities?.provider ?? taskProvider ?? getProviderFromCapabilities(capabilities);
  const modelSwitchApp = mapProviderToModelSwitchApp(provider);
  const accountProviderPreferences = usePreferencesSelector((state) =>
    isPreferenceProviderId(provider) ? state.profile.providers[provider] : null
  );
  const accountPreferredModel = accountProviderPreferences?.defaultModel ?? null;
  const accountPreferredReasoningLevel =
    accountProviderPreferences?.defaultReasoningLevel ?? null;

  useEffect(() => {
    const nextSelection = normalizeProviderSelection(initialProviderConfigMode, initialProviderPresetId);
    setSelectedProviderConfigMode(nextSelection.providerConfigMode);
    setSelectedProviderPresetId(nextSelection.providerPresetId);
  }, [draftStorageId, initialProviderConfigMode, initialProviderPresetId, provider]);

  useEffect(() => {
    if (!forkDraft) {
      setForkProviderConfigMode("global-default");
      setForkProviderPresetId(null);
      return;
    }

    if (mapProviderToModelSwitchApp(forkDraft.targetProvider)) {
      const nextSelection = normalizeProviderSelection(
        forkDraft.targetProviderConfigMode,
        forkDraft.targetProviderPresetId
      );
      setForkProviderConfigMode(nextSelection.providerConfigMode);
      setForkProviderPresetId(nextSelection.providerPresetId);
      return;
    }

    setForkProviderConfigMode("global-default");
    setForkProviderPresetId(null);
  }, [forkDraft]);

  useEffect(() => {
    if (!modelSwitchApp) {
      setDeploymentSnapshot(null);
      setDeploymentSnapshotLoading(false);
      return;
    }

    const cacheKey = buildComposerDeploymentSnapshotCacheKey(modelSwitchApp, currentTargetHostId);
    const cached = composerDeploymentSnapshotCache.get(cacheKey) ?? null;

    if (cached) {
      setDeploymentSnapshot(cached);
    }

    let cancelled = false;
    setDeploymentSnapshotLoading(!cached);

    void fetchModelManagementSnapshot({ targetHostId: currentTargetHostId })
      .then((response) => {
        response.items.forEach((item) => {
          composerDeploymentSnapshotCache.set(
            buildComposerDeploymentSnapshotCacheKey(item.app, currentTargetHostId),
            item
          );
        });

        if (!cancelled) {
          setDeploymentSnapshot(composerDeploymentSnapshotCache.get(cacheKey) ?? null);
        }
      })
      .catch(() => {
        if (!cancelled && !cached) {
          setDeploymentSnapshot(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDeploymentSnapshotLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentTargetHostId, modelSwitchApp]);

  useEffect(() => {
    const forkApp = forkDraft ? mapProviderToModelSwitchApp(forkDraft.targetProvider) : null;

    if (!forkApp) {
      setForkDeploymentSnapshot(null);
      setForkDeploymentSnapshotLoading(false);
      return;
    }

    const cacheKey = buildComposerDeploymentSnapshotCacheKey(forkApp, currentTargetHostId);
    const cached = composerDeploymentSnapshotCache.get(cacheKey) ?? null;

    if (cached) {
      setForkDeploymentSnapshot(cached);
    }

    let cancelled = false;
    setForkDeploymentSnapshotLoading(!cached);

    void fetchModelManagementSnapshot({ targetHostId: currentTargetHostId })
      .then((response) => {
        response.items.forEach((item) => {
          composerDeploymentSnapshotCache.set(
            buildComposerDeploymentSnapshotCacheKey(item.app, currentTargetHostId),
            item
          );
        });

        if (!cancelled) {
          setForkDeploymentSnapshot(composerDeploymentSnapshotCache.get(cacheKey) ?? null);
        }
      })
      .catch(() => {
        if (!cancelled && !cached) {
          setForkDeploymentSnapshot(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setForkDeploymentSnapshotLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentTargetHostId, forkDraft]);

  useEffect(() => {
    if (selectedProviderConfigMode !== "cc-switch-preset") {
      return;
    }

    if (!selectedProviderPresetId) {
      setSelectedProviderConfigMode("global-default");
      return;
    }

    if (
      deploymentSnapshot
      && !deploymentSnapshot.options.some((option) => option.id === selectedProviderPresetId)
    ) {
      setSelectedProviderConfigMode("global-default");
      setSelectedProviderPresetId(null);
    }
  }, [deploymentSnapshot, selectedProviderConfigMode, selectedProviderPresetId]);

  useEffect(() => {
    if (
      selectedProviderConfigMode !== "cc-switch-preset"
      || !selectedProviderPresetId
      || !workspaceId?.trim()
    ) {
      setDeploymentCapabilities(null);
      setDeploymentCapabilitiesLoading(false);
      return;
    }

    const requestId = deploymentCapabilitiesRequestIdRef.current + 1;
    deploymentCapabilitiesRequestIdRef.current = requestId;
    deploymentCapabilitiesAbortRef.current?.abort();
    const abortController = new AbortController();
    deploymentCapabilitiesAbortRef.current = abortController;
    let cancelled = false;
    setDeploymentCapabilitiesLoading(true);

    void getProviderCapabilities(provider, workspaceId, {
      providerConfigMode: "cc-switch-preset",
      providerPresetId: selectedProviderPresetId
    }, {
      targetHostId: currentTargetHostId,
      signal: abortController.signal
    })
      .then((nextCapabilities) => {
        if (!cancelled && requestId === deploymentCapabilitiesRequestIdRef.current) {
          setDeploymentCapabilities(nextCapabilities);
        }
      })
      .catch(() => {
        if (!cancelled && requestId === deploymentCapabilitiesRequestIdRef.current) {
          setDeploymentCapabilities(null);
        }
      })
      .finally(() => {
        if (!cancelled && requestId === deploymentCapabilitiesRequestIdRef.current) {
          deploymentCapabilitiesAbortRef.current = null;
          setDeploymentCapabilitiesLoading(false);
        }
      });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [currentTargetHostId, provider, selectedProviderConfigMode, selectedProviderPresetId, workspaceId]);

  useEffect(() => {
    if (
      !forkDraft
      || forkProviderConfigMode !== "cc-switch-preset"
    ) {
      return;
    }

    if (!forkProviderPresetId) {
      setForkProviderConfigMode("global-default");
      return;
    }

    if (
      forkDeploymentSnapshot
      && !forkDeploymentSnapshot.options.some((option) => option.id === forkProviderPresetId)
    ) {
      setForkProviderConfigMode("global-default");
      setForkProviderPresetId(null);
    }
  }, [forkDeploymentSnapshot, forkDraft, forkProviderConfigMode, forkProviderPresetId]);

  const sendDecision = useMemo(
    () => decideCapability(capabilities, "send_message"),
    [capabilities]
  );
  const interruptDecision = useMemo(
    () => decideCapability(capabilities, "interrupt"),
    [capabilities]
  );
  const attachmentDecision = useMemo(
    () => decideCapability(capabilities, "attachments"),
    [capabilities]
  );
  const effectiveCapabilities = useMemo(() => {
    if (selectedProviderConfigMode !== "cc-switch-preset") {
      return capabilities;
    }

    return deploymentCapabilities ?? capabilities;
  }, [capabilities, deploymentCapabilities, selectedProviderConfigMode]);
  const availableModels = useMemo(() => {
    const providerModels = effectiveCapabilities?.modelOptions?.map((model) => ({
      ...model,
      provider,
      supportedReasoningEfforts: model.supportedReasoningEfforts?.filter(
        (effort): effort is ReasoningLevel =>
          effort === "off"
          || effort === "minimal"
          || effort === "low"
          || effort === "medium"
          || effort === "high"
          || effort === "xhigh"
          || effort === "max"
          || effort === "ultra"
      ),
      defaultReasoningEffort: normalizeModelReasoningLevel(model.defaultReasoningEffort)
    }));

    if (providerModels?.length) {
      return providerModels;
    }

    return getFallbackModelOptions(provider);
  }, [effectiveCapabilities?.modelOptions, provider]);
  const deploymentPresetOptions = useMemo<DeploymentPresetOption[]>(
    () => createDeploymentPresetOptions(deploymentSnapshot),
    [deploymentSnapshot]
  );
  const selectedPresetValue = selectedProviderConfigMode === "cc-switch-preset"
    ? selectedProviderPresetId ?? GLOBAL_DEFAULT_PRESET_VALUE
    : GLOBAL_DEFAULT_PRESET_VALUE;
  const selectedPresetOption = useMemo(
    () => deploymentPresetOptions.find((option) => option.value === selectedPresetValue) ?? deploymentPresetOptions[0] ?? null,
    [deploymentPresetOptions, selectedPresetValue]
  );
  const selectedModelOption = useMemo(
    () => availableModels.find((model) => model.id === selectedModel) ?? null,
    [availableModels, selectedModel]
  );
  const reasoningSelectorEnabled = supportsReasoningSelector(capabilities);
  const slashMenuEnabled = shouldShowSlashMenu(capabilities);
  const reasoningLevelCatalog = useMemo(
    () => [
      { value: "off" as const, label: t("conversation.reasoningOff") },
      { value: "minimal" as const, label: t("conversation.reasoningMinimal") },
      { value: "low" as const, label: t("conversation.reasoningLow") },
      { value: "medium" as const, label: t("conversation.reasoningMedium") },
      { value: "high" as const, label: t("conversation.reasoningHigh") },
      { value: "xhigh" as const, label: t("conversation.reasoningExtraHigh") },
      { value: "max" as const, label: t("conversation.reasoningMaximum") },
      { value: "ultra" as const, label: t("conversation.reasoningUltra") }
    ],
    []
  );
  const availableReasoningLevels = useMemo(() => {
    if (!reasoningSelectorEnabled) {
      return [];
    }

    const supportedEfforts = selectedModelOption?.supportedReasoningEfforts;

    if (!supportedEfforts) {
      return reasoningLevelCatalog;
    }

    return reasoningLevelCatalog.filter((level) => supportedEfforts.includes(level.value));
  }, [reasoningSelectorEnabled, reasoningLevelCatalog, selectedModelOption?.supportedReasoningEfforts]);
  const modelSelectOptions = useMemo<ComposerSelectOption[]>(
    () =>
      availableModels.map((model) => ({
        value: model.id,
        label: isProviderDefaultModel(model) ? t("conversation.modelUseCliDefault") : model.name
      })),
    [availableModels]
  );
  const showDeploymentPresetColumn = useMemo(
    () => shouldShowDeploymentPresetColumn(deploymentSnapshot),
    [deploymentSnapshot]
  );
  const deploymentTriggerLabel = useMemo(() => {
    const modelLabel = selectedModelOption
      ? (isProviderDefaultModel(selectedModelOption) ? t("conversation.modelUseCliDefault") : selectedModelOption.name)
      : t("conversation.modelUseCliDefault");
    if (!showDeploymentPresetColumn) {
      return modelLabel;
    }
    const presetLabel = selectedPresetOption?.label ?? t("conversation.deploymentDefaultPreset");

    return `${presetLabel} · ${modelLabel}`;
  }, [selectedModelOption, selectedPresetOption, showDeploymentPresetColumn]);
  const reasoningSelectOptions = useMemo<ComposerSelectOption[]>(
    () =>
      availableReasoningLevels.map((level) => ({
        value: level.value,
        label: level.label
      })),
    [availableReasoningLevels]
  );
  const slashCommands = useMemo(
    () => [
      { command: "/plan", label: t("conversation.slashCommandPlan") },
      { command: "/review", label: t("conversation.slashCommandReview") },
      { command: "/explain", label: t("conversation.slashCommandExplain") }
    ],
    []
  );
  const providerForMention = capabilities?.provider ?? taskProvider ?? null;
  const inRunInputMode = capabilities?.inRunInputMode ?? "none";
  const hasForkDraft = Boolean(forkDraft);
  const { visibleProviders: visibleCatalogForkProviders } = useEnabledProviderCatalog(
    FORK_PROVIDER_IDS,
    hasForkDraft,
    currentTargetHostId
  );
  const activeForkProvider = forkDraft?.targetProvider ?? null;
  const forkModelSwitchApp = mapProviderToModelSwitchApp(activeForkProvider);
  const forkProviderSelection = useMemo(
    () => normalizeProviderSelection(forkProviderConfigMode, forkProviderPresetId),
    [forkProviderConfigMode, forkProviderPresetId]
  );
  const shouldReuseSessionCapabilitiesForFork =
    Boolean(forkDraft)
    && capabilities?.provider === activeForkProvider
    && currentProviderSelection.providerConfigMode === forkProviderSelection.providerConfigMode
    && currentProviderSelection.providerPresetId === forkProviderSelection.providerPresetId;
  const effectiveForkCapabilities = useMemo(() => {
    if (!forkDraft) {
      return null;
    }

    if (shouldReuseSessionCapabilitiesForFork) {
      return capabilities;
    }

    return forkCapabilities ?? createDraftCapabilities(forkDraft.targetProvider);
  }, [capabilities, forkCapabilities, forkDraft, shouldReuseSessionCapabilitiesForFork]);
  const forkAvailableModels = useMemo<ModelOption[]>(() => {
    if (!forkDraft) {
      return [];
    }

    const providerModels = effectiveForkCapabilities?.modelOptions?.map((model) => ({
      ...model,
      provider: forkDraft.targetProvider,
      supportedReasoningEfforts: model.supportedReasoningEfforts?.filter(
        (effort): effort is ReasoningLevel =>
          effort === "off"
          || effort === "minimal"
          || effort === "low"
          || effort === "medium"
          || effort === "high"
          || effort === "xhigh"
          || effort === "max"
          || effort === "ultra"
      ),
      defaultReasoningEffort: normalizeModelReasoningLevel(model.defaultReasoningEffort)
    }));

    if (providerModels?.length) {
      return providerModels;
    }

    return getFallbackModelOptions(forkDraft.targetProvider);
  }, [effectiveForkCapabilities?.modelOptions, forkDraft]);
  const forkModelSelectOptions = useMemo<ComposerSelectOption[]>(
    () =>
      forkAvailableModels.map((model) => ({
        value: model.id,
        label: isProviderDefaultModel(model) ? t("conversation.modelUseCliDefault") : model.name
      })),
    [forkAvailableModels]
  );
  const forkSelectedModelId = useMemo(() => {
    if (!forkDraft || !forkDraft.targetModel) {
      return PROVIDER_DEFAULT_MODEL_ID;
    }

    return forkAvailableModels.some((model) => model.id === forkDraft.targetModel)
      ? forkDraft.targetModel
      : PROVIDER_DEFAULT_MODEL_ID;
  }, [forkAvailableModels, forkDraft]);
  const forkDeploymentPresetOptions = useMemo<DeploymentPresetOption[]>(
    () => createDeploymentPresetOptions(forkDeploymentSnapshot),
    [forkDeploymentSnapshot]
  );
  const forkSelectedPresetValue = forkProviderSelection.providerConfigMode === "cc-switch-preset"
    ? forkProviderSelection.providerPresetId ?? GLOBAL_DEFAULT_PRESET_VALUE
    : GLOBAL_DEFAULT_PRESET_VALUE;
  const forkSelectedPresetOption = useMemo(
    () =>
      forkDeploymentPresetOptions.find((option) => option.value === forkSelectedPresetValue)
      ?? forkDeploymentPresetOptions[0]
      ?? null,
    [forkDeploymentPresetOptions, forkSelectedPresetValue]
  );
  const forkSelectedModelOption = useMemo(
    () => forkAvailableModels.find((model) => model.id === forkSelectedModelId) ?? null,
    [forkAvailableModels, forkSelectedModelId]
  );
  const showForkDeploymentPresetColumn = useMemo(
    () => shouldShowDeploymentPresetColumn(forkDeploymentSnapshot),
    [forkDeploymentSnapshot]
  );
  const forkDeploymentTriggerLabel = useMemo(() => {
    const modelLabel = forkSelectedModelOption
      ? (isProviderDefaultModel(forkSelectedModelOption) ? t("conversation.modelUseCliDefault") : forkSelectedModelOption.name)
      : t("conversation.modelUseCliDefault");
    if (!showForkDeploymentPresetColumn) {
      return modelLabel;
    }
    const presetLabel = forkSelectedPresetOption?.label ?? t("conversation.deploymentDefaultPreset");

    return `${presetLabel} · ${modelLabel}`;
  }, [forkSelectedModelOption, forkSelectedPresetOption, showForkDeploymentPresetColumn]);
  const selectableForkProviders = useMemo(() => {
    if (!forkDraft) {
      return [];
    }

    return visibleCatalogForkProviders.filter(
      (candidateProvider) => {
        if (resolveForkProviderDisabledReason(forkDraft.sourceProvider, candidateProvider) !== null) {
          return false;
        }

        return !isProviderStartDisabled(forkProviderCapabilities[candidateProvider] ?? null);
      }
    );
  }, [forkDraft, forkProviderCapabilities, visibleCatalogForkProviders]);
  const visibleForkProviders = useMemo(() => {
    if (!forkDraft) {
      return [];
    }

    if (selectableForkProviders.length > 0) {
      return selectableForkProviders;
    }

    return [forkDraft.targetProvider];
  }, [forkDraft, selectableForkProviders]);
  const forkProviderSelectOptions = useMemo<ComposerSelectOption[]>(() => {
    return visibleForkProviders.map((providerId) => ({
      value: providerId,
      label: getProviderDisplayName(providerId, "full")
    }));
  }, [visibleForkProviders]);
  const forkStartDisabledReason = useMemo(() => {
    if (!forkDraft) {
      return null;
    }

    return getProviderStartDisabledReason(
      forkProviderCapabilities[forkDraft.targetProvider] ?? effectiveForkCapabilities ?? null
    );
  }, [effectiveForkCapabilities, forkDraft, forkProviderCapabilities]);
  const runHasActiveFlag = hasActiveRun ?? null;
  // runtime 快照偶发会先抖掉 runningState，这时仍应以 active run 为准，
  // 否则输入框按钮会在“运行中”和“空闲发送”之间来回闪。
  const effectiveIsRunning = isRunning || runHasActiveFlag === true;
  const isUnmanagedStreamingRun =
    effectiveIsRunning &&
    inRunInputMode === "streaming_guidance" &&
    runHasActiveFlag === false &&
    !shouldSupportRunSteering(capabilities);
  const canStreamDuringRun =
    !hasForkDraft &&
    effectiveIsRunning &&
    inRunInputMode === "streaming_guidance" &&
    !isUnmanagedStreamingRun;
  const canQueueDuringRun =
    !hasForkDraft &&
    effectiveIsRunning &&
    typeof onQueueSend === "function" &&
    allowsQueueDuringRun(capabilities, runHasActiveFlag);
  const inRunSendBlocked = !hasForkDraft && effectiveIsRunning && !canStreamDuringRun && !canQueueDuringRun;
  const forkSendBlocked = hasForkDraft && Boolean(forkStartDisabledReason);
  const hasDraft = content.trim().length > 0 || attachments.length > 0;
  const interruptAvailable =
    canInterrupt === false && runHasActiveFlag === true
      ? interruptDecision.allowed
      : canInterrupt ?? interruptDecision.allowed;
  const canInterruptNow =
    effectiveIsRunning && interruptAvailable && Boolean(onInterrupt) && !interrupting;
  const showActivityButton =
    !hasDraft &&
    (
      localSubmitting
      || isSubmitting
      || effectiveIsRunning
      || hasPendingQueuedMessages
    );
  const activityButtonLabel = canInterruptNow
    ? t("conversation.capabilityInterrupt")
    : t("conversation.runtimeRunning");
  const sendButtonLabel = effectiveIsRunning
    ? canQueueDuringRun
        ? t("conversation.queueGuidanceButton")
        : canStreamDuringRun
          ? t("conversation.sendGuidanceButton")
          : t("conversation.sendButton")
    : t("conversation.sendButton");

  const persistSessionSelection = useCallback((selection: {
    selectedModel: string | null;
    providerConfigMode: SessionProviderConfigMode;
    providerPresetId: string | null;
  }): Promise<void> => {
    const write = pendingSessionSelectionWriteRef.current
      .catch(() => undefined)
      .then(async () => {
        if (!onSessionSelectionChange) {
          return;
        }

        try {
          await onSessionSelectionChange(selection);
        } catch (error) {
          showToast({
            title: error instanceof Error ? error.message : t("conversation.capabilityDenied"),
            tone: "error"
          });
        }
      });

    pendingSessionSelectionWriteRef.current = write;
    return write;
  }, [onSessionSelectionChange, showToast]);

  const handleModelChange = useCallback((modelId: string) => {
    userSelectedModelRef.current = true;
    setSelectedModel(modelId);
    persistSessionSelection({
      selectedModel: modelId === PROVIDER_DEFAULT_MODEL_ID ? null : modelId,
      providerConfigMode: currentProviderSelection.providerConfigMode,
      providerPresetId: currentProviderSelection.providerPresetId
    });
  }, [currentProviderSelection, persistSessionSelection]);

  const handleDeploymentPresetChange = useCallback((presetValue: string) => {
    if (presetValue === "__global_default__") {
      setSelectedProviderConfigMode("global-default");
      setSelectedProviderPresetId(null);
      persistSessionSelection({
        selectedModel: selectedModel === PROVIDER_DEFAULT_MODEL_ID ? null : selectedModel || null,
        providerConfigMode: "global-default",
        providerPresetId: null
      });
      return;
    }

    setSelectedProviderConfigMode("cc-switch-preset");
    setSelectedProviderPresetId(presetValue);
    persistSessionSelection({
      selectedModel: selectedModel === PROVIDER_DEFAULT_MODEL_ID ? null : selectedModel || null,
      providerConfigMode: "cc-switch-preset",
      providerPresetId: presetValue
    });
  }, [persistSessionSelection, selectedModel]);

  const handleReasoningLevelChange = useCallback((level: ReasoningLevel) => {
    userSelectedReasoningLevelRef.current = true;
    setReasoningLevel(level);
    if (isPreferenceProviderId(provider)) {
      void updatePreferences({
        providers: {
          [provider]: {
            defaultReasoningLevel: level
          }
        }
      }).catch(() => undefined);
    }
  }, [provider]);

  const replaceAttachments = useCallback((nextAttachments: ComposerAttachment[]) => {
    attachmentRegistryRef.current.forEach((previewUrl) => {
      URL.revokeObjectURL(previewUrl);
    });
    attachmentRegistryRef.current.clear();
    nextAttachments.forEach((attachment) => {
      if (attachment.previewUrl) {
        attachmentRegistryRef.current.add(attachment.previewUrl);
      }
    });
    setAttachments(nextAttachments);
  }, []);

  const mergeAttachments = useCallback((incomingFiles: File[]) => {
    if (incomingFiles.length === 0) {
      return;
    }

    setAttachments((current) => {
      const next = mergeComposerAttachments(current, incomingFiles);

      next.forEach((attachment) => {
        if (attachment.previewUrl) {
          attachmentRegistryRef.current.add(attachment.previewUrl);
        }
      });

      return next;
    });
  }, []);

  const removeAttachment = useCallback((attachmentId: string) => {
    attachmentDraftCacheRef.current.delete(attachmentId);
    setAttachments((current) => {
      const target = current.find((item) => item.id === attachmentId);

      if (target?.previewUrl) {
        attachmentRegistryRef.current.delete(target.previewUrl);
        URL.revokeObjectURL(target.previewUrl);
      }

      return current.filter((item) => item.id !== attachmentId);
    });
  }, []);

  const handleAttachmentInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? []);

    if (nextFiles.length > 0) {
      mergeAttachments(nextFiles);
    }

    event.target.value = "";
  }, [mergeAttachments]);

  const handleComposerDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (platform.isMobile || !attachmentDecision.allowed || inRunSendBlocked) {
      return;
    }

    const hasFiles =
      (event.dataTransfer.files?.length ?? 0) > 0 ||
      Array.from(event.dataTransfer.items ?? []).some((item) => item.kind === "file");

    if (!hasFiles) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";

    if (!dragActive) {
      setDragActive(true);
    }

    setShowSlashMenu(false);
  }, [attachmentDecision.allowed, dragActive, inRunSendBlocked, platform.isMobile]);

  const handleComposerDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget;

    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }

    setDragActive(false);
  }, []);

  const handleComposerDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (platform.isMobile || !attachmentDecision.allowed || inRunSendBlocked) {
      return;
    }

    const droppedFiles = Array.from(event.dataTransfer.files ?? []);

    if (droppedFiles.length === 0) {
      return;
    }

    event.preventDefault();
    setDragActive(false);
    mergeAttachments(droppedFiles);
  }, [attachmentDecision.allowed, inRunSendBlocked, mergeAttachments, platform.isMobile]);

  const triggerNativeAttachmentInput = useCallback((target: "camera" | "library") => {
    if (!attachmentDecision.allowed || inRunSendBlocked) {
      return;
    }

    const input = target === "camera" ? cameraInputRef.current : libraryInputRef.current;

    // 原生移动端不要再依赖 label -> input 的默认行为。
    // 那套写法在 WebView 里很容易被弹层关闭时机吞掉，导致系统选择器和权限申请都不触发。
    openFileInput(input);
    setAttachmentSheetOpen(false);
  }, [attachmentDecision.allowed, inRunSendBlocked]);

  const handleAttachmentButtonClick = useCallback(() => {
    if (!attachmentDecision.allowed || inRunSendBlocked) {
      return;
    }

    setShowSlashMenu(false);

    if (platform.isNativeMobile) {
      void haptics.trigger("selection");
      setAttachmentSheetOpen(true);
      return;
    }

    openFileInput(libraryInputRef.current);
  }, [attachmentDecision.allowed, haptics, inRunSendBlocked, platform.isNativeMobile]);

  const closeMentionMenu = useCallback(() => {
    // 关闭面板时让未完成的旧搜索失效，避免用户已经退出 @ 后，慢请求回来又把面板弹出来。
    mentionRequestIdRef.current += 1;
    setMentionMenuOpen(false);
    setMentionLoading(false);
    setMentionActiveIndex(0);
  }, []);

  const loadMentionItems = useCallback(async (rawKeyword: string) => {
    const requestId = mentionRequestIdRef.current + 1;
    mentionRequestIdRef.current = requestId;
    // 输入 @ 后先把面板打开，慢仓库里搜索还没返回时也要让用户看到“正在加载”。
    setMentionItems([]);
    setMentionActiveIndex(0);
    setMentionMenuOpen(true);
    setMentionLoading(true);

    try {
      const result = await searchComposerMentionItems({
        workspaceId,
        provider: providerForMention,
        keyword: rawKeyword,
        limit: 5,
        targetHostId: currentTargetHostId
      });

      if (mentionRequestIdRef.current !== requestId) {
        return;
      }

      const mappedSkills = result.skills.map((item) => mapMentionSkillItem(item));
      const mappedFiles = result.files.map((item) => mapMentionFileItem(item));
      setMentionItems([...mappedSkills, ...mappedFiles]);
      setMentionActiveIndex(0);
    } catch {
      if (mentionRequestIdRef.current !== requestId) {
        return;
      }

      setMentionItems([]);
      setMentionActiveIndex(0);
    } finally {
      if (mentionRequestIdRef.current === requestId) {
        setMentionLoading(false);
      }
    }
  }, [currentTargetHostId, providerForMention, workspaceId]);

  const applyMentionItem = useCallback((item: ComposerMentionItem) => {
    setMentionSelections((current) => [
      ...current,
      {
        id: createMentionSelectionId(item.type, item.name),
        type: item.type,
        label: item.name,
        token: item.insertText
      }
    ]);
    setContent((current) => replaceActiveMentionToken(current, "").trimStart());
    closeMentionMenu();
    globalThis.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [closeMentionMenu]);

  useEffect(() => {
    const mentionKeyword = extractMentionKeyword(content);

    if (mentionKeyword === null) {
      closeMentionMenu();
      setMentionItems([]);
      return;
    }

    if (!workspaceId?.trim() && mentionKeyword.length > 0) {
      setMentionItems([]);
      setMentionMenuOpen(true);
      setMentionLoading(false);
      return;
    }

    void loadMentionItems(mentionKeyword);
  }, [closeMentionMenu, content, loadMentionItems, workspaceId]);

  useEffect(() => {
    if (mentionItems.length === 0) {
      setMentionActiveIndex(0);
      return;
    }

    setMentionActiveIndex((current) => Math.min(current, mentionItems.length - 1));
  }, [mentionItems]);

  useEffect(() => {
    if (!mentionMenuOpen || mentionItems.length === 0) {
      return;
    }

    const menuElement = mentionMenuRef.current;

    if (!menuElement) {
      return;
    }

    const activeElement = menuElement.querySelector<HTMLElement>(".composer-mention-item.is-active");

    if (!activeElement) {
      return;
    }

    const menuTop = menuElement.scrollTop;
    const menuBottom = menuTop + menuElement.clientHeight;
    const itemTop = activeElement.offsetTop;
    const itemBottom = itemTop + activeElement.offsetHeight;

    if (itemTop < menuTop) {
      menuElement.scrollTop = itemTop;
      return;
    }

    if (itemBottom > menuBottom) {
      menuElement.scrollTop = itemBottom - menuElement.clientHeight;
    }
  }, [mentionActiveIndex, mentionItems, mentionMenuOpen]);

  const handleSlashCommand = useCallback(() => {
    setShowSlashMenu((current) => !current);
  }, []);

  const applySlashCommand = useCallback((command: string) => {
    setContent((current) => {
      const trimmedStart = current.trimStart();

      if (trimmedStart.startsWith(command)) {
        return current;
      }

      return current.trim() ? `${command} ${current.trim()}` : `${command} `;
    });
    setShowSlashMenu(false);
    textareaRef.current?.focus();
  }, []);

  const persistQuickPhrases = useCallback(async (nextPhrases: QuickPhraseRecord[]) => {
    const previousPhrases = quickPhrases;
    quickPhraseMutationVersionRef.current += 1;
    setQuickPhrases(nextPhrases);
    setQuickPhraseSaving(true);

    try {
      const response = await replaceQuickPhrases(
        nextPhrases.map((phrase) => ({
          id: phrase.id,
          text: phrase.text
        }))
      );
      setQuickPhrases(
        response.items.map((phrase) => ({
          id: phrase.id,
          text: phrase.text
        }))
      );
      return true;
    } catch (error) {
      setQuickPhrases(previousPhrases);
      showToast({
        title: error instanceof Error ? error.message : t("conversation.quickPhraseSaveFailed"),
        tone: "error"
      });
      return false;
    } finally {
      setQuickPhraseSaving(false);
    }
  }, [quickPhrases, showToast]);

  const handleQuickPhraseCreate = useCallback(async () => {
    const nextText = quickPhraseDraft.trim();

    if (!nextText) {
      return;
    }

    const saved = await persistQuickPhrases([...quickPhrases, createQuickPhraseRecord(nextText)]);

    if (!saved) {
      return;
    }

    setQuickPhraseDraft("");
    setQuickPhraseCreateModalOpen(false);
  }, [persistQuickPhrases, quickPhraseDraft, quickPhrases]);

  const handleQuickPhraseDelete = useCallback((phraseId: string) => {
    void persistQuickPhrases(quickPhrases.filter((item) => item.id !== phraseId));
  }, [persistQuickPhrases, quickPhrases]);

  const handleQuickPhraseMove = useCallback((phraseId: string, direction: -1 | 1) => {
    const currentIndex = quickPhrases.findIndex((item) => item.id === phraseId);

    if (currentIndex < 0) {
      return;
    }

    const targetIndex = currentIndex + direction;

    if (targetIndex < 0 || targetIndex >= quickPhrases.length) {
      return;
    }

    const nextPhrases = [...quickPhrases];
    const [targetPhrase] = nextPhrases.splice(currentIndex, 1);
    nextPhrases.splice(targetIndex, 0, targetPhrase);
    void persistQuickPhrases(nextPhrases);
  }, [persistQuickPhrases, quickPhrases]);

  const applyQuickPhrase = useCallback((text: string) => {
    setContent(text);
    setQuickPhraseModalOpen(false);
    textareaRef.current?.focus();
  }, []);

  const removeMentionSelection = useCallback((selectionId: string) => {
    setMentionSelections((current) => current.filter((item) => item.id !== selectionId));
    globalThis.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, []);

  const handleMentionChipClick = useCallback((selection: ComposerMentionSelection) => {
    if (selection.type === "file") {
      revealWorkspaceFile({
        workspaceId,
        filePath: selection.label,
        openViewer: false
      });
      return;
    }

    setContent((current) => {
      const normalized = current.trim();
      return normalized.length > 0 ? `${normalized} ${selection.label}` : selection.label;
    });
    globalThis.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [revealWorkspaceFile, workspaceId]);

  const restoreDraftState = useCallback((storageId?: string) => {
    const storedDraft = storageId ? readComposerDraftRecord(storageId) : null;
    const restoredAttachments = storedDraft?.attachments.map((attachment) => restoreDraftAttachment(attachment)) ?? [];
    const parsedDraft = parseMentionDraft(storedDraft?.content ?? "");

    attachmentDraftCacheRef.current = new Map(
      (storedDraft?.attachments ?? []).map((attachment) => [attachment.id, attachment])
    );
    replaceAttachments(restoredAttachments);
    setMentionSelections(parsedDraft.selections);
    setContent(parsedDraft.plainText);
    setShowSlashMenu(false);
  }, [replaceAttachments]);

  useEffect(() => {
    const parsedDraft = parseMentionDraft(content);

    if (parsedDraft.selections.length === 0) {
      return;
    }

    setMentionSelections((current) => [...current, ...parsedDraft.selections]);
    setContent(parsedDraft.plainText);
  }, [content]);

  useEffect(() => {
    userSelectedModelRef.current = false;
    appliedInitialModelKeyRef.current = null;
  }, [draftStorageId, provider]);

  useEffect(() => {
    if (!availableModels.length) {
      return;
    }

    const normalizedInitialModel = initialModel?.trim() || null;
    const initialModelKey = `${draftStorageId ?? "default"}:${provider}:${normalizedInitialModel ?? ""}`;
    const initialModelAvailable = Boolean(
      normalizedInitialModel &&
      availableModels.some((model) => model.id === normalizedInitialModel)
    );
    const selectedModelAvailable = availableModels.some((model) => model.id === selectedModel);

    if (userSelectedModelRef.current && selectedModelAvailable) {
      appliedInitialModelKeyRef.current = initialModelKey;
      return;
    }

    if (initialModelAvailable) {
      if (appliedInitialModelKeyRef.current !== initialModelKey) {
        appliedInitialModelKeyRef.current = initialModelKey;
        if (selectedModel !== normalizedInitialModel) {
          setSelectedModel(normalizedInitialModel!);
        }
        return;
      }

      if (selectedModelAvailable) {
        return;
      }

      setSelectedModel(normalizedInitialModel!);
      return;
    }

    if (!normalizedInitialModel && appliedInitialModelKeyRef.current !== initialModelKey) {
      appliedInitialModelKeyRef.current = initialModelKey;
    }

    if (
      accountPreferredModel &&
      availableModels.some((model) => model.id === accountPreferredModel)
    ) {
      if (selectedModel !== accountPreferredModel) {
        setSelectedModel(accountPreferredModel);
      }
      return;
    }

    if (selectedModelAvailable) {
      return;
    }

    const fallbackModel = availableModels[0]!.id;
    setSelectedModel(fallbackModel);
  }, [availableModels, draftStorageId, provider, selectedModel, accountPreferredModel, initialModel]);

  useEffect(() => {
    if (!shouldPersistReasoningLevel(provider) || availableReasoningLevels.length === 0) {
      return;
    }

    if (
      accountPreferredReasoningLevel &&
      availableReasoningLevels.some((level) => level.value === accountPreferredReasoningLevel)
    ) {
      if (reasoningLevel !== accountPreferredReasoningLevel) {
        setReasoningLevel(accountPreferredReasoningLevel);
      }
      return;
    }

    if (
      userSelectedReasoningLevelRef.current
      && availableReasoningLevels.some((level) => level.value === reasoningLevel)
    ) {
      return;
    }

    const providerDefault = capabilities?.defaultReasoningLevel;

    if (
      providerDefault &&
      availableReasoningLevels.some((level) => level.value === providerDefault)
    ) {
      if (reasoningLevel !== providerDefault) {
        setReasoningLevel(providerDefault as ReasoningLevel);
      }
      return;
    }

    const modelDefault = selectedModelOption?.defaultReasoningEffort;

    if (
      modelDefault &&
      availableReasoningLevels.some((level) => level.value === modelDefault)
    ) {
      if (reasoningLevel !== modelDefault) {
        setReasoningLevel(modelDefault);
      }
      return;
    }

    if (availableReasoningLevels.some((level) => level.value === reasoningLevel)) {
      return;
    }

    const fallbackLevel = availableReasoningLevels[0]!.value;
    setReasoningLevel(fallbackLevel);
  }, [
    availableReasoningLevels,
    capabilities?.defaultReasoningLevel,
    provider,
    reasoningLevel,
    accountPreferredReasoningLevel,
    selectedModelOption?.defaultReasoningEffort
  ]);

  useEffect(() => {
    let disposed = false;
    const loadVersion = quickPhraseMutationVersionRef.current;

    void listQuickPhrases()
      .then((response) => {
        if (disposed || quickPhraseMutationVersionRef.current !== loadVersion) {
          return;
        }

        setQuickPhrases(
          response.items.map((phrase) => ({
            id: phrase.id,
            text: phrase.text
          }))
        );
      })
      .catch(() => {
        return;
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    restoreDraftState(draftStorageId);
  }, [draftStorageId, restoreDraftState]);

  useEffect(() => {
    if (!draftStorageId) {
      return;
    }

    const storageId = draftStorageId;
    const normalizedAttachmentIds = new Set(attachments.map((attachment) => attachment.id));
    attachmentDraftCacheRef.current.forEach((_value, key) => {
      if (!normalizedAttachmentIds.has(key)) {
        attachmentDraftCacheRef.current.delete(key);
      }
    });

    let disposed = false;

    async function persistDraft() {
      if (content.length === 0 && attachments.length === 0 && mentionSelections.length === 0) {
        clearComposerDraftRecord(storageId);
        return;
      }

      const storedAttachments = await Promise.all(
        attachments.map(async (attachment) => {
          const cached = attachmentDraftCacheRef.current.get(attachment.id);

          if (
            cached &&
            cached.fileName === attachment.file.name &&
            cached.fileSize === attachment.file.size &&
            cached.lastModified === attachment.file.lastModified &&
            cached.mimeType === resolveAttachmentMimeType(attachment.file)
          ) {
            return cached;
          }

          return {
            id: attachment.id,
            fileName: attachment.file.name,
            mimeType: resolveAttachmentMimeType(attachment.file),
            fileSize: attachment.file.size,
            lastModified: attachment.file.lastModified,
            contentBase64: await readFileAsBase64(attachment.file)
          } satisfies StoredComposerDraftAttachment;
        })
      );

      if (disposed) {
        return;
      }

      attachmentDraftCacheRef.current = new Map(
        storedAttachments.map((attachment) => [attachment.id, attachment])
      );
      persistComposerDraftRecord(storageId, {
        content: buildRawComposerContent(mentionSelections, content),
        attachments: storedAttachments
      });
    }

    void persistDraft();

    return () => {
      disposed = true;
    };
  }, [attachments, content, draftStorageId, mentionSelections]);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [content]);

  useEffect(() => {
    if (attachmentDecision.allowed) {
      return;
    }

    attachmentDraftCacheRef.current.clear();
    setAttachmentSheetOpen(false);
    replaceAttachments([]);
  }, [attachmentDecision.allowed, replaceAttachments]);

  useEffect(() => {
    if (platform.isMobile) {
      return;
    }

    setAttachmentSheetOpen(false);
  }, [platform.isMobile]);

  useEffect(() => () => {
    attachmentRegistryRef.current.forEach((previewUrl) => {
      URL.revokeObjectURL(previewUrl);
    });
    attachmentRegistryRef.current.clear();
  }, []);

  useEffect(() => {
    function handleFocusComposer() {
      textareaRef.current?.focus();
    }

    window.addEventListener(FOCUS_COMPOSER_EVENT, handleFocusComposer as EventListener);

    return () => {
      window.removeEventListener(FOCUS_COMPOSER_EVENT, handleFocusComposer as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!forkDraft) {
      setForkCapabilities(null);
      setForkCapabilitiesLoading(false);
      setForkDeploymentSnapshot(null);
      setForkDeploymentSnapshotLoading(false);
      setForkProviderCapabilities({});
      setPendingCrossProvider(null);
      return;
    }

    if (shouldReuseSessionCapabilitiesForFork) {
      setForkCapabilities(null);
      setForkCapabilitiesLoading(false);
      return;
    }

    let cancelled = false;
    const requestId = forkCapabilitiesRequestIdRef.current + 1;
    forkCapabilitiesRequestIdRef.current = requestId;
    forkCapabilitiesAbortRef.current?.abort();
    const abortController = new AbortController();
    forkCapabilitiesAbortRef.current = abortController;

    setForkCapabilities(createDraftCapabilities(forkDraft.targetProvider));
    setForkCapabilitiesLoading(true);

    void getProviderCapabilities(forkDraft.targetProvider, forkDraft.workspaceId, {
      providerConfigMode: forkProviderSelection.providerConfigMode,
      providerPresetId:
        forkProviderSelection.providerConfigMode === "cc-switch-preset"
          ? forkProviderSelection.providerPresetId
          : null
    }, {
      targetHostId: currentTargetHostId,
      signal: abortController.signal
    })
      .then((nextCapabilities) => {
        if (cancelled || requestId !== forkCapabilitiesRequestIdRef.current) {
          return;
        }

        setForkCapabilities(nextCapabilities);
      })
      .catch(() => {
        if (cancelled || requestId !== forkCapabilitiesRequestIdRef.current) {
          return;
        }

        setForkCapabilities(createDraftCapabilities(forkDraft.targetProvider));
      })
      .finally(() => {
        if (!cancelled && requestId === forkCapabilitiesRequestIdRef.current) {
          forkCapabilitiesAbortRef.current = null;
          setForkCapabilitiesLoading(false);
        }
      });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [
    currentTargetHostId,
    forkDraft,
    forkProviderSelection.providerConfigMode,
    forkProviderSelection.providerPresetId,
    shouldReuseSessionCapabilitiesForFork
  ]);

  useEffect(() => {
    if (!forkDraft) {
      setForkProviderCapabilities({});
      return;
    }

    const requestId = forkProviderCapabilitiesRequestIdRef.current + 1;
    forkProviderCapabilitiesRequestIdRef.current = requestId;
    forkProviderCapabilitiesAbortRef.current?.abort();
    const abortController = new AbortController();
    forkProviderCapabilitiesAbortRef.current = abortController;
    let cancelled = false;

    void listProviderCapabilities(visibleCatalogForkProviders, forkDraft.workspaceId, {
      targetHostId: currentTargetHostId,
      signal: abortController.signal
    }).then((nextCapabilities) => {
      if (!cancelled && requestId === forkProviderCapabilitiesRequestIdRef.current) {
        setForkProviderCapabilities(nextCapabilities);
      }
    }).finally(() => {
      if (!cancelled && requestId === forkProviderCapabilitiesRequestIdRef.current) {
        forkProviderCapabilitiesAbortRef.current = null;
      }
    });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [currentTargetHostId, forkDraft?.workspaceId, visibleCatalogForkProviders]);

  useEffect(() => {
    if (!forkDraft || !onForkDraftChange) {
      return;
    }

    if (selectableForkProviders.length === 0) {
      return;
    }

    if (selectableForkProviders.includes(forkDraft.targetProvider)) {
      return;
    }

    onForkDraftChange({
      ...forkDraft,
      targetProvider: selectableForkProviders[0] ?? forkDraft.targetProvider,
      targetModel: null,
      targetProviderConfigMode: "global-default",
      targetProviderPresetId: null
    });
  }, [forkDraft, onForkDraftChange, selectableForkProviders]);

  useEffect(() => {
    if (!forkDraft || !forkDraft.targetModel || !onForkDraftChange) {
      return;
    }

    if (forkAvailableModels.some((model) => model.id === forkDraft.targetModel)) {
      return;
    }

    onForkDraftChange({
      ...forkDraft,
      targetModel: null
    });
  }, [forkAvailableModels, forkDraft, onForkDraftChange]);

  const handleForkProviderSelect = useCallback((nextProvider: ProviderId) => {
    if (!forkDraft || !onForkDraftChange || nextProvider === forkDraft.targetProvider) {
      return;
    }

    if (
      nextProvider !== forkDraft.sourceProvider
      && forkDraft.targetProvider === forkDraft.sourceProvider
    ) {
      setPendingCrossProvider(nextProvider);
      return;
    }

    if (nextProvider === provider && mapProviderToModelSwitchApp(nextProvider)) {
      setForkProviderConfigMode(currentProviderSelection.providerConfigMode);
      setForkProviderPresetId(currentProviderSelection.providerPresetId);
    } else {
      setForkProviderConfigMode("global-default");
      setForkProviderPresetId(null);
    }
    onForkDraftChange({
      ...forkDraft,
      targetProvider: nextProvider,
      targetModel: null,
      targetProviderConfigMode:
        nextProvider === provider && mapProviderToModelSwitchApp(nextProvider)
          ? currentProviderSelection.providerConfigMode
          : "global-default",
      targetProviderPresetId:
        nextProvider === provider && mapProviderToModelSwitchApp(nextProvider)
          ? currentProviderSelection.providerPresetId
          : null
    });
  }, [currentProviderSelection, forkDraft, onForkDraftChange, provider]);

  const handleForkModelChange = useCallback((modelId: string) => {
    if (!forkDraft || !onForkDraftChange) {
      return;
    }

    onForkDraftChange({
      ...forkDraft,
      targetModel: modelId === PROVIDER_DEFAULT_MODEL_ID ? null : modelId
    });
  }, [forkDraft, onForkDraftChange]);

  const handleForkDeploymentPresetChange = useCallback((presetValue: string) => {
    if (!forkDraft || !onForkDraftChange) {
      return;
    }

    if (presetValue === GLOBAL_DEFAULT_PRESET_VALUE) {
      setForkProviderConfigMode("global-default");
      setForkProviderPresetId(null);
    } else {
      setForkProviderConfigMode("cc-switch-preset");
      setForkProviderPresetId(presetValue);
    }

    onForkDraftChange({
      ...forkDraft,
      targetModel: null,
      targetProviderConfigMode: presetValue === GLOBAL_DEFAULT_PRESET_VALUE ? "global-default" : "cc-switch-preset",
      targetProviderPresetId: presetValue === GLOBAL_DEFAULT_PRESET_VALUE ? null : presetValue
    });
  }, [forkDraft, onForkDraftChange]);

  const handleConfirmCrossProvider = useCallback(() => {
    if (!forkDraft || !pendingCrossProvider || !onForkDraftChange) {
      return;
    }

    setForkProviderConfigMode("global-default");
    setForkProviderPresetId(null);
    onForkDraftChange({
      ...forkDraft,
      targetProvider: pendingCrossProvider,
      targetModel: null,
      targetProviderConfigMode: "global-default",
      targetProviderPresetId: null
    });
    setPendingCrossProvider(null);
  }, [forkDraft, onForkDraftChange, pendingCrossProvider]);

  const handleKeepNativeFork = useCallback(() => {
    setPendingCrossProvider(null);
  }, []);

  async function submitMessage(mode: "send" | "queue"): Promise<void> {
    // 发送状态依赖父组件异步回流，这里额外加一层同步锁，防止双击和连按 Enter。
    if (submitLockRef.current) {
      return;
    }

    const nextContent = content.trim();
    const nextMentionSelections = mentionSelections;
    const rawNextContent = buildRawComposerContent(nextMentionSelections, nextContent);
    const nextAttachments = attachments;

    if (
      (rawNextContent.length === 0 && nextAttachments.length === 0)
      || !sendDecision.allowed
      || inRunSendBlocked
      || forkSendBlocked
    ) {
      showToast({
        title: inRunSendBlocked
          ? t("conversation.runtimeRunning")
          : forkStartDisabledReason ?? sendDecision.reason ?? t("conversation.capabilityDenied"),
        tone: "error"
      });
      return;
    }

    submitLockRef.current = true;
    void haptics.trigger(mode === "queue" ? "selection" : "action");
    setLocalSubmitting(true);
    setContent("");
    setMentionSelections([]);
    setAttachments([]);
    setAttachmentSheetOpen(false);
    setDragActive(false);
    setQuickPhraseModalOpen(false);
    setQuickPhraseCreateModalOpen(false);
    setShowSlashMenu(false);

    try {
      const payloads = await Promise.all(
        nextAttachments.map(async (attachment) => ({
          kind: attachment.kind,
          fileName: attachment.file.name,
          mimeType: resolveAttachmentMimeType(attachment.file),
          fileSize: attachment.file.size,
          contentBase64: await readFileAsBase64(attachment.file)
        }))
      );
      const attachmentMeta = nextAttachments.map((attachment) =>
        toAttachmentMeta(attachment.file, attachment.id)
      );

      // 模型和配置文件是会话级状态。发送前必须等最近一次选择写入完成，
      // 否则发送请求可能先读到旧绑定，随后刷新又把界面恢复成默认值。
      await pendingSessionSelectionWriteRef.current;

      const sendHandler =
        mode === "queue" && onQueueSend
          ? onQueueSend
          : onSend;

      await sendHandler(rawNextContent, {
        model:
          hasForkDraft
            ? undefined
            : selectedModelOption?.usesProviderDefault
              ? undefined
              : selectedModel || undefined,
        reasoningLevel:
          hasForkDraft
            ? undefined
            : reasoningSelectorEnabled && availableReasoningLevels.length > 0
              ? reasoningLevel
              : undefined,
        providerConfigMode:
          hasForkDraft
            ? forkProviderSelection.providerConfigMode
            : selectedProviderConfigMode,
        providerPresetId:
          hasForkDraft
            ? (
              forkProviderSelection.providerConfigMode === "cc-switch-preset"
                ? forkProviderSelection.providerPresetId
                : null
            )
            : selectedProviderConfigMode === "cc-switch-preset"
              ? selectedProviderPresetId
              : null,
        attachments: payloads,
        attachmentMeta
      });

      revokeAttachmentPreviews(nextAttachments);
      nextAttachments.forEach((attachment) => {
        if (attachment.previewUrl) {
          attachmentRegistryRef.current.delete(attachment.previewUrl);
        }
      });
    } catch (error) {
      setContent(nextContent);
      setMentionSelections(nextMentionSelections);
      setAttachments(nextAttachments);
      showToast({
        title:
          error instanceof Error && error.message === "FILE_READ_FAILED"
            ? t("conversation.attachmentReadFailed")
            : error instanceof Error
              ? error.message
              : t("conversation.capabilityDenied"),
        tone: "error"
      });
    } finally {
      setLocalSubmitting(false);
      submitLockRef.current = false;
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitMessage(canQueueDuringRun ? "queue" : "send");
  }

  async function handleInterrupt(): Promise<void> {
    if (!interruptAvailable || !onInterrupt || interrupting) {
      return;
    }

    try {
      setInterrupting(true);
      void haptics.trigger("action");
      await onInterrupt();
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("conversation.capabilityInterruptDisabled"),
        tone: "error"
      });
    } finally {
      setInterrupting(false);
    }
  }

  const isDisabled =
    localSubmitting ||
    isSubmitting ||
    inRunSendBlocked ||
    forkSendBlocked ||
    !sendDecision.allowed ||
    !hasDraft;
  const attachButtonDisabled =
    localSubmitting ||
    isSubmitting ||
    inRunSendBlocked ||
    !attachmentDecision.allowed;
  const showQuickPhraseButton = content.length === 0 && !inRunSendBlocked;
  const forkControlDisabled = localSubmitting || isSubmitting || !onForkDraftChange;

  const contentNode = (
    <section ref={panelRef} className="composer-panel">
      <form className="composer-form" onSubmit={handleSubmit}>
        <input
          id={libraryInputId}
          ref={libraryInputRef}
          type="file"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          style={HIDDEN_FILE_INPUT_STYLE}
          onChange={handleAttachmentInputChange}
        />
        <input
          id={cameraInputId}
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          tabIndex={-1}
          aria-hidden="true"
          style={HIDDEN_FILE_INPUT_STYLE}
          onChange={handleAttachmentInputChange}
        />
        <div
          className="composer-input-container"
          data-drag-active={dragActive ? "true" : undefined}
          onDragOver={handleComposerDragOver}
          onDragLeave={handleComposerDragLeave}
          onDrop={handleComposerDrop}
        >
          {forkDraft ? (
            <div className="composer-fork-draft">
              <div className="composer-fork-draft-main">
                <div className="composer-fork-draft-copy">
                  <span className="composer-fork-draft-label">
                    {t("conversation.forkDraftLabel")}
                  </span>
                  <span className="composer-fork-draft-text">
                    {buildForkDraftPreview(forkDraft.content)}
                  </span>
                </div>
                <div className="composer-fork-config">
                  <div className="composer-fork-config-grid">
                    <div className="composer-fork-field">
                      <span className="composer-fork-model-label">
                        {t("conversation.forkTargetProviderLabel")}
                      </span>
                      <MacSelect
                        ariaLabel={t("conversation.forkTargetProviderLabel")}
                        value={forkDraft.targetProvider}
                        options={forkProviderSelectOptions}
                        onChange={(value) => handleForkProviderSelect(value as ProviderId)}
                        compact
                      />
                    </div>
                    <div className="composer-fork-field">
                      <span className="composer-fork-model-label">
                        {t("conversation.forkTargetModelLabel")}
                      </span>
                      {forkModelSwitchApp ? (
                        <DeploymentMacSelect
                          ariaLabel={t("conversation.forkTargetModelLabel")}
                          triggerLabel={forkDeploymentTriggerLabel}
                          presetOptions={forkDeploymentPresetOptions}
                          selectedPresetValue={forkSelectedPresetValue}
                          selectedPresetSummary={forkSelectedPresetOption?.summary ?? null}
                          onSelectPreset={handleForkDeploymentPresetChange}
                          modelOptions={forkModelSelectOptions}
                          selectedModelValue={forkSelectedModelId}
                          onSelectModel={handleForkModelChange}
                          loadingPresets={forkDeploymentSnapshotLoading}
                          loadingModels={forkCapabilitiesLoading}
                          modelColumnDisabled={
                            forkProviderSelection.providerConfigMode === "cc-switch-preset"
                            && forkCapabilitiesLoading
                            && forkCapabilities === null
                          }
                          showPresetColumn={showForkDeploymentPresetColumn}
                          modelEmptyText={t("conversation.deploymentModelEmpty")}
                        />
                      ) : (
                        <MacSelect
                          ariaLabel={t("conversation.forkTargetModelLabel")}
                          value={forkSelectedModelId}
                          options={forkModelSelectOptions}
                          onChange={handleForkModelChange}
                          disabled={forkCapabilitiesLoading || forkSendBlocked}
                          compact
                        />
                      )}
                    </div>
                  </div>
                  {forkStartDisabledReason ? (
                    <p className="composer-capability-hint">{forkStartDisabledReason}</p>
                  ) : null}
                </div>
              </div>
              {onClearForkDraft ? (
                <button
                  type="button"
                  className="composer-fork-draft-clear"
                  aria-label={t("conversation.forkDraftClear")}
                  title={t("conversation.forkDraftClear")}
                  onClick={onClearForkDraft}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              ) : null}
            </div>
          ) : null}

          {attachments.length > 0 ? (
            <div className="composer-attachments">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="composer-attachment-card">
                  {attachment.previewUrl ? (
                    <img
                      src={attachment.previewUrl}
                      alt={t("conversation.attachmentPreviewAlt")}
                      className="composer-attachment-preview"
                    />
                  ) : (
                    <div className="composer-attachment-file" aria-hidden="true">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
                        <path d="M14 2v5h5" />
                        <path d="M9 13h6" />
                        <path d="M9 17h6" />
                      </svg>
                    </div>
                  )}
                  <div className="composer-attachment-meta">
                    <span className="attachment-name" title={attachment.file.name}>
                      {attachment.file.name}
                    </span>
                    <span className="attachment-size">
                      {formatAttachmentSize(attachment.file.size)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="attachment-remove"
                    onClick={() => removeAttachment(attachment.id)}
                    aria-label={t("conversation.removeAttachment")}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {dragActive ? (
            <div className="composer-drop-hint">
              {t("conversation.attachmentDropHint")}
            </div>
          ) : null}

          <div className="composer-input-wrapper">
            {mentionSelections.length > 0 ? (
              <div className="composer-selected-mentions" aria-label={t("conversation.mentionSelectedListLabel")}>
                {mentionSelections.map((item) => (
                  <span
                    key={item.id}
                    className="composer-selected-mention-chip"
                    data-kind={item.type}
                  >
                    <button
                      type="button"
                      className="composer-selected-mention-chip-main"
                      onClick={() => handleMentionChipClick(item)}
                      aria-label={
                        item.type === "skill"
                          ? t("conversation.mentionActivateSkill").replace("{name}", item.label)
                          : t("conversation.mentionActivateFile").replace("{name}", item.label)
                      }
                    >
                      <span className="composer-selected-mention-chip-tag">
                        {item.type === "skill" ? t("conversation.mentionSkillTag") : t("conversation.mentionFileTag")}
                      </span>
                      <span className="composer-selected-mention-chip-label" title={item.label}>
                        {item.label}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="composer-selected-mention-chip-remove"
                      aria-label={
                        item.type === "skill"
                          ? t("conversation.mentionRemoveSkill").replace("{name}", item.label)
                          : t("conversation.mentionRemoveFile").replace("{name}", item.label)
                      }
                      title={t("common.close")}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeMentionSelection(item.id);
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <textarea
              ref={textareaRef}
              className="composer-input"
              value={content}
              placeholder={placeholder ?? t("conversation.composerPlaceholder")}
              readOnly={inRunSendBlocked}
              aria-readonly={inRunSendBlocked}
              onChange={(event) => setContent(event.target.value)}
              rows={1}
              onFocus={() => setShowSlashMenu(false)}
              onCompositionStart={() => {
                clearCompositionCommitLock();
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
                // WebKit 桌面端可能在 compositionend 后立刻再抛一个 Enter，这里短暂加锁避免误发。
                compositionCommitLockRef.current = true;
                compositionCommitUnlockTimerRef.current = globalThis.setTimeout(() => {
                  compositionCommitLockRef.current = false;
                  compositionCommitUnlockTimerRef.current = null;
                }, 0);
              }}
              onPaste={(event) => {
                if (inRunSendBlocked) {
                  return;
                }

                if (!attachmentDecision.allowed) {
                  return;
                }

                const pastedFiles = Array.from(event.clipboardData.items)
                  .filter((item) => item.kind === "file")
                  .map((item) => item.getAsFile())
                  .filter((file): file is File => Boolean(file));

                if (pastedFiles.length === 0) {
                  return;
                }

                event.preventDefault();
                mergeAttachments(pastedFiles);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setShowSlashMenu(false);
                  closeMentionMenu();
                }

                if (mentionMenuOpen && mentionItems.length > 0) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setMentionActiveIndex((current) => (current + 1) % mentionItems.length);
                    return;
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setMentionActiveIndex((current) => (current - 1 + mentionItems.length) % mentionItems.length);
                    return;
                  }
                }

                if (event.key === "Enter" && !event.shiftKey) {
                  if (mentionMenuOpen && mentionItems.length > 0) {
                    event.preventDefault();
                    applyMentionItem(mentionItems[mentionActiveIndex] ?? mentionItems[0]);
                    return;
                  }

                  if (
                    isComposerImeConfirming(
                      event,
                      composingRef.current,
                      compositionCommitLockRef.current
                    )
                  ) {
                    return;
                  }

                  event.preventDefault();

                  if (!isDisabled) {
                    void handleSubmit(event as unknown as React.FormEvent<HTMLFormElement>);
                  }
                }
              }}
            />

            <div className="composer-input-actions">
              {showActivityButton ? (
                <button
                  className="composer-send composer-send-busy"
                  type="button"
                  disabled={!canInterruptNow}
                  onClick={() => {
                    if (!canInterruptNow) {
                      return;
                    }

                    void handleInterrupt();
                  }}
                  aria-label={activityButtonLabel}
                  title={activityButtonLabel}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="6" y="6" width="12" height="12" />
                  </svg>
                </button>
              ) : (
                <button
                  className="composer-send"
                  type="submit"
                  disabled={isDisabled}
                  aria-label={sendButtonLabel}
                  title={sendButtonLabel}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {showSlashMenu ? (
            <div className="composer-slash-menu" role="menu" aria-label={t("conversation.slashMenuTitle")}>
              {slashCommands.map((item) => (
                <button
                  key={item.command}
                  type="button"
                  className="composer-slash-item"
                  onClick={() => applySlashCommand(item.command)}
                >
                  <span className="composer-slash-command">{item.command}</span>
                  <span className="composer-slash-label">{item.label}</span>
                </button>
              ))}
            </div>
          ) : null}

          {mentionMenuOpen ? (
            <div
              ref={mentionMenuRef}
              className="composer-mention-menu"
              role="listbox"
              aria-label={t("conversation.mentionMenuTitle")}
            >
              {mentionLoading ? (
                <div className="composer-mention-empty">{t("conversation.mentionLoading")}</div>
              ) : mentionItems.length > 0 ? (
                mentionItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={mentionItems[mentionActiveIndex]?.id === item.id ? "composer-mention-item is-active" : "composer-mention-item"}
                    aria-selected={mentionItems[mentionActiveIndex]?.id === item.id}
                    onClick={() => applyMentionItem(item)}
                    onMouseEnter={() => {
                      const nextIndex = mentionItems.findIndex((candidate) => candidate.id === item.id);

                      if (nextIndex >= 0) {
                        setMentionActiveIndex(nextIndex);
                      }
                    }}
                  >
                    <span className="composer-mention-item-main">
                      <span className="composer-mention-item-title">{item.name}</span>
                      <span className="composer-mention-item-subtitle">{item.subtitle}</span>
                    </span>
                    <span className="composer-mention-item-tag">
                      {item.type === "skill" ? t("conversation.mentionSkillTag") : t("conversation.mentionFileTag")}
                    </span>
                  </button>
                ))
              ) : (
                <div className="composer-mention-empty">{t("conversation.mentionEmpty")}</div>
              )}
            </div>
          ) : null}

          <div className="composer-controls">
            <div className="composer-controls-left">
              {attachmentDecision.allowed ? (
                platform.isNativeMobile ? (
                  <button
                    type="button"
                    className="composer-attach-btn"
                    aria-label={t("conversation.attachFiles")}
                    title={t("conversation.attachFiles")}
                    disabled={attachButtonDisabled}
                    onClick={handleAttachmentButtonClick}
                  >
                    <AttachmentTriggerIcon />
                  </button>
                ) : attachButtonDisabled ? (
                  <button
                    type="button"
                    className="composer-attach-btn"
                    aria-label={t("conversation.attachFiles")}
                    title={t("conversation.attachFiles")}
                    disabled
                  >
                    <AttachmentTriggerIcon />
                  </button>
                ) : (
                  <label
                    htmlFor={libraryInputId}
                    className="composer-attach-btn"
                    aria-label={t("conversation.attachFiles")}
                    title={t("conversation.attachFiles")}
                    onClick={() => {
                      setShowSlashMenu(false);
                    }}
                  >
                    <AttachmentTriggerIcon />
                  </label>
                )
              ) : null}
              {!hasForkDraft && modelSwitchApp ? (
                <DeploymentMacSelect
                  ariaLabel={t("conversation.modelSelectorLabel")}
                  triggerLabel={deploymentTriggerLabel}
                  presetOptions={deploymentPresetOptions}
                  selectedPresetValue={selectedPresetValue}
                  selectedPresetSummary={selectedPresetOption?.summary ?? null}
                  onSelectPreset={handleDeploymentPresetChange}
                  modelOptions={modelSelectOptions}
                  selectedModelValue={selectedModel}
                  onSelectModel={handleModelChange}
                  loadingPresets={deploymentSnapshotLoading}
                  loadingModels={deploymentCapabilitiesLoading}
                  modelColumnDisabled={
                    selectedProviderConfigMode === "cc-switch-preset"
                    && deploymentCapabilitiesLoading
                    && deploymentCapabilities === null
                  }
                  showPresetColumn={showDeploymentPresetColumn}
                  modelEmptyText={t("conversation.deploymentModelEmpty")}
                />
              ) : null}

              {!hasForkDraft && !modelSwitchApp ? (
                <MacSelect
                  ariaLabel={t("conversation.modelSelectorLabel")}
                  value={selectedModel}
                  options={modelSelectOptions}
                  onChange={handleModelChange}
                />
              ) : null}

              {!hasForkDraft && reasoningSelectorEnabled && availableReasoningLevels.length > 0 ? (
                <MacSelect
                  ariaLabel={t("conversation.reasoningSelectorLabel")}
                  value={reasoningLevel}
                  options={reasoningSelectOptions}
                  onChange={(value) => handleReasoningLevelChange(value as ReasoningLevel)}
                  compact
                />
              ) : null}

              {slashMenuEnabled ? (
                <button
                  type="button"
                  className="composer-slash-btn"
                  onClick={handleSlashCommand}
                  title={t("conversation.slashMenu")}
                >
                  <span className="slash-icon">/</span>
                  <span>{t("conversation.slashMenu")}</span>
                </button>
              ) : null}

              <div
                className={`composer-session-stats-control${platform.isMobile || platform.isNativeMobile ? " is-mobile" : ""}`}
              >
                <SessionStatsIndicators contextUsage={contextUsage} sessionStats={sessionStats} />
                <SessionStatsSummary sessionStats={sessionStats} />
              </div>
              <SessionTaskProgressButton
                provider={taskProvider}
                messages={taskMessages}
                variant="composer"
              />
            </div>

            {showQuickPhraseButton ? (
              <div className="composer-quick-phrase-group">
                <button
                  type="button"
                  className="composer-quick-phrase-trigger"
                  aria-label={t("conversation.quickPhraseTrigger")}
                  title={t("conversation.quickPhraseTrigger")}
                  onClick={() => {
                    setQuickPhraseModalOpen(true);
                    setShowSlashMenu(false);
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M7 8h10" />
                    <path d="M7 12h8" />
                    <path d="M7 16h5" />
                    <path d="M5 5h14v14H9l-4 4V5z" />
                  </svg>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </form>
      <WorkbenchModal
        open={quickPhraseModalOpen}
        title={t("conversation.quickPhraseModalTitle")}
        description={t("conversation.quickPhraseModalDescription")}
        className="composer-quick-phrase-modal"
        onClose={() => {
          setQuickPhraseModalOpen(false);
          setQuickPhraseCreateModalOpen(false);
        }}
      >
        <div className="composer-quick-phrase-modal-body">
          <div className="composer-quick-phrase-toolbar">
            <div className="composer-quick-phrase-toolbar-copy">
              <span>{t("conversation.quickPhraseListLabel")}</span>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={quickPhraseSaving}
              onClick={() => setQuickPhraseCreateModalOpen(true)}
            >
              {t("conversation.quickPhraseOpenCreateAction")}
            </button>
          </div>

          <div className="composer-quick-phrase-list" role="list" aria-label={t("conversation.quickPhraseListLabel")}>
            {quickPhrases.length === 0 ? (
              <div className="composer-quick-phrase-empty">{t("conversation.quickPhraseEmpty")}</div>
            ) : (
              quickPhrases.map((phrase, index) => (
                <div key={phrase.id} className="composer-quick-phrase-item" role="listitem">
                  <button
                    type="button"
                    className="composer-quick-phrase-select"
                    onClick={() => applyQuickPhrase(phrase.text)}
                  >
                    <span className="composer-quick-phrase-order">
                      {t("conversation.quickPhraseOrderLabel", {
                        index: index + 1
                      })}
                    </span>
                    <span className="composer-quick-phrase-text">{phrase.text}</span>
                  </button>
                  <div className="composer-quick-phrase-actions">
                    <button
                      type="button"
                      className="composer-quick-phrase-action"
                      disabled={quickPhraseSaving || index === 0}
                      aria-label={t("conversation.quickPhraseMoveUp")}
                      title={t("conversation.quickPhraseMoveUp")}
                      onClick={() => handleQuickPhraseMove(phrase.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="composer-quick-phrase-action"
                      disabled={quickPhraseSaving || index === quickPhrases.length - 1}
                      aria-label={t("conversation.quickPhraseMoveDown")}
                      title={t("conversation.quickPhraseMoveDown")}
                      onClick={() => handleQuickPhraseMove(phrase.id, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="composer-quick-phrase-action is-danger"
                      disabled={quickPhraseSaving}
                      aria-label={t("conversation.quickPhraseDelete")}
                      title={t("conversation.quickPhraseDelete")}
                      onClick={() => handleQuickPhraseDelete(phrase.id)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </WorkbenchModal>
      <WorkbenchModal
        open={quickPhraseCreateModalOpen}
        title={t("conversation.quickPhraseCreateModalTitle")}
        description={t("conversation.quickPhraseCreateModalDescription")}
        className="composer-quick-phrase-create-modal"
        onClose={() => setQuickPhraseCreateModalOpen(false)}
      >
        <div className="composer-quick-phrase-modal-body">
          <label className="workbench-modal-field">
            <span>{t("conversation.quickPhraseCreateLabel")}</span>
            <textarea
              className="composer-quick-phrase-textarea"
              value={quickPhraseDraft}
              placeholder={t("conversation.quickPhraseCreatePlaceholder")}
              rows={4}
              onChange={(event) => setQuickPhraseDraft(event.target.value)}
            />
          </label>

          <div className="workbench-modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setQuickPhraseCreateModalOpen(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={quickPhraseSaving || quickPhraseDraft.trim().length === 0}
              onClick={() => {
                void handleQuickPhraseCreate();
              }}
            >
              {t("conversation.quickPhraseCreateAction")}
            </button>
          </div>
        </div>
      </WorkbenchModal>
      <WorkbenchModal
        open={pendingCrossProvider !== null}
        title={t("conversation.forkSwitchConfirmTitle")}
        description={t("conversation.forkSwitchConfirmDescription")}
        className="composer-fork-confirm-modal"
        onClose={handleKeepNativeFork}
      >
        <div className="composer-fork-confirm-body">
          <div className="composer-fork-confirm-list">
            <div className="composer-fork-confirm-item">
              <span className="composer-fork-confirm-icon is-keep" aria-hidden="true">
                <ForkKeepIcon />
              </span>
              <div className="composer-fork-confirm-copy">
                <strong>{t("conversation.forkSwitchConfirmKeepTitle")}</strong>
                <p>{t("conversation.forkSwitchConfirmKeepBody")}</p>
              </div>
            </div>
            <div className="composer-fork-confirm-item">
              <span className="composer-fork-confirm-icon is-convert" aria-hidden="true">
                <ForkConvertIcon />
              </span>
              <div className="composer-fork-confirm-copy">
                <strong>{t("conversation.forkSwitchConfirmConvertTitle")}</strong>
                <p>{t("conversation.forkSwitchConfirmConvertBody")}</p>
              </div>
            </div>
            <div className="composer-fork-confirm-item">
              <span className="composer-fork-confirm-icon is-drop" aria-hidden="true">
                <ForkDropIcon />
              </span>
              <div className="composer-fork-confirm-copy">
                <strong>{t("conversation.forkSwitchConfirmDropTitle")}</strong>
                <p>{t("conversation.forkSwitchConfirmDropBody")}</p>
              </div>
            </div>
          </div>
          <div className="workbench-modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={handleKeepNativeFork}
            >
              {t("conversation.forkSwitchKeepNative")}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={handleConfirmCrossProvider}
            >
              {t("conversation.forkSwitchConfirmAction")}
            </button>
          </div>
        </div>
      </WorkbenchModal>
      <AttachmentSourceSheet
        open={attachmentSheetOpen && platform.isNativeMobile}
        onClose={() => setAttachmentSheetOpen(false)}
        onSelectCamera={() => triggerNativeAttachmentInput("camera")}
        onSelectLibrary={() => triggerNativeAttachmentInput("library")}
      />
    </section>
  );

  return portalContainer ? createPortal(contentNode, portalContainer) : contentNode;
}

function AttachmentSourceSheet({
  open,
  onClose,
  onSelectCamera,
  onSelectLibrary
}: {
  open: boolean;
  onClose: () => void;
  onSelectCamera: () => void;
  onSelectLibrary: () => void;
}) {
  return (
    <MobileSheet
      open={open}
      title={t("conversation.attachmentSourceSheetTitle")}
      description={t("conversation.attachmentSourceSheetDescription")}
      kind="action"
      height="auto"
      className="composer-attachment-sheet"
      cardClassName="composer-attachment-sheet-card"
      bodyClassName="composer-attachment-sheet-body"
      showHandle
      onClose={onClose}
    >
      <ModalList className="composer-attachment-sheet-actions">
        <ModalListItem
          as="button"
          className="mobile-workspace-home-row composer-attachment-sheet-option"
          aria-label={t("conversation.attachmentTakePhoto")}
          label={t("conversation.attachmentTakePhoto")}
          description={t("conversation.attachmentTakePhotoHint")}
          trailing={<CameraIcon />}
          onClick={onSelectCamera}
        />
        <ModalListItem
          as="button"
          className="mobile-workspace-home-row composer-attachment-sheet-option"
          aria-label={t("conversation.attachmentChooseFromLibrary")}
          label={t("conversation.attachmentChooseFromLibrary")}
          description={t("conversation.attachmentChooseFromLibraryHint")}
          trailing={<LibraryIcon />}
          onClick={onSelectLibrary}
        />
      </ModalList>
    </MobileSheet>
  );
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function AttachmentTriggerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M8 12h8M12 8v8" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="m7.5 15 3-3 2.5 2.5 3-4L18 13.5" />
      <circle cx="8.75" cy="8.75" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ForkKeepIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M12 3 4 7v5c0 5 3.5 8 8 9 4.5-1 8-4 8-9V7l-8-4Z" />
      <path d="m9.5 12 1.8 1.8L15 10.2" />
    </svg>
  );
}

function ForkConvertIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M4 7h9" />
      <path d="m10 3 4 4-4 4" />
      <path d="M20 17h-9" />
      <path d="m14 13-4 4 4 4" />
    </svg>
  );
}

function ForkDropIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="m7 7 10 10" />
      <path d="M17 7 7 17" />
      <path d="M12 3v2" />
      <path d="M12 19v2" />
    </svg>
  );
}

type SessionStatsDisplayMetric = ProviderSessionStatMetricDto;
type SessionStatsMetricValue = NonNullable<
  ProviderSessionStatsDto["metrics"][ProviderSessionStatMetricDto]
>;

interface SessionStatsItem {
  metric: SessionStatsDisplayMetric;
  label: string;
  value: SessionStatsMetricValue;
}

type SessionCostPricing = NonNullable<SessionStatsMetricValue["pricing"]>;
type SessionCostBreakdown = NonNullable<SessionCostPricing["breakdown"]>[number];
type SessionCostPrice = NonNullable<SessionCostPricing["priceBook"]>[number];
type SessionCostExchangeRate = NonNullable<SessionCostPricing["exchangeRate"]>;

interface SessionStatsSummaryItem {
  key: "turns" | "inputTokens" | "outputTokens";
  text: string;
}

function SessionStatsSummary({
  sessionStats
}: {
  sessionStats: ProviderSessionStatsDto | null;
}) {
  const summaryItems = useMemo(() => buildSessionStatsSummary(sessionStats), [sessionStats]);

  if (summaryItems.length === 0) {
    return null;
  }

  return (
    <div className="composer-session-stats-summary">
      {summaryItems.map((item, index) => (
        <span className="composer-session-stats-summary-item" key={item.key}>
          {index > 0 ? <span className="composer-session-stats-summary-divider" aria-hidden="true">|</span> : null}
          <span>{item.text}</span>
        </span>
      ))}
    </div>
  );
}

function buildSessionStatsItems(sessionStats: ProviderSessionStatsDto | null): SessionStatsItem[] {
  const definitions: Array<{
    metric: ProviderSessionStatMetricDto;
    label: string;
  }> = [
    { metric: "inputTokens", label: t("conversation.sessionStatsInputTokens") },
    { metric: "uncachedInputTokens", label: t("conversation.sessionStatsUncachedInputTokens") },
    { metric: "outputTokens", label: t("conversation.sessionStatsOutputTokens") },
    { metric: "reasoningTokens", label: t("conversation.sessionStatsReasoningTokens") },
    { metric: "cacheReadTokens", label: t("conversation.sessionStatsCacheReadTokens") },
    { metric: "cacheWriteTokens", label: t("conversation.sessionStatsCacheWriteTokens") },
    { metric: "toolTokens", label: t("conversation.sessionStatsToolTokens") },
    { metric: "totalTokens", label: t("conversation.sessionStatsTotalTokens") },
    { metric: "turns", label: t("conversation.sessionStatsTurns") },
    { metric: "steps", label: t("conversation.sessionStatsSteps") },
    { metric: "llmMs", label: t("conversation.sessionStatsLlmDuration") },
    { metric: "toolMs", label: t("conversation.sessionStatsToolDuration") },
    { metric: "ttftMs", label: t("conversation.sessionStatsTtft") },
    { metric: "ttftSteps", label: t("conversation.sessionStatsTtftSteps") },
    { metric: "decodeMs", label: t("conversation.sessionStatsDecodeDuration") },
    { metric: "decodeTokens", label: t("conversation.sessionStatsDecodeTokens") },
    { metric: "costUsd", label: t("conversation.sessionStatsCost") }
  ];

  return definitions.flatMap((item) => {
    const value = sessionStats?.metrics[item.metric];

    if (!value || !Number.isFinite(value.value) || value.value < 0) {
      return [];
    }

    if (item.metric === "ttftMs") {
      const ttftSteps = sessionStats?.metrics.ttftSteps;

      if (!isSessionStatValueAvailable(ttftSteps) || ttftSteps.value <= 0) {
        return [];
      }

      return [{
        ...item,
        value: {
          ...value,
          value: value.value / ttftSteps.value
        }
      }];
    }

    return [{ ...item, value }];
  });
}

function buildSessionStatsSummary(sessionStats: ProviderSessionStatsDto | null): SessionStatsSummaryItem[] {
  const summary: SessionStatsSummaryItem[] = [];
  const turns = sessionStats?.metrics.turns;
  const inputTokens = sessionStats?.metrics.inputTokens;
  const outputTokens = sessionStats?.metrics.outputTokens;

  if (isSessionStatValueAvailable(turns)) {
    summary.push({
      key: "turns",
      text: t("conversation.sessionStatsSummaryTurns", { value: formatTokenCount(turns.value) })
    });
  }

  if (isSessionStatValueAvailable(inputTokens)) {
    summary.push({
      key: "inputTokens",
      text: t("conversation.sessionStatsSummaryInputTokens", {
        value: formatCompactTokenCount(inputTokens.value)
      })
    });
  }

  if (isSessionStatValueAvailable(outputTokens)) {
    summary.push({
      key: "outputTokens",
      text: t("conversation.sessionStatsSummaryOutputTokens", {
        value: formatCompactTokenCount(outputTokens.value)
      })
    });
  }

  return summary;
}

function isSessionStatValueAvailable(
  value: NonNullable<ProviderSessionStatsDto["metrics"][ProviderSessionStatMetricDto]> | undefined
): value is NonNullable<ProviderSessionStatsDto["metrics"][ProviderSessionStatMetricDto]> {
  if (!value) {
    return false;
  }

  return Number.isFinite(value.value) && value.value >= 0;
}

function formatSessionStatValue(metric: SessionStatsDisplayMetric, value: number): string {
  if (metric === "cacheHitRate") {
    return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
  }

  if (metric === "costUsd") {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 4
    }).format(value);
  }

  if (metric === "inputTokens") {
    return t("conversation.sessionStatsInputTokensValue", {
      exact: formatTokenCount(value),
      compact: formatCompactTokenCount(value)
    });
  }

  if (metric.endsWith("Ms")) {
    return formatSessionDuration(value);
  }

  return formatTokenCount(value);
}

function formatCompactTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function formatSessionDuration(valueMs: number): string {
  const totalSeconds = Math.max(0, valueMs / 1000);

  if (totalSeconds < 59.5) {
    const seconds = totalSeconds < 10
      ? totalSeconds.toFixed(1)
      : String(Math.round(totalSeconds));
    return `${seconds} ${t("conversation.sessionStatsSeconds")}`;
  }

  const roundedSeconds = Math.round(totalSeconds);
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const seconds = roundedSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours} ${t("conversation.sessionStatsHours")}`);
  }

  if (minutes > 0) {
    parts.push(`${minutes} ${t("conversation.sessionStatsMinutes")}`);
  }

  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds} ${t("conversation.sessionStatsSeconds")}`);
  }

  return parts.join(" ");
}

function formatSessionStatsSource(value: ProviderSessionStatValueDto["source"]): string {
  switch (value) {
    case "provider-projection":
      return t("conversation.sessionStatsSourceProjection");
    case "provider-session-store":
      return t("conversation.sessionStatsSourceSessionStore");
    case "provider-history-log":
      return t("conversation.sessionStatsSourceHistoryLog");
    case "derived-provider-metrics":
      return t("conversation.sessionStatsSourceDerived");
  }

  return "";
}

function formatSessionStatsSemantic(value: ProviderSessionStatValueDto["semantic"]): string {
  switch (value) {
    case "cumulative":
      return t("conversation.sessionStatsSemanticCumulative");
    case "sum-of-final-events":
      return t("conversation.sessionStatsSemanticFinalEvents");
    case "latest-snapshot":
      return t("conversation.sessionStatsSemanticLatestSnapshot");
    case "derived-ratio":
      return t("conversation.sessionStatsSemanticDerivedRatio");
  }

  return "";
}

function formatSessionStatsWatermark(
  watermark: NonNullable<ProviderSessionStatsDto["metrics"][ProviderSessionStatMetricDto]>["watermark"]
): string {
  if (watermark.kind === "source-sequence") {
    return t("conversation.sessionStatsWatermarkSequence").replace("{value}", watermark.value);
  }

  const date = new Date(watermark.value);
  const formatted = Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date)
    : watermark.value;
  const label = watermark.kind === "source-timestamp"
    ? t("conversation.sessionStatsWatermarkSourceTime")
    : t("conversation.sessionStatsWatermarkCapturedAt");
  return label.replace("{value}", formatted);
}

type SessionStatsIndicator = "context" | "cache";

function SessionStatsIndicators({
  contextUsage,
  sessionStats
}: {
  contextUsage: ContextUsageDto | null;
  sessionStats: ProviderSessionStatsDto | null;
}) {
  const [open, setOpen] = useState(false);
  const [costDetailsOpen, setCostDetailsOpen] = useState(false);
  const [activeIndicator, setActiveIndicator] = useState<SessionStatsIndicator>("context");
  const contextTriggerRef = useRef<HTMLButtonElement>(null);
  const cacheTriggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);
  const tooltipId = useId();
  const platform = usePlatform();
  const isMobile = platform.isMobile || platform.isNativeMobile;
  const sessionStatsItems = useMemo(() => buildSessionStatsItems(sessionStats), [sessionStats]);
  const costMetric = sessionStats?.metrics.costUsd ?? null;
  const cacheHitRate = sessionStats?.metrics.cacheHitRate;
  const cacheHitRateValue = isSessionStatValueAvailable(cacheHitRate) ? cacheHitRate : null;
  const hasCacheHitRate = cacheHitRateValue !== null;
  const hasSessionStats = sessionStatsItems.length > 0 || hasCacheHitRate;
  const usagePercent = contextUsage ? Math.round(contextUsage.usageRatio * 100) : null;
  const progress = contextUsage ? Math.max(0, Math.min(contextUsage.usageRatio, 1)) : 0;
  const cacheHitRatePercent = cacheHitRateValue
    ? Math.max(0, Math.min(cacheHitRateValue.value, 100))
    : null;
  const cacheHitRateProgress = cacheHitRatePercent === null ? null : cacheHitRatePercent / 100;
  const cacheHitRateClassName = getCacheHitRateStateClassName(cacheHitRatePercent);
  const cacheHitRateLabel = cacheHitRatePercent === null
    ? null
    : t("conversation.sessionStatsSummaryCacheHitRate", {
      value: formatSessionStatValue("cacheHitRate", cacheHitRatePercent)
    });
  const cacheHitRateMeta = cacheHitRateValue?.source === "derived-provider-metrics"
    ? t("conversation.sessionStatsDerivedCacheHitRate")
    : cacheHitRateValue
      ? `${formatSessionStatsSource(cacheHitRateValue.source)} · ${formatSessionStatsSemantic(cacheHitRateValue.semantic)} · ${formatSessionStatsWatermark(cacheHitRateValue.watermark)}`
      : null;
  const stateClassName = getContextUsageStateClassName(progress);
  const contextUsageLabel = contextUsage
    ? `${t("conversation.contextUsageTitle")} ${usagePercent}%`
    : hasSessionStats
      ? t("conversation.sessionStatsTitle")
      : t("conversation.contextUsageUnavailable");

  const updateTooltipStyle = useCallback(() => {
    const trigger = activeIndicator === "cache" ? cacheTriggerRef.current : contextTriggerRef.current;

    if (!trigger || typeof window === "undefined") {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const edgePadding = 12;
    const gap = 10;
    const width = Math.min(
      hasSessionStats ? 372 : 272,
      Math.max(hasSessionStats ? 284 : 204, viewportWidth - edgePadding * 2)
    );
    const left = Math.min(
      Math.max(edgePadding, rect.left + rect.width / 2 - width / 2),
      Math.max(edgePadding, viewportWidth - width - edgePadding)
    );
    const spaceAbove = rect.top - edgePadding;
    const spaceBelow = viewportHeight - rect.bottom - edgePadding;
    const shouldPlaceAbove = spaceAbove >= (hasSessionStats ? 230 : 150) || spaceAbove >= spaceBelow;
    const availableHeight = Math.max(0, Math.floor((shouldPlaceAbove ? spaceAbove : spaceBelow) - gap));

    setTooltipStyle({
      position: "fixed",
      left,
      width,
      maxWidth: viewportWidth - edgePadding * 2,
      maxHeight: availableHeight,
      top: shouldPlaceAbove ? undefined : rect.bottom + gap,
      bottom: shouldPlaceAbove ? viewportHeight - rect.top + gap : undefined
    });
  }, [activeIndicator, hasSessionStats]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (
        !contextTriggerRef.current?.contains(target)
        && !cacheTriggerRef.current?.contains(target)
        && !tooltipRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", updateTooltipStyle);
    window.addEventListener("scroll", updateTooltipStyle, true);
    updateTooltipStyle();

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", updateTooltipStyle);
      window.removeEventListener("scroll", updateTooltipStyle, true);
    };
  }, [open, updateTooltipStyle]);

  const handleIndicatorClick = (indicator: SessionStatsIndicator) => {
    const isCurrentIndicator = activeIndicator === indicator;

    setActiveIndicator(indicator);
    setOpen((current) => !(current && isCurrentIndicator));
  };

  return (
    <>
      <button
        ref={contextTriggerRef}
        type="button"
        className={`composer-context-ring ${stateClassName}${usagePercent === null && hasSessionStats ? " is-stats-only" : ""}`}
        style={{ "--context-usage-progress": `${progress}` } as CSSProperties}
        aria-label={contextUsageLabel}
        aria-expanded={open && activeIndicator === "context"}
        aria-describedby={open && activeIndicator === "context" ? tooltipId : undefined}
        onClick={() => handleIndicatorClick("context")}
      >
        <span className="composer-context-ring-visual" aria-hidden="true">
          <span className="composer-context-ring-value">
            {usagePercent === null ? (
              hasSessionStats ? (
                <span className="composer-context-ring-stats-icon">
                  <span />
                  <span />
                  <span />
                </span>
              ) : "--"
            ) : (
              <>
                <span>{usagePercent}</span>
                <span className="composer-context-ring-suffix">%</span>
              </>
            )}
          </span>
        </span>
      </button>

      {cacheHitRatePercent !== null && cacheHitRateProgress !== null && cacheHitRateLabel ? (
        <button
          ref={cacheTriggerRef}
          type="button"
          className={`composer-cache-hit-ring ${cacheHitRateClassName}`}
          style={{ "--cache-hit-rate-progress": `${cacheHitRateProgress}` } as CSSProperties}
          aria-label={cacheHitRateLabel}
          aria-expanded={open && activeIndicator === "cache"}
          aria-describedby={open && activeIndicator === "cache" ? tooltipId : undefined}
          onClick={() => handleIndicatorClick("cache")}
        >
          <span className="composer-cache-hit-ring-visual" aria-hidden="true">
            <span className="composer-cache-hit-ring-value">
              <span>{formatRingPercentage(cacheHitRatePercent)}</span>
              <span className="composer-cache-hit-ring-suffix">%</span>
            </span>
          </span>
        </button>
      ) : null}

      {open && tooltipStyle && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              className={`composer-context-tooltip${hasSessionStats ? " has-session-stats" : ""}${contextUsage ? " has-context-usage" : ""}${hasCacheHitRate ? " has-cache-hit-rate" : ""}`}
              style={tooltipStyle}
              role="tooltip"
            >
              {contextUsage ? (
                <section className="composer-context-usage-overview">
                  <div className="composer-context-usage-heading">
                    <div className="composer-context-tooltip-title">
                      {t("conversation.contextUsageTitle")}
                    </div>
                    <strong className={`composer-context-usage-percent ${stateClassName}`}>
                      {usagePercent}%
                    </strong>
                  </div>
                  <div
                    className={`composer-context-usage-progress ${stateClassName}`}
                    role="progressbar"
                    aria-label={contextUsageLabel}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={usagePercent ?? 0}
                  >
                    <span style={{ width: `${progress * 100}%` }} />
                  </div>
                  <div className="composer-context-usage-amounts">
                    <span>{t("conversation.contextUsageUsedTokens", { count: formatTokenCount(contextUsage.promptTokens) })}</span>
                    <span>{t("conversation.contextUsageLimitTokens", { count: formatTokenCount(contextUsage.contextWindow) })}</span>
                  </div>
                </section>
              ) : !hasSessionStats ? (
                <div className="composer-context-tooltip-line">
                  {t("conversation.contextUsageUnavailable")}
                </div>
              ) : null}
              {cacheHitRatePercent !== null && cacheHitRateProgress !== null ? (
                <section className={`composer-cache-hit-rate-panel ${cacheHitRateClassName}`}>
                  <div className="composer-cache-hit-rate-heading">
                    <div className="composer-context-tooltip-title">
                      {t("conversation.sessionStatsCacheHitRate")}
                    </div>
                    <strong>{formatSessionStatValue("cacheHitRate", cacheHitRatePercent)}</strong>
                  </div>
                  <div
                    className="composer-cache-hit-rate-scale"
                    style={{ "--cache-hit-rate-fill": `${cacheHitRateProgress * 100}%` } as CSSProperties}
                    role="progressbar"
                    aria-label={cacheHitRateLabel ?? undefined}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={cacheHitRatePercent}
                  >
                    <span
                      className="composer-cache-hit-rate-pointer"
                      style={{ left: `${cacheHitRateProgress * 100}%` }}
                      aria-hidden="true"
                    />
                    <span className="composer-cache-hit-rate-marker is-low" style={{ left: "40%" }} />
                    <span className="composer-cache-hit-rate-marker is-medium" style={{ left: "80%" }} />
                    <span className="composer-cache-hit-rate-marker is-high" style={{ left: "90%" }} />
                  </div>
                  <div className="composer-cache-hit-rate-ticks" aria-hidden="true">
                    <span style={{ left: "0%" }}>0</span>
                    <span style={{ left: "40%" }}>40</span>
                    <span style={{ left: "80%" }}>80</span>
                    <span style={{ left: "90%" }}>90</span>
                    <span style={{ left: "100%" }}>100</span>
                  </div>
                  {cacheHitRateMeta ? (
                    <div className="composer-cache-hit-rate-meta">{cacheHitRateMeta}</div>
                  ) : null}
                </section>
              ) : null}
              {sessionStatsItems.length > 0 ? (
                <section className="composer-context-tooltip-session-stats">
                  <div className="composer-context-tooltip-title">
                    {t("conversation.sessionStatsTitle")}
                  </div>
                  <div className="composer-session-stats-grid">
                    {sessionStatsItems.map((item) => (
                      <div className="composer-session-stats-row" data-metric={item.metric} key={item.metric}>
                      <div className="composer-session-stats-row-value">
                          <span>{item.label}</span>
                          <strong>{formatSessionStatValue(item.metric, item.value.value)}</strong>
                          {item.metric === "costUsd" ? (
                            <button
                              type="button"
                              className="composer-session-cost-info-button"
                              aria-label={t("conversation.sessionStatsCostDetailsAction")}
                              title={t("conversation.sessionStatsCostDetailsAction")}
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={() => {
                                setOpen(false);
                                setCostDetailsOpen(true);
                              }}
                            >
                              <SessionCostInfoIcon />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>,
            document.body
          )
        : null}
      {costMetric ? (
        <SessionCostDetailsModal
          open={costDetailsOpen}
          isMobile={isMobile}
          metric={costMetric}
          onClose={() => setCostDetailsOpen(false)}
        />
      ) : null}
    </>
  );
}

function SessionCostDetailsModal({
  open,
  isMobile,
  metric,
  onClose
}: {
  open: boolean;
  isMobile: boolean;
  metric: SessionStatsMetricValue;
  onClose: () => void;
}) {
  const [priceBookOpen, setPriceBookOpen] = useState(false);
  const pricing = metric.pricing;
  const breakdown = pricing?.breakdown ?? [];
  const priceBook = pricing?.priceBook ?? [];

  useEffect(() => {
    if (!open) {
      setPriceBookOpen(false);
    }
  }, [open]);

  const footer = (
    <ModalActions stack={isMobile}>
      <button
        type="button"
        className="secondary-button"
        disabled={priceBook.length === 0}
        onClick={() => setPriceBookOpen((current) => !current)}
      >
        {priceBookOpen
          ? t("conversation.sessionStatsCostHidePriceBook")
          : t("conversation.sessionStatsCostViewPriceBook")}
      </button>
      <button type="button" className="primary-button" onClick={onClose}>
        {t("common.close")}
      </button>
    </ModalActions>
  );

  const body = (
    <SessionCostDetailsBody
      metric={metric}
      pricing={pricing}
      breakdown={breakdown}
      priceBook={priceBook}
      showPriceBook={priceBookOpen}
    />
  );

  if (isMobile) {
    return (
      <MobileSheet
        open={open}
        title={t("conversation.sessionStatsCostDetailsTitle")}
        description={t("conversation.sessionStatsCostDetailsDescription")}
        height="three-quarter"
        kind="form"
        showHandle
        showCancelButton={false}
        bodyClassName="composer-session-cost-modal-body"
        footer={footer}
        onClose={onClose}
      >
        {body}
      </MobileSheet>
    );
  }

  return (
    <DesktopModal
      open={open}
      title={t("conversation.sessionStatsCostDetailsTitle")}
      description={t("conversation.sessionStatsCostDetailsDescription")}
      size="regular"
      layout="form"
      bodyClassName="composer-session-cost-modal-body"
      footer={footer}
      onClose={onClose}
    >
      {body}
    </DesktopModal>
  );
}

function SessionCostDetailsBody({
  metric,
  pricing,
  breakdown,
  priceBook,
  showPriceBook
}: {
  metric: SessionStatsMetricValue;
  pricing: SessionCostPricing | undefined;
  breakdown: readonly SessionCostBreakdown[];
  priceBook: readonly SessionCostPrice[];
  showPriceBook: boolean;
}) {
  const exchangeRate = pricing?.exchangeRate;
  const cnyValue = exchangeRate && Number.isFinite(exchangeRate.rate)
    ? metric.value * exchangeRate.rate
    : null;

  return (
    <>
      <ModalSection
        heading={t("conversation.sessionStatsCostModelsTitle")}
        description={t("conversation.sessionStatsCostModelsDescription")}
      >
        {breakdown.length > 0 ? (
          <ModalList className="composer-session-cost-model-list">
            {breakdown.map((item) => (
              <ModalListItem
                key={`${item.provider}:${item.model}`}
                label={`${getProviderDisplayName(item.provider)} · ${item.model}`}
                description={formatSessionCostTokenBreakdown(item)}
                trailing={<strong>{formatUsdAmount(item.costUsd)}</strong>}
              />
            ))}
          </ModalList>
        ) : (
          <p className="composer-session-cost-empty">
            {pricing?.kind === "provider-native"
              ? t("conversation.sessionStatsCostNativeBreakdownUnavailable")
              : t("conversation.sessionStatsCostBreakdownUnavailable")}
          </p>
        )}
      </ModalSection>

      <ModalSection
        heading={t("conversation.sessionStatsCostConversionTitle")}
        description={t("conversation.sessionStatsCostConversionDescription")}
      >
        <div className="composer-session-cost-conversion">
          <div>
            <span>{t("conversation.sessionStatsCostUsdLabel")}</span>
            <strong>{formatUsdAmount(metric.value)}</strong>
          </div>
          <div>
            <span>{t("conversation.sessionStatsCostCnyLabel")}</span>
            <strong>{cnyValue === null ? "--" : formatCnyAmount(cnyValue)}</strong>
          </div>
        </div>
        {exchangeRate ? (
          <p className="composer-session-cost-rate">
            {t("conversation.sessionStatsCostExchangeRate", {
              rate: exchangeRate.rate.toFixed(2),
              version: exchangeRate.version
            })}
          </p>
        ) : null}
      </ModalSection>

      {showPriceBook ? (
        <ModalSection
          heading={t("conversation.sessionStatsCostPriceBookTitle")}
          description={t("conversation.sessionStatsCostPriceBookDescription", {
            version: pricing?.priceBookVersion ?? "--"
          })}
        >
          {priceBook.length > 0 ? (
            <ModalList className="composer-session-cost-price-list">
              {priceBook.map((entry) => (
                <ModalListItem
                  key={`${entry.provider}:${entry.model}`}
                  label={`${getProviderDisplayName(entry.provider)} · ${entry.model}`}
                  description={formatSessionPriceDescription(entry)}
                />
              ))}
            </ModalList>
          ) : (
            <p className="composer-session-cost-empty">
              {t("conversation.sessionStatsCostPriceBookUnavailable")}
            </p>
          )}
        </ModalSection>
      ) : null}
    </>
  );
}

function formatSessionCostTokenBreakdown(item: SessionCostBreakdown): string {
  return [
    t("conversation.sessionStatsCostInputTokens", { value: formatTokenCount(item.inputTokens) }),
    t("conversation.sessionStatsCostOutputTokens", { value: formatTokenCount(item.outputTokens) }),
    item.reasoningTokens > 0
      ? t("conversation.sessionStatsCostReasoningTokens", { value: formatTokenCount(item.reasoningTokens) })
      : null,
    item.cacheReadTokens > 0
      ? t("conversation.sessionStatsCostCacheReadTokens", { value: formatTokenCount(item.cacheReadTokens) })
      : null,
    item.cacheWriteTokens > 0
      ? t("conversation.sessionStatsCostCacheWriteTokens", { value: formatTokenCount(item.cacheWriteTokens) })
      : null
  ].filter(Boolean).join(" · ");
}

function formatSessionPriceDescription(entry: SessionCostPrice): string {
  const prices = [
    t("conversation.sessionStatsCostInputPrice", {
      value: formatUsdAmount(entry.inputUsdPerToken * 1_000_000)
    }),
    t("conversation.sessionStatsCostOutputPrice", {
      value: formatUsdAmount(entry.outputUsdPerToken * 1_000_000)
    })
  ];

  if (entry.cacheReadUsdPerToken !== undefined) {
    prices.push(t("conversation.sessionStatsCostCacheReadPrice", {
      value: formatUsdAmount(entry.cacheReadUsdPerToken * 1_000_000)
    }));
  }

  if (entry.cacheWriteUsdPerToken !== undefined) {
    prices.push(t("conversation.sessionStatsCostCacheWritePrice", {
      value: formatUsdAmount(entry.cacheWriteUsdPerToken * 1_000_000)
    }));
  }

  return prices.join(" · ");
}

function formatUsdAmount(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6
  }).format(value);
}

function formatCnyAmount(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 4
  }).format(value);
}

function SessionCostInfoIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.35" />
      <path
        d="M8 6.05H8.01M7.25 7.65H8V10.15H8.75"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
    </svg>
  );
}

function getContextUsageStateClassName(progress: number): string {
  if (progress >= 0.95) {
    return "is-critical";
  }

  if (progress >= 0.8) {
    return "is-warning";
  }

  return "is-normal";
}

function getCacheHitRateStateClassName(cacheHitRatePercent: number | null): string {
  if (cacheHitRatePercent === null || cacheHitRatePercent < 40) {
    return "is-cache-critical";
  }

  if (cacheHitRatePercent < 80) {
    return "is-cache-low";
  }

  if (cacheHitRatePercent < 90) {
    return "is-cache-medium";
  }

  return "is-cache-high";
}

function formatRingPercentage(value: number): string {
  return `${Math.floor(value)}`;
}

function normalizeModelReasoningLevel(value?: string | null): ReasoningLevel | null {
  if (
    value === "off"
    || value === "minimal"
    || value === "low"
    || value === "medium"
    || value === "high"
    || value === "xhigh"
    || value === "max"
    || value === "ultra"
  ) {
    return value;
  }

  return null;
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}
