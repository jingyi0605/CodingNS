import { useMemo, useState, useRef, useCallback } from "react";

import { t } from "../../../shared/i18n";
import { decideCapability } from "../capability/capability-gate";
import type { ProviderCapabilitiesDto, ProviderId } from "../api/conversation-api";

interface ComposerPanelProps {
  capabilities: ProviderCapabilitiesDto | null;
  isSubmitting: boolean;
  onSend: (content: string, options?: { model?: string; reasoningLevel?: string }) => Promise<void>;
}

type ModelOption = {
  id: string;
  name: string;
  provider: ProviderId;
};

type ReasoningLevel = "low" | "medium" | "high" | "maximum";

const MODEL_OPTIONS: ModelOption[] = [
  // Claude models
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "claude-code" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "claude-code" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "claude-code" },
  // Codex models
  { id: "gpt-5.4", name: "GPT-5.4", provider: "codex" },
  { id: "gpt-4.1", name: "GPT-4.1", provider: "codex" },
  { id: "gpt-4o", name: "GPT-4o", provider: "codex" },
];

const REASONING_LEVELS: { value: ReasoningLevel; label: string }[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "maximum", label: "极高" },
];

export function ComposerPanel({ capabilities, isSubmitting, onSend }: ComposerPanelProps) {
  const [content, setContent] = useState("");
  const [statusText, setStatusText] = useState<string | null>(null);
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const provider: ProviderId = capabilities?.provider || "claude-code";

  const sendDecision = useMemo(
    () => decideCapability(capabilities, "send_message"),
    [capabilities]
  );

  const availableModels = useMemo(
    () => MODEL_OPTIONS.filter((m) => m.provider === provider),
    [provider]
  );

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
      setAttachments((prev) => [...prev, ...Array.from(files)]);
    }
    // Reset input value to allow selecting the same file again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleSlashCommand = useCallback(() => {
    setShowSlashMenu((prev) => !prev);
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!content.trim() || !sendDecision.allowed) {
      setStatusText(sendDecision.reason);
      return;
    }

    setStatusText(null);

    try {
      await onSend(content.trim(), {
        model: selectedModel,
        reasoningLevel: provider === "codex" ? reasoningLevel : undefined,
      });
      setContent("");
      setAttachments([]);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("conversation.capabilityDenied"));
    }
  }

  const isDisabled = isSubmitting || !sendDecision.allowed || !content.trim();

  return (
    <section className="composer-panel">
      <form className="composer-form" onSubmit={handleSubmit}>
        {/* Main Input Container - Styled like the image */}
        <div className="composer-input-container">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={handleFileSelect}
            accept="image/*,.pdf,.txt,.md,.json,.js,.ts,.jsx,.tsx,.py,.java,.go,.rs,.c,.cpp,.h,.hpp,.css,.scss,.html,.xml,.yaml,.yml,.sql,.sh,.bash,.zsh,.ps1,.bat,.cmd,.dockerfile,.gitignore,.env,.lock,package.json,Cargo.toml,go.mod,pom.xml,build.gradle"
          />

          {/* Attachment indicator */}
          {attachments.length > 0 && (
            <div className="composer-attachments">
              {attachments.map((file, index) => (
                <div key={index} className="composer-attachment-chip">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                  <span className="attachment-name">{file.name}</span>
                  {attachments.length > 1 && index === 0 && (
                    <span className="attachment-count">+{attachments.length - 1}</span>
                  )}
                  <button
                    type="button"
                    className="attachment-remove"
                    onClick={() => removeAttachment(index)}
                    aria-label="Remove attachment"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="composer-input-wrapper">
            <textarea
              ref={textareaRef}
              className="composer-input"
              value={content}
              placeholder={t("conversation.composerPlaceholder")}
              onChange={(event) => setContent(event.target.value)}
              rows={1}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!isDisabled) {
                    handleSubmit(e as unknown as React.FormEvent<HTMLFormElement>);
                  }
                }
              }}
            />
          </div>

          {/* Bottom Controls Bar */}
          <div className="composer-controls">
            {/* Left side controls */}
            <div className="composer-controls-left">
              {/* Provider Logo */}
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

              {/* Model Selector */}
              <div className="composer-select-wrapper">
                <select
                  value={selectedModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="composer-select"
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

              {/* Reasoning Level Selector - Only for Codex */}
              {provider === "codex" && (
                <div className="composer-select-wrapper">
                  <select
                    value={reasoningLevel}
                    onChange={(e) => handleReasoningLevelChange(e.target.value as ReasoningLevel)}
                    className="composer-select"
                  >
                    {REASONING_LEVELS.map((level) => (
                      <option key={level.value} value={level.value}>
                        {level.label}
                      </option>
                    ))}
                  </select>
                  <svg className="composer-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              )}

              {/* Claude-specific: Slash Commands */}
              {provider === "claude-code" && (
                <button
                  type="button"
                  className="composer-slash-btn"
                  onClick={handleSlashCommand}
                  title="命令菜单"
                >
                  <span className="slash-icon">/</span>
                  <span>菜单</span>
                </button>
              )}

              {/* Attach Button */}
              <button
                type="button"
                className="composer-attach-btn"
                onClick={openFilePicker}
                title={t("conversation.attachFiles")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>

            {/* Right side - Send Button */}
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
          </div>
        </div>

        {statusText && (
          <p className="composer-error">{statusText}</p>
        )}
      </form>
    </section>
  );
}
