import { useState } from "react";

import { DesktopModal } from "../components/DesktopModal";
import { MobileSheet } from "../components/MobileSheet";
import { ModalActions, ModalSection } from "../components/ModalAtoms";
import { t } from "../shared/i18n";

interface BetaChannelConsentModalProps {
  readonly open: boolean;
  readonly mobile: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

export function BetaChannelConsentModal({
  open,
  mobile,
  onClose,
  onConfirm
}: BetaChannelConsentModalProps) {
  const [agreed, setAgreed] = useState(false);

  function handleClose() {
    setAgreed(false);
    onClose();
  }

  function handleConfirm() {
    setAgreed(false);
    onConfirm();
  }

  const content = (
    <>
      <ModalSection tone="danger" className="settings-beta-warning-section">
        <p className="settings-beta-warning-description">
          {t("settings.betaChannelConsentDescription")}
        </p>
        <ul className="settings-beta-warning-risks">
          <li>{t("settings.betaChannelConsentRisk1")}</li>
          <li>{t("settings.betaChannelConsentRisk2")}</li>
        </ul>
      </ModalSection>
      <ModalSection tone="accent" className="settings-beta-consent-section">
        <label className="settings-beta-consent-checkbox-label">
          <input
            type="checkbox"
            className="settings-beta-consent-checkbox"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
          />
          <span>{t("settings.betaChannelConsentCheckbox")}</span>
        </label>
      </ModalSection>
      <ModalActions>
        <button type="button" className="secondary-button" onClick={handleClose}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="primary-button settings-beta-consent-confirm-button"
          disabled={!agreed}
          onClick={handleConfirm}
        >
          {t("settings.betaChannelConsentConfirm")}
        </button>
      </ModalActions>
    </>
  );

  if (mobile) {
    return (
      <MobileSheet
        open={open}
        title={t("settings.betaChannelConsentTitle")}
        kind="form"
        height="auto"
        onClose={handleClose}
      >
        {content}
      </MobileSheet>
    );
  }

  return (
    <DesktopModal
      open={open}
      title={t("settings.betaChannelConsentTitle")}
      size="compact"
      layout="confirm"
      onClose={handleClose}
    >
      {content}
    </DesktopModal>
  );
}
