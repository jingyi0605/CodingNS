import { useEffect, useState } from "react";

import { DesktopModal } from "../components/DesktopModal";
import {
  ModalActions,
  ModalField,
  ModalSection,
} from "../components/ModalAtoms";
import { MobileSheet } from "../components/MobileSheet";
import { useAuthSelector } from "../features/auth/store/auth-store";
import type {
  OnlyOfficeSettingsDto,
  OnlyOfficeStatusDto
} from "../features/settings/api/office-capability-api";
import {
  fetchOnlyOfficeSettings,
  fetchOnlyOfficeStatus,
  updateOnlyOfficeSettings
} from "../features/settings/api/office-capability-api";
import { t } from "../shared/i18n";
import { ApiError } from "../shared/network/api-error";
import { SettingsSwitch } from "./SettingsSwitch";

interface OnlyOfficeSettingsButtonProps {
  readonly triggerClassName?: string;
  readonly triggerLabel?: string;
  readonly mobile?: boolean;
}

interface OnlyOfficeDraft {
  readonly enabled: boolean;
  readonly serverUrl: string;
  readonly publicBaseUrl: string;
  readonly callbackBaseUrl: string;
  readonly userDisplayName: string;
  readonly userAvatarUrl: string;
  readonly jwtSecret: string;
  readonly clearJwtSecret: boolean;
}

interface OnlyOfficeStatusCard {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly tone: "default" | "success" | "warning" | "danger";
}

export function OnlyOfficeSettingsButton({
  triggerClassName = "settings-button",
  triggerLabel,
  mobile = false
}: OnlyOfficeSettingsButtonProps) {
  const accessToken = useAuthSelector((state) => state.session?.accessToken ?? null);
  const currentUser = useAuthSelector((state) => state.session?.user ?? null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<"check" | "save" | null>(null);
  const [settings, setSettings] = useState<OnlyOfficeSettingsDto | null>(null);
  const [status, setStatus] = useState<OnlyOfficeStatusDto | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [draft, setDraft] = useState<OnlyOfficeDraft>(createOnlyOfficeDraft(null));

  useEffect(() => {
    if (!settings) {
      return;
    }

    setDraft(createOnlyOfficeDraft(settings));
  }, [settings]);

  useEffect(() => {
    let active = true;

    if (!open) {
      return;
    }

    if (!accessToken) {
      setSettings(null);
      setStatus(null);
      setPanelError(null);
      setStatusText(null);
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      setPanelError(null);

      try {
        const [nextSettings, nextStatus] = await Promise.all([
          fetchOnlyOfficeSettings(),
          fetchOnlyOfficeStatus()
        ]);

        if (!active) {
          return;
        }

        setSettings(nextSettings);
        setStatus(nextStatus);
      } catch (error) {
        if (!active) {
          return;
        }

        setPanelError(resolveOnlyOfficeError(error));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [accessToken, open]);

  function handleClose(): void {
    setOpen(false);
    setStatusText(null);
    setPanelError(null);
    setDraft(createOnlyOfficeDraft(settings));
  }

  async function handleCheck(): Promise<void> {
    if (!accessToken) {
      return;
    }

    setPendingAction("check");
    setPanelError(null);
    setStatusText(null);

    try {
      const nextStatus = await fetchOnlyOfficeStatus();
      setStatus(nextStatus);
      setStatusText(t("settings.skillOnlyOfficeCheckSuccess"));
    } catch (error) {
      setPanelError(resolveOnlyOfficeError(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleSave(): Promise<void> {
    if (!accessToken) {
      return;
    }

    setPendingAction("save");
    setPanelError(null);
    setStatusText(null);

    try {
      const nextSettings = await updateOnlyOfficeSettings({
        enabled: draft.enabled,
        serverUrl: draft.serverUrl,
        publicBaseUrl: draft.publicBaseUrl,
        callbackBaseUrl: draft.callbackBaseUrl,
        userDisplayName: draft.userDisplayName,
        userAvatarUrl: draft.userAvatarUrl,
        jwtSecret: draft.jwtSecret,
        clearJwtSecret: draft.clearJwtSecret
      });
      const nextStatus = await fetchOnlyOfficeStatus();
      setSettings(nextSettings);
      setStatus(nextStatus);
      setDraft(createOnlyOfficeDraft(nextSettings));
      setStatusText(t("settings.skillOnlyOfficeSaveSuccess"));
    } catch (error) {
      setPanelError(resolveOnlyOfficeError(error));
    } finally {
      setPendingAction(null);
    }
  }

  const body = (
    <div className="settings-onlyoffice-modal-layout">
      <ModalSection heading={t("settings.skillOnlyOfficeStatusLabel")}>
        <div className="settings-onlyoffice-metrics" role="list" aria-label={t("settings.skillOnlyOfficeStatusLabel")}>
          {buildOnlyOfficeStatusCards(status).map((card) => (
            <div
              key={card.key}
              className="settings-onlyoffice-metric-card"
              data-tone={card.tone}
              role="listitem"
              tabIndex={0}
            >
              <span className="settings-onlyoffice-metric-label">{card.label}</span>
              <strong className="settings-onlyoffice-metric-value">{card.value}</strong>
              <div className="settings-onlyoffice-metric-tooltip" role="note">
                {card.detail}
              </div>
            </div>
          ))}
        </div>
      </ModalSection>

      <ModalSection heading={t("settings.skillOnlyOfficeSectionTitle")}>
        <ModalField label={t("settings.skillOnlyOfficeEnabledLabel")}>
          <div className="settings-onlyoffice-switch-field">
            <SettingsSwitch
              checked={draft.enabled}
              label={t("settings.skillOnlyOfficeEnabledLabel")}
              semanticRole="switch"
              onChange={(checked) => {
                setDraft((current) => ({
                  ...current,
                  enabled: checked
                }));
              }}
            />
            <span className="settings-onlyoffice-switch-caption">
              {draft.enabled ? t("common.enabled") : t("settings.skillOnlyOfficeStatusDisabled")}
            </span>
          </div>
        </ModalField>

        <ModalField label={t("settings.skillOnlyOfficeServerUrlLabel")} htmlFor="onlyoffice-server-url">
          <input
            id="onlyoffice-server-url"
            className="settings-text-input"
            value={draft.serverUrl}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                serverUrl: event.target.value
              }));
            }}
            placeholder={t("settings.skillOnlyOfficeServerUrlPlaceholder")}
          />
        </ModalField>

        <ModalField label={t("settings.skillOnlyOfficePublicBaseUrlLabel")} htmlFor="onlyoffice-public-base-url">
          <input
            id="onlyoffice-public-base-url"
            className="settings-text-input"
            value={draft.publicBaseUrl}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                publicBaseUrl: event.target.value
              }));
            }}
            placeholder={t("settings.skillOnlyOfficePublicBaseUrlPlaceholder")}
          />
        </ModalField>

        <ModalField label={t("settings.skillOnlyOfficeCallbackBaseUrlLabel")} htmlFor="onlyoffice-callback-base-url">
          <input
            id="onlyoffice-callback-base-url"
            className="settings-text-input"
            value={draft.callbackBaseUrl}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                callbackBaseUrl: event.target.value
              }));
            }}
            placeholder={t("settings.skillOnlyOfficeCallbackBaseUrlPlaceholder")}
          />
        </ModalField>

        <ModalField
          label={t("settings.skillOnlyOfficeUserDisplayNameLabel")}
          description={t("settings.skillOnlyOfficeUserDisplayNameDescription", {
            username: currentUser?.username ?? "-"
          })}
          htmlFor="onlyoffice-user-display-name"
        >
          <input
            id="onlyoffice-user-display-name"
            className="settings-text-input"
            value={draft.userDisplayName}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                userDisplayName: event.target.value
              }));
            }}
            placeholder={t("settings.skillOnlyOfficeUserDisplayNamePlaceholder")}
          />
        </ModalField>

        <ModalField
          label={t("settings.skillOnlyOfficeUserAvatarUrlLabel")}
          description={t("settings.skillOnlyOfficeUserAvatarUrlDescription")}
          htmlFor="onlyoffice-user-avatar-url"
        >
          <input
            id="onlyoffice-user-avatar-url"
            className="settings-text-input"
            value={draft.userAvatarUrl}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                userAvatarUrl: event.target.value
              }));
            }}
            placeholder={t("settings.skillOnlyOfficeUserAvatarUrlPlaceholder")}
          />
        </ModalField>

        <ModalField label={t("settings.skillOnlyOfficeJwtSecretLabel")} htmlFor="onlyoffice-jwt-secret">
          <input
            id="onlyoffice-jwt-secret"
            className="settings-text-input"
            value={draft.jwtSecret}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                jwtSecret: event.target.value,
                clearJwtSecret: false
              }));
            }}
            placeholder={settings?.jwtSecretConfigured
              ? t("settings.skillOnlyOfficeJwtSecretKeepPlaceholder")
              : t("settings.skillOnlyOfficeJwtSecretPlaceholder")}
          />
        </ModalField>

        {settings?.jwtSecretConfigured ? (
          <ModalField label={t("settings.skillOnlyOfficeClearJwtSecretLabel")}>
            <div className="settings-onlyoffice-switch-field">
              <SettingsSwitch
                checked={draft.clearJwtSecret}
                label={t("settings.skillOnlyOfficeClearJwtSecretLabel")}
                semanticRole="switch"
                onChange={(checked) => {
                  setDraft((current) => ({
                    ...current,
                    clearJwtSecret: checked
                  }));
                }}
              />
              <span className="settings-onlyoffice-switch-caption">
                {draft.clearJwtSecret ? t("common.enabled") : t("common.disabled")}
              </span>
            </div>
          </ModalField>
        ) : null}
      </ModalSection>

      {statusText ? <p className="settings-release-status">{statusText}</p> : null}
      {panelError ? <p className="settings-release-status">{panelError}</p> : null}

      <ModalActions className="settings-onlyoffice-modal-actions">
        <button className="secondary-button" type="button" onClick={handleClose}>
          {t("common.cancel")}
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={loading || pendingAction !== null}
          onClick={() => {
            void handleCheck();
          }}
        >
          {pendingAction === "check" ? t("settings.opencliLoading") : t("settings.skillOnlyOfficeCheckAction")}
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={loading || pendingAction !== null}
          onClick={() => {
            void handleSave();
          }}
        >
          {pendingAction === "save" ? t("butlerSettingsSaving") : t("settings.skillOnlyOfficeSaveAction")}
        </button>
      </ModalActions>
    </div>
  );

  return (
    <>
      <button
        className={triggerClassName}
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        {triggerLabel ?? t("settings.skillOnlyOfficeOpenSettingsAction")}
      </button>

      {mobile ? (
        <MobileSheet
          open={open}
          title={t("settings.skillOnlyOfficeModalTitle")}
          description={t("settings.skillOnlyOfficeModalDescription")}
          height="full"
          kind="form"
          showHandle
          onClose={handleClose}
        >
          {body}
        </MobileSheet>
      ) : (
        <DesktopModal
          open={open}
          title={t("settings.skillOnlyOfficeModalTitle")}
          description={t("settings.skillOnlyOfficeModalDescription")}
          size="regular"
          layout="form"
          className="settings-onlyoffice-modal"
          bodyClassName="settings-onlyoffice-modal-body"
          onClose={handleClose}
        >
          {body}
        </DesktopModal>
      )}
    </>
  );
}

function createOnlyOfficeDraft(settings: OnlyOfficeSettingsDto | null): OnlyOfficeDraft {
  return {
    enabled: settings?.enabled ?? false,
    serverUrl: settings?.serverUrl ?? "",
    publicBaseUrl: settings?.publicBaseUrl ?? "",
    callbackBaseUrl: settings?.callbackBaseUrl ?? "",
    userDisplayName: settings?.userDisplayName ?? "",
    userAvatarUrl: settings?.userAvatarUrl ?? "",
    jwtSecret: "",
    clearJwtSecret: false
  };
}

function resolveOnlyOfficeStatusLabel(status: OnlyOfficeStatusDto | null): string {
  switch (status?.state) {
    case "ready":
      return t("settings.skillOnlyOfficeStatusReady");
    case "warning":
      return t("settings.skillOnlyOfficeStatusWarning");
    case "error":
      return t("settings.skillOnlyOfficeStatusError");
    case "misconfigured":
      return t("settings.skillOnlyOfficeStatusMisconfigured");
    case "disabled":
      return t("settings.skillOnlyOfficeStatusDisabled");
    default:
      return t("settings.skillOnlyOfficeStatusUnknown");
  }
}

function resolveOnlyOfficeStatusTone(
  status: OnlyOfficeStatusDto["state"] | undefined
): "default" | "success" | "warning" | "danger" {
  switch (status) {
    case "ready":
      return "success";
    case "warning":
    case "misconfigured":
      return "warning";
    case "error":
      return "danger";
    case "disabled":
    default:
      return "default";
  }
}

function resolveOnlyOfficeCheckStatusLabel(status: "pass" | "warn" | "fail" | "skip"): string {
  switch (status) {
    case "pass":
      return t("settings.skillOnlyOfficeCheckPass");
    case "warn":
      return t("settings.skillOnlyOfficeCheckWarn");
    case "fail":
      return t("settings.skillOnlyOfficeCheckFail");
    case "skip":
    default:
      return t("settings.skillOnlyOfficeCheckSkip");
  }
}

function resolveOnlyOfficeCheckTone(
  status: "pass" | "warn" | "fail" | "skip"
): "default" | "success" | "warning" | "danger" {
  switch (status) {
    case "pass":
      return "success";
    case "warn":
      return "warning";
    case "fail":
      return "danger";
    case "skip":
    default:
      return "default";
  }
}

function buildOnlyOfficeStatusCards(status: OnlyOfficeStatusDto | null): OnlyOfficeStatusCard[] {
  const cards: OnlyOfficeStatusCard[] = [
    {
      key: "summary",
      label: t("settings.skillOnlyOfficeStatusLabel"),
      value: resolveOnlyOfficeStatusLabel(status),
      detail: status?.summary ?? t("settings.skillOnlyOfficeStatusUnknown"),
      tone: resolveOnlyOfficeStatusTone(status?.state)
    }
  ];

  for (const check of status?.checks ?? []) {
    cards.push({
      key: check.key,
      label: check.label,
      value: resolveOnlyOfficeCheckStatusLabel(check.status),
      detail: check.detail,
      tone: resolveOnlyOfficeCheckTone(check.status)
    });
  }

  return cards;
}

function resolveOnlyOfficeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return t("settings.skillLoadError");
}
