import type { ReactNode } from "react";

import {
  DesktopModal,
  type DesktopModalLayoutPreset,
  type DesktopModalSizePreset
} from "../../../components/DesktopModal";

interface WorkbenchModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly hideHeader?: boolean;
  readonly size?: DesktopModalSizePreset;
  readonly layout?: DesktopModalLayoutPreset;
  readonly className?: string;
  readonly bodyClassName?: string;
  readonly headerActions?: ReactNode;
  readonly footer?: ReactNode;
  readonly showCloseButton?: boolean;
  readonly dismissible?: boolean;
  readonly closeOnBackdrop?: boolean;
  readonly closeOnEscape?: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function WorkbenchModal({
  open,
  title,
  description,
  hideHeader = false,
  size = "compact",
  layout = "form",
  className,
  bodyClassName,
  headerActions,
  footer,
  showCloseButton = true,
  dismissible = true,
  closeOnBackdrop = true,
  closeOnEscape = true,
  onClose,
  children
}: WorkbenchModalProps) {
  return (
    <DesktopModal
      open={open}
      title={title}
      description={description}
      hideHeader={hideHeader}
      size={size}
      layout={layout}
      dismissible={dismissible}
      closeOnBackdrop={closeOnBackdrop}
      closeOnEscape={closeOnEscape}
      className={className}
      bodyClassName={bodyClassName}
      headerActions={headerActions}
      footer={footer}
      showCloseButton={showCloseButton}
      onClose={onClose}
    >
      {children}
    </DesktopModal>
  );
}
