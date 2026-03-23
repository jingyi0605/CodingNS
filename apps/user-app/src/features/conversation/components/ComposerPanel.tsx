import { useMemo, useState } from "react";

import { t } from "../../../shared/i18n";
import { decideCapability } from "../capability/capability-gate";
import type { ProviderCapabilitiesDto } from "../api/conversation-api";

interface ComposerPanelProps {
  capabilities: ProviderCapabilitiesDto | null;
  isSubmitting: boolean;
  onSend: (content: string) => Promise<void>;
}

export function ComposerPanel({ capabilities, isSubmitting, onSend }: ComposerPanelProps) {
  const [content, setContent] = useState("");
  const [statusText, setStatusText] = useState<string | null>(null);

  const sendDecision = useMemo(
    () => decideCapability(capabilities, "send_message"),
    [capabilities]
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!content.trim() || !sendDecision.allowed) {
      setStatusText(sendDecision.reason);
      return;
    }

    setStatusText(null);

    try {
      await onSend(content.trim());
      setContent("");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("conversation.capabilityDenied"));
    }
  }

  return (
    <section className="composer-panel">
      <form className="composer-form" onSubmit={handleSubmit}>
        <div className="composer-input-wrapper">
          <textarea
            className="composer-input"
            value={content}
            placeholder={t("conversation.composerPlaceholder")}
            onChange={(event) => setContent(event.target.value)}
            rows={3}
          />
          <button
            className="composer-send"
            type="submit"
            disabled={isSubmitting || !sendDecision.allowed || !content.trim()}
            aria-label={t("conversation.sendButton")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>

        {statusText && (
          <p className="composer-error">{statusText}</p>
        )}
      </form>
    </section>
  );
}
