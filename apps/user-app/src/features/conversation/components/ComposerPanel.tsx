import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type Ref } from "react";
import { createPortal } from "react-dom";

import { usePlatform } from "../../../platform/platform-provider";
import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  updatePreferences,
  usePreferencesSelector
} from "../../../preferences/preferences-store";
import { isPreferenceProviderId } from "../../../preferences/user-preference-store";
import { decideCapability } from "../capability/capability-gate";
import {
  allowsQueueDuringRun,
  getProviderFromCapabilities,
  shouldPersistReasoningLevel,
  shouldShowSlashMenu,
  shouldSupportRunSteering,
  supportsReasoningSelector
} from "../capability/provider-ui";
import type {
  ContextUsageDto,
  ImageAttachmentPayload,
  MessageAttachmentDto,
  ProviderCapabilitiesDto,
  ProviderId
} from "../api/conversation-api";
import type { PreferenceReasoningLevel as ReasoningLevel } from "../../../preferences/types";
import { listQuickPhrases, replaceQuickPhrases } from "../api/conversation-api";
import { WorkbenchModal } from "./WorkbenchModal";
import {
  clearComposerDraftRecord,
  createQuickPhraseRecord,
  DEFAULT_QUICK_PHRASES,
  persistComposerDraftRecord,
  readComposerDraftRecord,
  type QuickPhraseRecord,
  type StoredComposerDraftAttachment
} from "./composer-local-storage";

interface ComposerPanelProps {
  capabilities: ProviderCapabilitiesDto | null;
  placeholder?: string;
  draftStorageId?: string;
  panelRef?: Ref<HTMLElement>;
  portalContainer?: Element | null;
  hasActiveRun?: boolean | null;
  canInterrupt?: boolean | null;
  contextUsage?: ContextUsageDto | null;
  hasPendingQueuedMessages?: boolean;
  isSubmitting: boolean;
  isRunning?: boolean;
  onInterrupt?: () => Promise<void> | void;
  onQueueSend?: (
    content: string,
    options?: {
      model?: string;
      reasoningLevel?: string;
      attachments?: ImageAttachmentPayload[];
      attachmentMeta?: MessageAttachmentDto[];
    }
  ) => Promise<void>;
  onSend: (
    content: string,
    options?: {
      model?: string;
      reasoningLevel?: string;
      attachments?: ImageAttachmentPayload[];
      attachmentMeta?: MessageAttachmentDto[];
    }
  ) => Promise<void>;
}

type ModelOption = {
  id: string;
  name: string;
  provider: ProviderId;
  usesProviderDefault?: boolean;
  supportedReasoningEfforts?: ReasoningLevel[];
};

interface ComposerImageAttachment {
  id: string;
  file: File;
  previewUrl: string;
}

interface ComposerSelectOption {
  value: string;
  label: string;
}

const FOCUS_COMPOSER_EVENT = "workbench:focus-composer";
const PROVIDER_DEFAULT_MODEL_ID = "provider-default";
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

function isProviderDefaultModel(model: Pick<ModelOption, "id" | "usesProviderDefault">): boolean {
  return model.usesProviderDefault === true || model.id === PROVIDER_DEFAULT_MODEL_ID;
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

function restoreDraftAttachment(
  attachment: StoredComposerDraftAttachment
): ComposerImageAttachment {
  const file = base64ToFile(
    attachment.fileName,
    attachment.mimeType,
    attachment.contentBase64,
    attachment.lastModified
  );

  return {
    id: attachment.id,
    file,
    previewUrl: URL.createObjectURL(file)
  };
}

function toAttachmentMeta(file: File, id: string): MessageAttachmentDto {
  return {
    id,
    kind: "image",
    fileName: file.name,
    mimeType: file.type || "image/png",
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

function revokeAttachmentPreviews(attachments: ComposerImageAttachment[]): void {
  attachments.forEach((attachment) => {
    URL.revokeObjectURL(attachment.previewUrl);
  });
}

function collectImageFiles(files: Iterable<File>): {
  accepted: File[];
  rejectedCount: number;
} {
  const accepted: File[] = [];
  let rejectedCount = 0;

  for (const file of files) {
    if (file.type.startsWith("image/")) {
      accepted.push(file);
      continue;
    }

    rejectedCount += 1;
  }

  return {
    accepted,
    rejectedCount
  };
}

function mergeImageAttachments(
  current: ComposerImageAttachment[],
  incomingFiles: File[]
): ComposerImageAttachment[] {
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
    next.push({
      id: createAttachmentId(),
      file,
      previewUrl: URL.createObjectURL(file)
    });
  });

  return next;
}

export function ComposerPanel({
  capabilities,
  placeholder,
  draftStorageId,
  panelRef,
  portalContainer = null,
  hasActiveRun = null,
  canInterrupt = null,
  contextUsage = null,
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
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>("medium");
  const [attachments, setAttachments] = useState<ComposerImageAttachment[]>([]);
  const [attachmentSheetOpen, setAttachmentSheetOpen] = useState(false);
  const [quickPhrases, setQuickPhrases] = useState<QuickPhraseRecord[]>(DEFAULT_QUICK_PHRASES);
  const [quickPhraseModalOpen, setQuickPhraseModalOpen] = useState(false);
  const [quickPhraseCreateModalOpen, setQuickPhraseCreateModalOpen] = useState(false);
  const [quickPhraseDraft, setQuickPhraseDraft] = useState("");
  const [quickPhraseSaving, setQuickPhraseSaving] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const submitLockRef = useRef(false);
  const attachmentRegistryRef = useRef(new Set<string>());
  const attachmentDraftCacheRef = useRef(new Map<string, StoredComposerDraftAttachment>());
  const quickPhraseMutationVersionRef = useRef(0);
  const { showToast } = useToast();
  const haptics = useHaptics();

  const provider = getProviderFromCapabilities(capabilities);
  const accountProviderPreferences = usePreferencesSelector((state) =>
    isPreferenceProviderId(provider) ? state.profile.providers[provider] : null
  );
  const accountPreferredModel = accountProviderPreferences?.defaultModel ?? null;
  const accountPreferredReasoningLevel =
    accountProviderPreferences?.defaultReasoningLevel ?? null;
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
  const availableModels = useMemo(() => {
    const providerModels = capabilities?.modelOptions?.map((model) => ({
      ...model,
      provider,
      supportedReasoningEfforts: model.supportedReasoningEfforts?.filter(
        (effort): effort is ReasoningLevel =>
          effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh"
      )
    }));

    if (providerModels?.length) {
      return providerModels;
    }

    return getFallbackModelOptions(provider);
  }, [capabilities?.modelOptions, provider]);
  const selectedModelOption = useMemo(
    () => availableModels.find((model) => model.id === selectedModel) ?? null,
    [availableModels, selectedModel]
  );
  const reasoningSelectorEnabled = supportsReasoningSelector(capabilities);
  const slashMenuEnabled = shouldShowSlashMenu(capabilities);
  const reasoningLevelCatalog = useMemo(
    () => [
      { value: "low" as const, label: t("conversation.reasoningLow") },
      { value: "medium" as const, label: t("conversation.reasoningMedium") },
      { value: "high" as const, label: t("conversation.reasoningHigh") },
      { value: "xhigh" as const, label: t("conversation.reasoningMaximum") }
    ],
    []
  );
  const availableReasoningLevels = useMemo(() => {
    if (!reasoningSelectorEnabled) {
      return [];
    }

    const supportedEfforts = selectedModelOption?.supportedReasoningEfforts;

    if (!supportedEfforts || supportedEfforts.length === 0) {
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
  const inRunInputMode = capabilities?.inRunInputMode ?? "none";
  const runHasActiveFlag = hasActiveRun ?? null;
  const isUnmanagedStreamingRun =
    isRunning &&
    inRunInputMode === "streaming_guidance" &&
    runHasActiveFlag === false &&
    !shouldSupportRunSteering(capabilities);
  const canStreamDuringRun =
    isRunning &&
    inRunInputMode === "streaming_guidance" &&
    !isUnmanagedStreamingRun;
  const canQueueDuringRun =
    isRunning &&
    typeof onQueueSend === "function" &&
    allowsQueueDuringRun(capabilities, runHasActiveFlag);
  const inRunSendBlocked = isRunning && !canStreamDuringRun && !canQueueDuringRun;
  const hasDraft = content.trim().length > 0 || attachments.length > 0;
  const interruptAvailable = canInterrupt ?? interruptDecision.allowed;
  const canInterruptNow =
    isRunning && interruptAvailable && Boolean(onInterrupt) && !interrupting;
  // 按钮只保留一个主状态：运行中优先显示停止；只有用户已经写了新内容，才切到可发送态。
  const showInterruptButton =
    canInterruptNow && !hasDraft && !localSubmitting && !isSubmitting;
  const showBusyButton =
    !showInterruptButton &&
    !hasDraft &&
    (
      localSubmitting
      || isSubmitting
      || isRunning
      || (!isRunning && hasPendingQueuedMessages)
    );
  const busyButtonLabel =
    localSubmitting || isSubmitting || hasPendingQueuedMessages
      ? t("conversation.sendingState")
      : t("conversation.runtimeRunning");
  const sendButtonLabel = isRunning
    ? canQueueDuringRun
        ? t("conversation.queueGuidanceButton")
        : canStreamDuringRun
          ? t("conversation.sendGuidanceButton")
          : t("conversation.sendButton")
    : t("conversation.sendButton");

  const handleModelChange = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    if (isPreferenceProviderId(provider)) {
      void updatePreferences({
        providers: {
          [provider]: {
            defaultModel: modelId
          }
        }
      }).catch(() => undefined);
    }
  }, [provider]);

  const handleReasoningLevelChange = useCallback((level: ReasoningLevel) => {
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

  const replaceAttachments = useCallback((nextAttachments: ComposerImageAttachment[]) => {
    attachmentRegistryRef.current.forEach((previewUrl) => {
      URL.revokeObjectURL(previewUrl);
    });
    attachmentRegistryRef.current.clear();
    nextAttachments.forEach((attachment) => {
      attachmentRegistryRef.current.add(attachment.previewUrl);
    });
    setAttachments(nextAttachments);
  }, []);

  const mergeAttachments = useCallback((incomingFiles: File[]) => {
    const { accepted, rejectedCount } = collectImageFiles(incomingFiles);

    if (rejectedCount > 0) {
      showToast({
        title: t("conversation.attachmentImageOnly"),
        tone: "error"
      });
    }

    if (accepted.length === 0) {
      return;
    }

    setAttachments((current) => {
      const next = mergeImageAttachments(current, accepted);

      next.forEach((attachment) => {
        attachmentRegistryRef.current.add(attachment.previewUrl);
      });

      return next;
    });
  }, [showToast]);

  const removeAttachment = useCallback((attachmentId: string) => {
    attachmentDraftCacheRef.current.delete(attachmentId);
    setAttachments((current) => {
      const target = current.find((item) => item.id === attachmentId);

      if (target) {
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

  const restoreDraftState = useCallback((storageId?: string) => {
    const storedDraft = storageId ? readComposerDraftRecord(storageId) : null;
    const restoredAttachments = storedDraft?.attachments.map((attachment) => restoreDraftAttachment(attachment)) ?? [];

    attachmentDraftCacheRef.current = new Map(
      (storedDraft?.attachments ?? []).map((attachment) => [attachment.id, attachment])
    );
    replaceAttachments(restoredAttachments);
    setContent(storedDraft?.content ?? "");
    setShowSlashMenu(false);
  }, [replaceAttachments]);

  useEffect(() => {
    if (!availableModels.length) {
      return;
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

    if (availableModels.some((model) => model.id === selectedModel)) {
      return;
    }

    const fallbackModel = availableModels[0]!.id;
    setSelectedModel(fallbackModel);
  }, [availableModels, provider, selectedModel, accountPreferredModel]);

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
    accountPreferredReasoningLevel
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
      if (content.length === 0 && attachments.length === 0) {
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
            cached.mimeType === (attachment.file.type || "image/png")
          ) {
            return cached;
          }

          return {
            id: attachment.id,
            fileName: attachment.file.name,
            mimeType: attachment.file.type || "image/png",
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
        content,
        attachments: storedAttachments
      });
    }

    void persistDraft();

    return () => {
      disposed = true;
    };
  }, [attachments, content, draftStorageId]);

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

  async function submitMessage(mode: "send" | "queue"): Promise<void> {
    // 发送状态依赖父组件异步回流，这里额外加一层同步锁，防止双击和连按 Enter。
    if (submitLockRef.current) {
      return;
    }

    const nextContent = content.trim();
    const nextAttachments = attachments;

    if ((nextContent.length === 0 && nextAttachments.length === 0) || !sendDecision.allowed || inRunSendBlocked) {
      showToast({
        title: inRunSendBlocked
          ? t("conversation.runtimeRunning")
          : sendDecision.reason ?? t("conversation.capabilityDenied"),
        tone: "error"
      });
      return;
    }

    submitLockRef.current = true;
    void haptics.trigger(mode === "queue" ? "selection" : "action");
    setLocalSubmitting(true);
    setContent("");
    setAttachments([]);
    setAttachmentSheetOpen(false);
    setQuickPhraseModalOpen(false);
    setQuickPhraseCreateModalOpen(false);
    setShowSlashMenu(false);

    try {
      const payloads = await Promise.all(
        nextAttachments.map(async (attachment) => ({
          fileName: attachment.file.name,
          mimeType: attachment.file.type || "image/png",
          fileSize: attachment.file.size,
          contentBase64: await readFileAsBase64(attachment.file)
        }))
      );
      const attachmentMeta = nextAttachments.map((attachment) =>
        toAttachmentMeta(attachment.file, attachment.id)
      );

      const sendHandler =
        mode === "queue" && onQueueSend
          ? onQueueSend
          : onSend;

      await sendHandler(nextContent, {
        model: selectedModelOption?.usesProviderDefault ? undefined : selectedModel || undefined,
        reasoningLevel:
          reasoningSelectorEnabled && availableReasoningLevels.length > 0 ? reasoningLevel : undefined,
        attachments: payloads,
        attachmentMeta
      });

      revokeAttachmentPreviews(nextAttachments);
      nextAttachments.forEach((attachment) => {
        attachmentRegistryRef.current.delete(attachment.previewUrl);
      });
    } catch (error) {
      setContent(nextContent);
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
    !sendDecision.allowed ||
    !hasDraft;
  const attachButtonDisabled =
    localSubmitting ||
    isSubmitting ||
    inRunSendBlocked ||
    !attachmentDecision.allowed;
  const showQuickPhraseButton = content.length === 0 && !inRunSendBlocked;

  const contentNode = (
    <section ref={panelRef} className="composer-panel">
      <form className="composer-form" onSubmit={handleSubmit}>
        <input
          id={libraryInputId}
          ref={libraryInputRef}
          type="file"
          accept="image/*"
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
        <div className="composer-input-container">
          {attachments.length > 0 ? (
            <div className="composer-attachments">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="composer-attachment-card">
                  <img
                    src={attachment.previewUrl}
                    alt={t("conversation.attachmentPreviewAlt")}
                    className="composer-attachment-preview"
                  />
                  <div className="composer-attachment-meta">
                    <span className="attachment-name" title={attachment.file.name}>
                      {attachment.file.name}
                    </span>
                    <span className="attachment-size">
                      {(attachment.file.size / 1024).toFixed(1)} KB
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

          <div className="composer-input-wrapper">
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
                }

                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();

                  if (!isDisabled) {
                    void handleSubmit(event as unknown as React.FormEvent<HTMLFormElement>);
                  }
                }
              }}
            />

            {showQuickPhraseButton ? (
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
            ) : null}
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

              <MacSelect
                ariaLabel={t("conversation.modelSelectorLabel")}
                value={selectedModel}
                options={modelSelectOptions}
                onChange={handleModelChange}
              />

              {reasoningSelectorEnabled && availableReasoningLevels.length > 0 ? (
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

              <ContextUsageRing contextUsage={contextUsage} />
            </div>

            {showBusyButton ? (
              <div className="composer-send-group">
                <button
                  className="composer-send composer-send-busy"
                  type="button"
                  disabled
                  aria-label={busyButtonLabel}
                  title={busyButtonLabel}
                >
                  <svg className="composer-send-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle
                      cx="12"
                      cy="12"
                      r="8"
                      stroke="currentColor"
                      strokeOpacity="0.28"
                      strokeWidth="2.5"
                    />
                    <path
                      d="M20 12a8 8 0 0 0-8-8"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="composer-send-group">
                {showInterruptButton ? (
                  <button
                    className="composer-send composer-send-busy"
                    type="button"
                    onClick={() => {
                      void handleInterrupt();
                    }}
                    aria-label={t("conversation.capabilityInterrupt")}
                    title={t("conversation.capabilityInterrupt")}
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
            )}
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
  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="ios-action-sheet-overlay composer-attachment-sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="mobile-workspace-home-sheet composer-attachment-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("conversation.attachmentSourceSheetTitle")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mobile-workspace-home-sheet-card composer-attachment-sheet-card">
          <div className="mobile-workspace-home-sheet-header">
            <strong>{t("conversation.attachmentSourceSheetTitle")}</strong>
            <span>{t("conversation.attachmentSourceSheetDescription")}</span>
          </div>

          <div className="mobile-workspace-home-group composer-attachment-sheet-actions">
            <button
              type="button"
              className="mobile-workspace-home-row composer-attachment-sheet-option"
              aria-label={t("conversation.attachmentTakePhoto")}
              onClick={onSelectCamera}
            >
              <span className="composer-attachment-sheet-option-copy">
                <strong>{t("conversation.attachmentTakePhoto")}</strong>
                <span>{t("conversation.attachmentTakePhotoHint")}</span>
              </span>
              <CameraIcon />
            </button>
            <button
              type="button"
              className="mobile-workspace-home-row composer-attachment-sheet-option"
              aria-label={t("conversation.attachmentChooseFromLibrary")}
              onClick={onSelectLibrary}
            >
              <span className="composer-attachment-sheet-option-copy">
                <strong>{t("conversation.attachmentChooseFromLibrary")}</strong>
                <span>{t("conversation.attachmentChooseFromLibraryHint")}</span>
              </span>
              <LibraryIcon />
            </button>
          </div>
        </div>
        <button type="button" className="ios-action-sheet-cancel" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </div>,
    document.body
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

function MacSelect({
  ariaLabel,
  value,
  options,
  onChange,
  compact = false
}: {
  ariaLabel: string;
  value: string;
  options: ComposerSelectOption[];
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const listboxId = useId();
  const selectedOption = options.find((option) => option.value === value) ?? options[0] ?? null;

  const updatePopoverStyle = useCallback(() => {
    const trigger = triggerRef.current;

    if (!trigger || typeof window === "undefined") {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const edgePadding = 12;
    const gap = 10;
    const maxWidth = Math.max(160, viewportWidth - edgePadding * 2);
    const preferredWidth = compact ? 140 : 220;
    const width = Math.min(maxWidth, Math.max(rect.width, preferredWidth));
    const left = Math.min(
      Math.max(edgePadding, rect.left),
      Math.max(edgePadding, viewportWidth - width - edgePadding)
    );
    const spaceAbove = rect.top - edgePadding;
    const spaceBelow = viewportHeight - rect.bottom - edgePadding;
    const shouldPlaceAbove = spaceAbove >= 180 || spaceAbove >= spaceBelow;

    setPopoverStyle({
      position: "fixed",
      left,
      width,
      maxWidth,
      top: shouldPlaceAbove ? undefined : rect.bottom + gap,
      bottom: shouldPlaceAbove ? viewportHeight - rect.top + gap : undefined
    });
  }, [compact]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (
        !wrapperRef.current?.contains(target)
        && !popoverRef.current?.contains(target)
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
    window.addEventListener("resize", updatePopoverStyle);
    window.addEventListener("scroll", updatePopoverStyle, true);
    updatePopoverStyle();

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", updatePopoverStyle);
      window.removeEventListener("scroll", updatePopoverStyle, true);
    };
  }, [open, updatePopoverStyle]);

  if (!selectedOption) {
    return null;
  }

  return (
    <div
      ref={wrapperRef}
      className={`composer-mac-select ${compact ? "is-compact" : ""}`}
      data-open={open ? "true" : "false"}
    >
      <button
        ref={triggerRef}
        type="button"
        className="composer-mac-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="composer-mac-select-label">{selectedOption.label}</span>
        <svg
          className="composer-mac-select-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 14 12 8 18 14" />
        </svg>
      </button>

      {open && popoverStyle && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              className="composer-mac-select-popover"
              style={popoverStyle}
              role="presentation"
            >
              <div
                id={listboxId}
                className="composer-mac-select-list"
                role="listbox"
                aria-label={ariaLabel}
              >
                {options.map((option) => {
                  const selected = option.value === value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`composer-mac-select-option ${selected ? "is-selected" : ""}`}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                    >
                      <span className="composer-mac-select-option-check" aria-hidden="true">
                        {selected ? "✓" : ""}
                      </span>
                      <span className="composer-mac-select-option-label">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function ContextUsageRing({ contextUsage }: { contextUsage: ContextUsageDto | null }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);
  const tooltipId = useId();
  const usagePercent = contextUsage ? Math.round(contextUsage.usageRatio * 100) : null;
  const progress = contextUsage ? Math.max(0, Math.min(contextUsage.usageRatio, 1)) : 0;
  const stateClassName = getContextUsageStateClassName(progress);
  const sourceText = contextUsage ? formatContextWindowSource(contextUsage.contextWindowSource) : null;
  const label = contextUsage
    ? `${t("conversation.contextUsageTitle")} ${usagePercent}%`
    : t("conversation.contextUsageUnavailable");

  const updateTooltipStyle = useCallback(() => {
    const trigger = triggerRef.current;

    if (!trigger || typeof window === "undefined") {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const edgePadding = 12;
    const gap = 10;
    const width = Math.min(240, Math.max(188, viewportWidth - edgePadding * 2));
    const left = Math.min(
      Math.max(edgePadding, rect.left + rect.width / 2 - width / 2),
      Math.max(edgePadding, viewportWidth - width - edgePadding)
    );
    const spaceAbove = rect.top - edgePadding;
    const spaceBelow = viewportHeight - rect.bottom - edgePadding;
    const shouldPlaceAbove = spaceAbove >= 140 || spaceAbove >= spaceBelow;

    setTooltipStyle({
      position: "fixed",
      left,
      width,
      maxWidth: viewportWidth - edgePadding * 2,
      top: shouldPlaceAbove ? undefined : rect.bottom + gap,
      bottom: shouldPlaceAbove ? viewportHeight - rect.top + gap : undefined
    });
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (!triggerRef.current?.contains(target) && !tooltipRef.current?.contains(target)) {
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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`composer-context-ring ${stateClassName}`}
        style={
          {
            "--context-usage-progress": `${progress}`
          } as CSSProperties
        }
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onClick={() => setOpen((current) => !current)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <span className="composer-context-ring-value">
          {usagePercent === null ? (
            "--"
          ) : (
            <>
              <span>{usagePercent}</span>
              <span className="composer-context-ring-suffix">%</span>
            </>
          )}
        </span>
      </button>

      {open && tooltipStyle && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              className="composer-context-tooltip"
              style={tooltipStyle}
              role="tooltip"
            >
              {contextUsage ? (
                <>
                  <div className="composer-context-tooltip-title">
                    {t("conversation.contextUsageTitle")}
                  </div>
                  <div className="composer-context-tooltip-line">
                    {usagePercent}% · {formatTokenCount(contextUsage.promptTokens)} /{" "}
                    {formatTokenCount(contextUsage.contextWindow)} tokens
                  </div>
                  {contextUsage.cachedInputTokens > 0 ? (
                    <div className="composer-context-tooltip-line">
                      {t("conversation.contextUsageCachedTokens").replace(
                        "{count}",
                        formatTokenCount(contextUsage.cachedInputTokens)
                      )}
                    </div>
                  ) : null}
                  {sourceText ? (
                    <div className="composer-context-tooltip-meta">{sourceText}</div>
                  ) : null}
                  {contextUsage.isEstimated ? (
                    <div className="composer-context-tooltip-meta">
                      {t("conversation.contextUsageEstimated")}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="composer-context-tooltip-line">
                  {t("conversation.contextUsageUnavailable")}
                </div>
              )}
            </div>,
            document.body
          )
        : null}
    </>
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

function formatContextWindowSource(
  source: ContextUsageDto["contextWindowSource"]
): string {
  switch (source) {
    case "provider-log":
      return t("conversation.contextUsageSourceProviderLog");
    case "provider-runtime":
      return t("conversation.contextUsageSourceProviderRuntime");
    case "provider-config":
      return t("conversation.contextUsageSourceProviderConfig");
    case "model-map":
      return t("conversation.contextUsageSourceModelMap");
    default:
      return "";
  }
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}
