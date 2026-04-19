import { DesktopModal } from "../../../components/DesktopModal";
import {
  ModalActions,
  ModalList,
  ModalListItem,
  ModalSection,
  ModalTag
} from "../../../components/ModalAtoms";
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
  return (
    <DesktopModal
      open={open}
      title={t("terminal.runtimeMissingDialogTitle")}
      description={t("terminal.runtimeMissingDialogDescription")}
      size="compact"
      layout="confirm"
      className="terminal-runtime-fallback-modal"
      bodyClassName="terminal-runtime-fallback-body"
      dismissible={!busy}
      footer={(
        <ModalActions>
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
        </ModalActions>
      )}
      onClose={onClose}
    >
      <ModalSection
        className="terminal-runtime-fallback-section"
        tone="danger"
        actions={<ModalTag tone="danger">tmux</ModalTag>}
      >
        <p className="status-text">{t("terminal.runtimeMissingInstallDescription")}</p>
        <ModalList className="terminal-runtime-fallback-list">
          <ModalListItem label={t("terminal.runtimeMissingInstallMacArm")} />
          <ModalListItem label={t("terminal.runtimeMissingInstallMacIntel")} />
          <ModalListItem label={t("terminal.runtimeMissingInstallDebian")} />
          <ModalListItem label={t("terminal.runtimeMissingInstallFedora")} />
        </ModalList>
      </ModalSection>

      <ModalSection
        className="terminal-runtime-fallback-section"
        actions={<ModalTag>embedded-pty</ModalTag>}
      >
        <p className="status-text">{t("terminal.runtimeMissingFallbackDescription")}</p>
      </ModalSection>
    </DesktopModal>
  );
}
