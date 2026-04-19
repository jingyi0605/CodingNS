import { createPortal } from "react-dom";
import { useId, type ReactNode } from "react";

import { t } from "../shared/i18n";

export type MobileSheetHeightPreset = "auto" | "half" | "three-quarter" | "full";
export type MobileSheetKind = "action" | "form" | "picker";

interface MobileSheetProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly height?: MobileSheetHeightPreset;
  readonly kind?: MobileSheetKind;
  readonly dismissible?: boolean;
  readonly closeOnBackdrop?: boolean;
  readonly showHandle?: boolean;
  readonly showCancelButton?: boolean;
  readonly cancelLabel?: string;
  readonly className?: string;
  readonly cardClassName?: string;
  readonly bodyClassName?: string;
  readonly footer?: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function MobileSheet({
  open,
  title,
  description,
  height = "auto",
  kind = "form",
  dismissible = true,
  closeOnBackdrop = true,
  showHandle = false,
  showCancelButton = true,
  cancelLabel,
  className,
  cardClassName,
  bodyClassName,
  footer,
  onClose,
  children
}: MobileSheetProps) {
  const titleId = useId();
  const descriptionId = useId();
  const canCloseOnBackdrop = dismissible && closeOnBackdrop;

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="ios-action-sheet-overlay mobile-sheet-overlay"
      role="presentation"
      onClick={() => {
        if (canCloseOnBackdrop) {
          onClose();
        }
      }}
    >
      <div
        className={`mobile-workspace-home-sheet mobile-sheet${className ? ` ${className}` : ""}`}
        data-height={height}
        data-kind={kind}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className={`mobile-workspace-home-sheet-card mobile-sheet-card${cardClassName ? ` ${cardClassName}` : ""}`}
        >
          {showHandle ? <div className="mobile-sheet-handle" aria-hidden="true" /> : null}
          <div className="mobile-workspace-home-sheet-header mobile-sheet-header">
            <div className="mobile-sheet-title-wrap">
              <strong id={titleId}>{title}</strong>
              {description ? <p id={descriptionId}>{description}</p> : null}
            </div>
          </div>
          <div className={bodyClassName ? `mobile-sheet-body ${bodyClassName}` : "mobile-sheet-body"}>{children}</div>
          {footer ? <div className="mobile-sheet-footer">{footer}</div> : null}
        </div>
        {showCancelButton ? (
          <button
            type="button"
            className="ios-action-sheet-cancel mobile-sheet-cancel"
            disabled={!dismissible}
            onClick={() => {
              if (dismissible) {
                onClose();
              }
            }}
          >
            {cancelLabel ?? t("common.cancel")}
          </button>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
