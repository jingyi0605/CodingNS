import type { ButtonHTMLAttributes } from "react";

import { t } from "../shared/i18n";

type ModalCloseButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type">;

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ModalCloseButton({
  className,
  "aria-label": ariaLabel,
  ...props
}: ModalCloseButtonProps) {
  return (
    <button
      type="button"
      className={className ? `workbench-modal-close ${className}` : "workbench-modal-close"}
      aria-label={ariaLabel ?? t("common.close")}
      {...props}
    >
      <CloseIcon />
    </button>
  );
}
