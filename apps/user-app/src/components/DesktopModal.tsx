import { createPortal } from "react-dom";
import { useEffect, useId, type ReactNode } from "react";

import { ModalCloseButton } from "./ModalCloseButton";
import { t } from "../shared/i18n";

export type DesktopModalSizePreset = "narrow" | "compact" | "regular" | "wide" | "xwide" | "full";
export type DesktopModalLayoutPreset = "confirm" | "form" | "list" | "viewer";

interface DesktopModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly size?: DesktopModalSizePreset;
  readonly layout?: DesktopModalLayoutPreset;
  readonly dismissible?: boolean;
  readonly closeOnBackdrop?: boolean;
  readonly closeOnEscape?: boolean;
  readonly className?: string;
  readonly bodyClassName?: string;
  readonly headerActions?: ReactNode;
  readonly footer?: ReactNode;
  readonly showCloseButton?: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function DesktopModal({
  open,
  title,
  description,
  size = "compact",
  layout = "form",
  dismissible = true,
  closeOnBackdrop = true,
  closeOnEscape = true,
  className,
  bodyClassName,
  headerActions,
  footer,
  showCloseButton = true,
  onClose,
  children
}: DesktopModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const canCloseOnBackdrop = dismissible && closeOnBackdrop;
  const canCloseOnEscape = dismissible && closeOnEscape;
  const closeButtonDisabled = !dismissible;

  useEffect(() => {
    if (!open || !canCloseOnEscape) {
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
  }, [canCloseOnEscape, onClose, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="workbench-modal-layer desktop-modal-layer"
      data-fullscreen={size === "full" ? "true" : undefined}
      data-layout={layout}
    >
      <button
        type="button"
        className="workbench-modal-backdrop"
        aria-label={t("common.close")}
        disabled={!canCloseOnBackdrop}
        onClick={() => {
          if (canCloseOnBackdrop) {
            onClose();
          }
        }}
      />
      <section
        className={`workbench-modal-card surface-card desktop-modal-card${className ? ` ${className}` : ""}`}
        data-size={size}
        data-layout={layout}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <div className="workbench-modal-header">
          <div className="workbench-modal-title-wrap">
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          {headerActions || showCloseButton ? (
            <div className="workbench-modal-header-actions">
              {headerActions}
              {showCloseButton ? (
                <ModalCloseButton
                  disabled={closeButtonDisabled}
                  onClick={() => {
                    if (dismissible) {
                      onClose();
                    }
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </div>
        <div className={bodyClassName ? `workbench-modal-body ${bodyClassName}` : "workbench-modal-body"}>{children}</div>
        {footer ? <div className="workbench-modal-footer">{footer}</div> : null}
      </section>
    </div>,
    document.body
  );
}
