import { createPortal } from "react-dom";
import { useEffect, type ReactNode } from "react";

import { t } from "../../../shared/i18n";

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 7L17 17M17 7L7 17"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

interface WorkbenchModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly className?: string;
  readonly headerActions?: ReactNode;
  readonly showCloseButton?: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function WorkbenchModal({
  open,
  title,
  description,
  className,
  headerActions,
  showCloseButton = true,
  onClose,
  children
}: WorkbenchModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="workbench-modal-layer">
      <button
        type="button"
        className="workbench-modal-backdrop"
        aria-label={t("common.close")}
        onClick={onClose}
      />
      <section
        className={`workbench-modal-card surface-card${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="workbench-modal-header">
          <div className="workbench-modal-title-wrap">
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          {headerActions || showCloseButton ? (
            <div className="workbench-modal-header-actions">
              {headerActions}
              {showCloseButton ? (
                <button
                  type="button"
                  className="workbench-modal-close"
                  aria-label={t("common.close")}
                  onClick={onClose}
                >
                  <CloseIcon />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="workbench-modal-body">{children}</div>
      </section>
    </div>,
    document.body
  );
}
