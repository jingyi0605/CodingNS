import { useEffect, useMemo, useState } from "react";
import { clientConfigStore } from "../../../config/client-config-store";
import {
  buildRelayEntryConfigPatch,
  resolveRelayEntryConfigInputFromBaseUrl
} from "../../../config/relay-entry";
import {
  getCustomServerOptionValue,
  getServerSelectValue,
  normalizeServerBaseUrl,
  serverConfigStore,
  useServerConfigSelector,
  type ServerPresetOption
} from "../../../config/server-config";
import { WorkbenchModal } from "../../conversation/components/WorkbenchModal";
import { t } from "../../../shared/i18n";

interface ServerSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: (baseUrl: string) => void;
  theme?: "light" | "dark";
}

export function ServerSettingsModal({ isOpen, onClose, onSave, theme = "dark" }: ServerSettingsModalProps) {
  void theme;
  const persistedServerBaseUrl = useServerConfigSelector((state) => state.baseUrl);
  const serverOptions = useServerConfigSelector((state) => state.options);
  const presetOptions = useServerConfigSelector((state) => state.presetOptions);
  const customServerOptionValue = getCustomServerOptionValue();

  const [serverBaseUrlInput, setServerBaseUrlInput] = useState(persistedServerBaseUrl);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
  const selectedPresetOption = presetOptions.find((option) => option.value === selectedServerOption) ?? null;
  const presetSelectId = "server-settings-preset";
  const addressInputId = "server-settings-address";

  // Reset input when modal opens
  useEffect(() => {
    if (isOpen) {
      setServerBaseUrlInput(persistedServerBaseUrl);
      setStatusText(null);
      setSaving(false);
    }
  }, [isOpen, persistedServerBaseUrl]);

  if (!isOpen) return null;

  async function handleSave(): Promise<void> {
    if (!normalizedServerBaseUrl) {
      setStatusText(t("auth.serverInvalid"));
      return;
    }

    setSaving(true);

    try {
      const relayEntryInput = await resolveRelayEntryConfigInputFromBaseUrl(normalizedServerBaseUrl);

      if (relayEntryInput) {
        await clientConfigStore.update(
          buildRelayEntryConfigPatch(clientConfigStore.getState(), relayEntryInput)
        );
      } else {
        serverConfigStore.setBaseUrl(normalizedServerBaseUrl);
      }

      onSave?.(normalizedServerBaseUrl);
      onClose();
    } catch (error) {
      setStatusText(error instanceof Error && error.message.trim()
        ? error.message
        : t("auth.serverInvalid"));
    } finally {
      setSaving(false);
    }
  }

  function handleServerBlur(): void {
    if (!normalizedServerBaseUrl) {
      return;
    }
    setServerBaseUrlInput(normalizedServerBaseUrl);
  }

  return (
    <WorkbenchModal
      open={isOpen}
      title={t("auth.serverSettingsTitle")}
      description={t("auth.serverHint")}
      className="server-settings-modal-card"
      onClose={onClose}
    >
      <form
        className="server-settings-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
      >
        <label className="workbench-modal-field" htmlFor={presetSelectId}>
          <span>{t("auth.serverPreset")}</span>
          <select
            id={presetSelectId}
            aria-label={t("auth.serverPreset")}
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
            {presetOptions.map((option) => (
              <option key={`${option.source}:${option.value}`} value={option.value}>
                {formatPresetOptionLabel(option)}
              </option>
            ))}
            <option value={customServerOptionValue}>{t("auth.serverCustomOption")}</option>
          </select>
        </label>

        {selectedPresetOption ? (
          <div className="server-settings-modal-tags" aria-live="polite">
            {selectedPresetOption.source === "discovered" ? (
              <span className="server-settings-modal-tag" data-tone="discovered">
                {t("auth.serverDiscoveredTag")}
              </span>
            ) : null}
          </div>
        ) : null}

        <label className="workbench-modal-field" htmlFor={addressInputId}>
          <span>{t("auth.serverAddress")}</span>
          <input
            id={addressInputId}
            aria-label={t("auth.serverAddress")}
            value={serverBaseUrlInput}
            placeholder={t("auth.serverPlaceholder")}
            disabled={saving}
            onBlur={handleServerBlur}
            onChange={(event) => {
              setServerBaseUrlInput(event.target.value);
              setStatusText(null);
            }}
          />
        </label>

        {statusText ? (
          <p className="server-settings-modal-status" data-tone="error">
            {statusText}
          </p>
        ) : (
          <p className="server-settings-modal-hint">{t("auth.serverHint")}</p>
        )}

        <div className="workbench-modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? t("common.loading") : t("auth.saveServerSettings")}
          </button>
        </div>
      </form>
    </WorkbenchModal>
  );
}

function formatPresetOptionLabel(option: ServerPresetOption): string {
  if (option.source === "discovered") {
    return `${option.value} · ${t("auth.serverDiscoveredTag")}`;
  }

  return option.value;
}
