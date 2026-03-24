import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import { decideCapability } from "../capability/capability-gate";
import type { ProviderCapabilitiesDto, ProviderId } from "../api/conversation-api";

interface ComposerPanelProps {
  capabilities: ProviderCapabilitiesDto | null;
  isSubmitting: boolean;
  isRunning?: boolean;
  onInterrupt?: () => Promise<void> | void;
  onSend: (content: string, options?: { model?: string; reasoningLevel?: string }) => Promise<void>;
}

type ModelOption = {
  id: string;
  name: string;
  provider: ProviderId;
};

type ReasoningLevel = "low" | "medium" | "high" | "maximum";

const MODEL_OPTIONS: ModelOption[] = [
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "claude-code" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "claude-code" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "claude-code" },
  { id: "gpt-5.4", name: "GPT-5.4", provider: "codex" },
  { id: "gpt-4.1", name: "GPT-4.1", provider: "codex" },
  { id: "gpt-4o", name: "GPT-4o", provider: "codex" }
];

export function ComposerPanel({
  capabilities,
  isSubmitting,
  isRunning = false,
  onInterrupt,
  onSend
}: ComposerPanelProps) {
  const [content, setContent] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    const saved = localStorage.getItem("composer-selected-model");
    return saved || "claude-sonnet-4-6";
  });
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>(() => {
    const saved = localStorage.getItem("composer-reasoning-level");
    return (saved as ReasoningLevel) || "medium";
  });
  const [attachments, setAttachments] = useState<File[]>([]);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submitLockRef = useRef(false);
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
  const availableModels = useMemo(
    () => MODEL_OPTIONS.filter((model) => model.provider === provider),
    [provider]
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
    localStorage.setItem("composer-selected-model", modelId);
  }, []);

  const handleReasoningLevelChange = useCallback((level: ReasoningLevel) => {
    setReasoningLevel(level);
    localStorage.setItem("composer-reasoning-level", level);
  }, []);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;

    if (files && files.length > 0) {
      setAttachments((current) => [...current, ...Array.from(files)]);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index));
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

    if (availableModels.some((model) => model.id === selectedModel)) {
      return;
    }

    const fallbackModel = availableModels[0]!.id;
    setSelectedModel(fallbackModel);
    localStorage.setItem("composer-selected-model", fallbackModel);
  }, [availableModels, selectedModel]);

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

    // 当前后端尚不支持附件时，主动清理本地附件状态，避免 UI 伪装可用
    setAttachments([]);
  }, [attachmentDecision.allowed]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // 发送状态依赖父组件异步回流，这里额外加一层同步锁，防止双击和连按 Enter。
    if (submitLockRef.current) {
      return;
    }

    const nextContent = content.trim();

    if (!nextContent || !sendDecision.allowed) {
      showToast({
        title: sendDecision.reason ?? t("conversation.capabilityDenied"),
        tone: "error"
      });
      return;
    }

    const nextAttachments = attachments;
    submitLockRef.current = true;
    setLocalSubmitting(true);
    setContent("");
    setAttachments([]);
    setShowSlashMenu(false);

    try {
      await onSend(nextContent, {
        model: selectedModel,
        reasoningLevel: provider === "codex" ? reasoningLevel : undefined
      });
    } catch (error) {
      setContent(nextContent);
      setAttachments(nextAttachments);
      showToast({
        title: error instanceof Error ? error.message : t("conversation.capabilityDenied"),
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

  const isDisabled = interactionActive || !sendDecision.allowed || !content.trim();

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
            accept="image/*,.pdf,.txt,.md,.json,.js,.ts,.jsx,.tsx,.py,.java,.go,.rs,.c,.cpp,.h,.hpp,.css,.scss,.html,.xml,.yaml,.yml,.sql,.sh,.bash,.zsh,.ps1,.bat,.cmd,.dockerfile,.gitignore,.env,.lock,package.json,Cargo.toml,go.mod,pom.xml,build.gradle"
          />

          {attachments.length > 0 ? (
            <div className="composer-attachments">
              {attachments.map((file, index) => (
                <div key={`${file.name}-${index}`} className="composer-attachment-chip">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                  <span className="attachment-name">{file.name}</span>
                  {attachments.length > 1 && index === 0 ? (
                    <span className="attachment-count">+{attachments.length - 1}</span>
                  ) : null}
                  <button
                    type="button"
                    className="attachment-remove"
                    onClick={() => removeAttachment(index)}
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
                title={t("conversation.attachFiles")}
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
