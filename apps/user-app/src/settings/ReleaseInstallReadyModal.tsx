import { DesktopModal } from "../components/DesktopModal";
import { ModalActions, ModalSection } from "../components/ModalAtoms";
import { t } from "../shared/i18n";

interface ReleaseInstallReadyModalProps {
  readonly open: boolean;
  readonly version: string | null;
  readonly installing: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

export function ReleaseInstallReadyModal({
  open,
  version,
  installing,
  onClose,
  onConfirm
}: ReleaseInstallReadyModalProps) {
  return (
    <DesktopModal
      open={open}
      title={t("settings.releaseInstallReadyDialogTitle")}
      description={t("settings.releaseInstallReadyDialogDescription", {
        version: version ?? "-"
      })}
      size="compact"
      layout="confirm"
      dismissible={!installing}
      footer={
        <ModalActions>
          <button
            type="button"
            className="secondary-button"
            disabled={installing}
            onClick={onClose}
          >
            {t("settings.releaseRestartLater")}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={installing}
            onClick={onConfirm}
          >
            {installing ? t("common.loading") : t("settings.releaseInstallReadyConfirm")}
          </button>
        </ModalActions>
      }
      onClose={onClose}
    >
      <ModalSection className="settings-update-confirm-section">
        <p className="settings-update-confirm-warning">
          {t("settings.releaseInstallReadyWarning")}
        </p>
      </ModalSection>
    </DesktopModal>
  );
}
