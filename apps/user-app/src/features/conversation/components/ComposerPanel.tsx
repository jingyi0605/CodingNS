import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import { decideCapability } from "../capability/capability-gate";
import type {
  ImageAttachmentPayload,
  MessageAttachmentDto,
  ProviderCapabilitiesDto,
  ProviderId
} from "../api/conversation-api";

interface ComposerPanelProps {
  capabilities: ProviderCapabilitiesDto | null;
  isSubmitting: boolean;
  isRunning?: boolean;
  onInterrupt?: () => Promise<void> | void;
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
};

type ReasoningLevel = "low" | "medium" | "high" | "maximum";

interface ComposerImageAttachment {
  id: string;
  file: File;
  previewUrl: string;
}

const DEFAULT_CLAUDE_MODEL_ID = "provider-default";
const FOCUS_COMPOSER_EVENT = "workbench:focus-composer";
const MODEL_OPTIONS: ModelOption[] = [
  { id: "gpt-5.4", name: "GPT-5.4", provider: "codex" },
  { id: "gpt-4.1", name: "GPT-4.1", provider: "codex" },
  { id: "gpt-4o", name: "GPT-4o", provider: "codex" }
];

function createFallbackClaudeModelOptions(): ModelOption[] {
  return [
    {
      id: DEFAULT_CLAUDE_MODEL_ID,
      name: t("conversation.modelUseCliDefault"),
      provider: "claude-code",
      usesProviderDefault: true
    }
  ];
}

function getModelStorageKey(provider: ProviderId): string {
  return `composer-selected-model:${provider}`;
}

function createAttachmentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  isSubmitting,
  isRunning = false,
  onInterrupt,
  onSend
}: ComposerPanelProps) {
  const [content, setContent] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>(() => {
    const saved = localStorage.getItem("composer-reasoning-level");
    return (saved as ReasoningLevel) || "medium";
  });
  const [attachments, setAttachments] = useState<ComposerImageAttachment[]>([]);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submitLockRef = useRef(false);
  const attachmentRegistryRef = useRef(new Set<string>());
  const { showToast } = useToast();

  const provider: ProviderId = capabilities?.provider || "claude-code";
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
    if (provider === "claude-code") {
      const providerModels = capabilities?.modelOptions?.map((model) => ({
        ...model,
        provider
      }));

      return providerModels?.length ? providerModels : createFallbackClaudeModelOptions();
    }

    return MODEL_OPTIONS.filter((model) => model.provider === provider);
  }, [capabilities?.modelOptions, provider]);
  const selectedModelOption = useMemo(
    () => availableModels.find((model) => model.id === selectedModel) ?? null,
    [availableModels, selectedModel]
  );
  const reasoningLevels = useMemo(
    () => [
      { value: "low" as const, label: t("conversation.reasoningLow") },
      { value: "medium" as const, label: t("conversation.reasoningMedium") },
      { value: "high" as const, label: t("conversation.reasoningHigh") },
      { value: "maximum" as const, label: t("conversation.reasoningMaximum") }
    ],
    []
  );
  const slashCommands = useMemo(
    () => [
      { command: "/plan", label: t("conversation.slashCommandPlan") },
      { command: "/review", label: t("conversation.slashCommandReview") },
      { command: "/explain", label: t("conversation.slashCommandExplain") }
    ],
    []
  );
  const interactionActive = localSubmitting || isSubmitting || isRunning;
  const interactionLabel = interactionActive
    ? localSubmitting || isSubmitting
      ? t("conversation.sendingState")
      : t("conversation.runtimeRunning")
    : null;
  const canInterruptNow =
    isRunning && interruptDecision.allowed && Boolean(onInterrupt) && !interrupting;

  const handleModelChange = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    localStorage.setItem(getModelStorageKey(provider), modelId);
  }, [provider]);

  const handleReasoningLevelChange = useCallback((level: ReasoningLevel) => {
    setReasoningLevel(level);
    localStorage.setItem("composer-reasoning-level", level);
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

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;

    if (files && files.length > 0) {
      mergeAttachments(Array.from(files));
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [mergeAttachments]);

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((current) => {
      const target = current.find((item) => item.id === attachmentId);

      if (target) {
        attachmentRegistryRef.current.delete(target.previewUrl);
        URL.revokeObjectURL(target.previewUrl);
      }

      return current.filter((item) => item.id !== attachmentId);
    });
  }, []);

  const openFilePicker = useCallback(() => {
    if (!attachmentDecision.allowed) {
      showToast({
        title: attachmentDecision.reason ?? t("conversation.capabilityDenied"),
        tone: "error"
      });
      return;
    }

    fileInputRef.current?.click();
  }, [attachmentDecision.allowed, attachmentDecision.reason, showToast]);

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

  useEffect(() => {
    if (!availableModels.length) {
      return;
    }

    const saved = localStorage.getItem(getModelStorageKey(provider));

    if (saved && availableModels.some((model) => model.id === saved)) {
      if (selectedModel !== saved) {
        setSelectedModel(saved);
      }
      return;
    }

    if (availableModels.some((model) => model.id === selectedModel)) {
      return;
    }

    const fallbackModel = availableModels[0]!.id;
    setSelectedModel(fallbackModel);
    localStorage.setItem(getModelStorageKey(provider), fallbackModel);
  }, [availableModels, provider, selectedModel]);

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

    setAttachments((current) => {
      revokeAttachmentPreviews(current);
      current.forEach((attachment) => {
        attachmentRegistryRef.current.delete(attachment.previewUrl);
      });
      return [];
    });
  }, [attachmentDecision.allowed]);

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // 发送状态依赖父组件异步回流，这里额外加一层同步锁，防止双击和连按 Enter。
    if (submitLockRef.current) {
      return;
    }

    const nextContent = content.trim();
    const nextAttachments = attachments;

    if ((nextContent.length === 0 && nextAttachments.length === 0) || !sendDecision.allowed) {
      showToast({
        title: sendDecision.reason ?? t("conversation.capabilityDenied"),
        tone: "error"
      });
      return;
    }

    submitLockRef.current = true;
    setLocalSubmitting(true);
    setContent("");
    setAttachments([]);
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

      await onSend(nextContent, {
        model: selectedModelOption?.usesProviderDefault ? undefined : selectedModel || undefined,
        reasoningLevel: provider === "codex" ? reasoningLevel : undefined,
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

  async function handleInterrupt(): Promise<void> {
    if (!interruptDecision.allowed || !onInterrupt || interrupting) {
      return;
    }

    try {
      setInterrupting(true);
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
    interactionActive ||
    !sendDecision.allowed ||
    (content.trim().length === 0 && attachments.length === 0);

  return (
    <section className="composer-panel">
      <form className="composer-form" onSubmit={handleSubmit}>
        <div className="composer-input-container">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={handleFileSelect}
            accept="image/*"
          />

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
              placeholder={t("conversation.composerPlaceholder")}
              onChange={(event) => setContent(event.target.value)}
              rows={1}
              onFocus={() => setShowSlashMenu(false)}
              onPaste={(event) => {
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
          </div>

          {provider === "claude-code" && showSlashMenu ? (
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
              <div className="composer-provider-logo">
                {provider === "codex" ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="4" />
                    <path d="M8 12h8M12 8v8" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v8M8 12h8" />
                  </svg>
                )}
              </div>

              <div className="composer-select-wrapper">
                <select
                  value={selectedModel}
                  onChange={(event) => handleModelChange(event.target.value)}
                  className="composer-select"
                  aria-label={t("conversation.modelSelectorLabel")}
                >
                  {availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
                <svg className="composer-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>

              {provider === "codex" ? (
                <div className="composer-select-wrapper">
                  <select
                    value={reasoningLevel}
                    onChange={(event) => handleReasoningLevelChange(event.target.value as ReasoningLevel)}
                    className="composer-select"
                    aria-label={t("conversation.reasoningSelectorLabel")}
                  >
                    {reasoningLevels.map((level) => (
                      <option key={level.value} value={level.value}>
                        {level.label}
                      </option>
                    ))}
                  </select>
                  <svg className="composer-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              ) : null}

              {provider === "claude-code" ? (
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

              <button
                type="button"
                className="composer-attach-btn"
                onClick={openFilePicker}
                title={`${t("conversation.attachFiles")} · ${t("conversation.pasteImagesHint")}`}
                disabled={!attachmentDecision.allowed}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>

            {interactionActive ? (
              <button
                className="composer-send composer-send-busy"
                type="button"
                onClick={() => {
                  if (canInterruptNow) {
                    void handleInterrupt();
                  }
                }}
                disabled={!canInterruptNow}
                aria-label={canInterruptNow ? t("conversation.capabilityInterrupt") : interactionLabel ?? t("conversation.sendingState")}
                title={canInterruptNow ? t("conversation.capabilityInterrupt") : interactionLabel ?? t("conversation.sendingState")}
              >
                {canInterruptNow ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="6" y="6" width="12" height="12" />
                  </svg>
                ) : (
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
                )}
              </button>
            ) : (
              <button
                className="composer-send"
                type="submit"
                disabled={isDisabled}
                aria-label={t("conversation.sendButton")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
