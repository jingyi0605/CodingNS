import { useEffect } from "react";
import { createPortal } from "react-dom";

import { t } from "../../../shared/i18n";

interface TerminalRuntimeFallbackModalProps {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onConfirmFallback: () => void;
}

export function TerminalRuntimeFallbackModal({
  open,
  busy = false,
  onClose,
  onConfirmFallback
}: TerminalRuntimeFallbackModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [busy, onClose, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="workbench-modal-layer">
      <button
        type="button"
        className="workbench-modal-backdrop"
        aria-label={t("common.close")}
        onClick={() => {
          if (!busy) {
            onClose();
          }
        }}
      />
      <section
        className="workbench-modal-card surface-card terminal-runtime-fallback-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("terminal.runtimeMissingDialogTitle")}
      >
        <div className="workbench-modal-header">
          <div className="workbench-modal-title-wrap">
            <h2>{t("terminal.runtimeMissingDialogTitle")}</h2>
            <p>{t("terminal.runtimeMissingDialogDescription")}</p>
          </div>
          <button
            type="button"
            className="workbench-modal-close"
            aria-label={t("common.close")}
            onClick={() => {
              if (!busy) {
                onClose();
              }
            }}
          >
            x
          </button>
        </div>

        <div className="workbench-modal-body terminal-runtime-fallback-body">
          <section className="terminal-runtime-fallback-section">
            <span className="badge" data-tone="error">
              tmux
            </span>
            <p className="status-text">{t("terminal.runtimeMissingInstallDescription")}</p>
            <ul className="terminal-runtime-fallback-list">
              <li>{t("terminal.runtimeMissingInstallMacArm")}</li>
              <li>{t("terminal.runtimeMissingInstallMacIntel")}</li>
              <li>{t("terminal.runtimeMissingInstallDebian")}</li>
              <li>{t("terminal.runtimeMissingInstallFedora")}</li>
            </ul>
          </section>

          <section className="terminal-runtime-fallback-section">
            <span className="badge">embedded-pty</span>
            <p className="status-text">{t("terminal.runtimeMissingFallbackDescription")}</p>
          </section>

          <div className="workbench-modal-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={onClose}
            >
              {t("terminal.runtimeMissingKeepAction")}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={onConfirmFallback}
            >
              {busy
                ? t("terminal.runtimeMissingFallbackPending")
                : t("terminal.runtimeMissingFallbackAction")}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
