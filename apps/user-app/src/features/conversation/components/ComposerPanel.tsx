import { useMemo, useState } from "react";

import { t } from "../../../shared/i18n";
import { CapabilityGate, decideCapability } from "../capability/capability-gate";
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
  const attachmentsDecision = useMemo(
    () => decideCapability(capabilities, "attachments"),
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
    <section className="conversation-panel surface-card">
      <form className="composer-panel" onSubmit={handleSubmit}>
        <div className="composer-toolbar">
          <span className="badge">{t("conversation.headerCapability")}</span>
          <span className="badge">{capabilities?.provider ?? t("common.unknown")}</span>
          <span className="badge" data-tone={attachmentsDecision.allowed ? "success" : "error"}>
            {attachmentsDecision.allowed
              ? t("conversation.attachmentsLabel")
              : attachmentsDecision.reason ?? t("conversation.capabilityDenied")}
          </span>
        </div>

        <label className="field-group">
          <span className="status-text">
            {isSubmitting ? t("conversation.composerHintSending") : t("conversation.composerHintReady")}
          </span>
          <textarea
            value={content}
            placeholder={t("conversation.composerPlaceholder")}
            onChange={(event) => setContent(event.target.value)}
          />
        </label>

        {statusText ? (
          <p className="status-text" data-tone="error">
            {statusText}
          </p>
        ) : null}

        <div className="composer-footer">
          <span className="status-text">
            {sendDecision.allowed ? t("conversation.sentState") : sendDecision.reason}
          </span>
          <div className="composer-actions">
            <CapabilityGate
              capabilities={capabilities}
              action="attachments"
              fallback={
                <button className="secondary-button" type="button" disabled>
                  {t("conversation.unavailableAction")}
                </button>
              }
            >
              <button className="secondary-button" type="button" disabled>
                {t("conversation.attachmentsLabel")}
              </button>
            </CapabilityGate>
            <button
              className="primary-button"
              type="submit"
              disabled={isSubmitting || !sendDecision.allowed || !content.trim()}
            >
              {isSubmitting ? t("conversation.sendingState") : t("conversation.sendButton")}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
