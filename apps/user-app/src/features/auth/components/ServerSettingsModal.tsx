import { useEffect, useMemo, useState } from "react";
import {
  getCustomServerOptionValue,
  getServerSelectValue,
  normalizeServerBaseUrl,
  serverConfigStore,
  useServerConfigSelector
} from "../../../config/server-config";
import { t } from "../../../shared/i18n";

interface ServerSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: (baseUrl: string) => void;
  theme?: "light" | "dark";
}

export function ServerSettingsModal({ isOpen, onClose, onSave, theme = "dark" }: ServerSettingsModalProps) {
  const persistedServerBaseUrl = useServerConfigSelector((state) => state.baseUrl);
  const serverOptions = useServerConfigSelector((state) => state.options);
  const customServerOptionValue = getCustomServerOptionValue();

  const [serverBaseUrlInput, setServerBaseUrlInput] = useState(persistedServerBaseUrl);
  const [statusText, setStatusText] = useState<string | null>(null);

  const normalizedServerBaseUrl = useMemo(() => {
    try {
      return normalizeServerBaseUrl(serverBaseUrlInput);
    } catch {
      return null;
    }
  }, [serverBaseUrlInput]);

  const selectedServerOption = getServerSelectValue(
    normalizedServerBaseUrl ?? serverBaseUrlInput,
    serverOptions
  );
  const presetSelectId = "server-settings-preset";
  const addressInputId = "server-settings-address";

  // Reset input when modal opens
  useEffect(() => {
    if (isOpen) {
      setServerBaseUrlInput(persistedServerBaseUrl);
      setStatusText(null);
    }
  }, [isOpen, persistedServerBaseUrl]);

  if (!isOpen) return null;

  function handleSave(): void {
    if (!normalizedServerBaseUrl) {
      setStatusText(t("auth.serverInvalid"));
      return;
    }

    serverConfigStore.setBaseUrl(normalizedServerBaseUrl);
    onSave?.(normalizedServerBaseUrl);
    onClose();
  }

  function handleBackdropClick(e: React.MouseEvent): void {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function handleServerBlur(): void {
    if (!normalizedServerBaseUrl) {
      return;
    }
    setServerBaseUrlInput(normalizedServerBaseUrl);
  }

  return (
    <div
      className="server-settings-modal-backdrop"
      data-theme={theme}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="server-settings-title"
    >
      <div className="server-settings-modal">
        <div className="server-settings-modal-header">
          <div className="cyber-header-line" />
          <h2 id="server-settings-title" className="cyber-title">
            <span className="cyber-title-icon">◈</span>
            {t("auth.serverSettingsTitle")}
          </h2>
          <div className="cyber-header-line" />
          <button
            className="server-settings-close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>

        <div className="server-settings-modal-content">
          <label className="field-group cyber-field" htmlFor={presetSelectId}>
            <span className="cyber-label">{t("auth.serverPreset")}</span>
            <div className="cyber-select-wrapper">
              <select
                id={presetSelectId}
                aria-label={t("auth.serverPreset")}
                className="cyber-select"
                value={selectedServerOption}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (nextValue === customServerOptionValue) {
                    return;
                  }
                  setServerBaseUrlInput(nextValue);
                  setStatusText(null);
                }}
              >
                {serverOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                <option value={customServerOptionValue}>{t("auth.serverCustomOption")}</option>
              </select>
              <span className="cyber-select-arrow">▼</span>
            </div>
          </label>

          <label className="field-group cyber-field" htmlFor={addressInputId}>
            <span className="cyber-label">{t("auth.serverAddress")}</span>
            <div className="cyber-input-wrapper">
              <span className="cyber-input-prefix">://</span>
              <input
                id={addressInputId}
                aria-label={t("auth.serverAddress")}
                className="cyber-input"
                value={serverBaseUrlInput}
                placeholder={t("auth.serverPlaceholder")}
                onBlur={handleServerBlur}
                onChange={(event) => {
                  setServerBaseUrlInput(event.target.value);
                  setStatusText(null);
                }}
              />
              <div className="cyber-input-glow" />
            </div>
          </label>

          <p className="cyber-hint">
            <span className="cyber-hint-icon">ℹ</span>
            {t("auth.serverHint")}
          </p>

          {statusText ? (
            <p className="cyber-status" data-tone="error">
              <span className="cyber-status-icon">⚠</span>
              {statusText}
            </p>
          ) : null}
        </div>

        <div className="server-settings-modal-footer">
          <button className="cyber-button cyber-button-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="cyber-button cyber-button-primary" onClick={handleSave}>
            <span className="cyber-button-glow" />
            <span className="cyber-button-text">{t("auth.saveServerSettings")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
