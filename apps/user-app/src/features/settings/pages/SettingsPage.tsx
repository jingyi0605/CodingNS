import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { clientConfigStore, useClientConfigSelector } from "../../../config/client-config-store";
import type { ClientPermissionMode } from "../../../config/client-config-types";
import { normalizeServerBaseUrl } from "../../../config/server-config";
import { usePlatform } from "../../../platform/platform-provider";
import { LanguageSwitcher, t } from "../../../shared/i18n";
import { THEMES, getThemeLabel, useTheme, type ThemeId } from "../../../shared/theme";
import { ReleasePanel } from "../../../settings/ReleasePanel";
import { authStore } from "../../auth/store/auth-store";

export function SettingsPage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const runtimeConfig = useClientConfigSelector((state) => state);
  const platform = usePlatform();
  const [hostBaseUrlDraft, setHostBaseUrlDraft] = useState(runtimeConfig.hostBaseUrl);

  useEffect(() => {
    setHostBaseUrlDraft(runtimeConfig.hostBaseUrl);
  }, [runtimeConfig.hostBaseUrl]);

  function handleLogout(): void {
    authStore.clear();
    navigate("/login", { replace: true });
  }

  function getNormalizedHostBaseUrl(value: string): string | null {
    try {
      return normalizeServerBaseUrl(value);
    } catch {
      return null;
    }
  }

  const normalizedHostBaseUrlDraft = getNormalizedHostBaseUrl(hostBaseUrlDraft);
  const canSaveHostBaseUrl =
    normalizedHostBaseUrlDraft !== null && normalizedHostBaseUrlDraft !== runtimeConfig.hostBaseUrl;

  function handleHostBaseUrlSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!normalizedHostBaseUrlDraft) {
      return;
    }

    void clientConfigStore.update({
      hostBaseUrl: normalizedHostBaseUrlDraft
    });
  }

  const permissionModeOptions: Array<{
    value: ClientPermissionMode;
    label: string;
  }> = [
    {
      value: "default",
      label: t("settings.permissionModeDefault")
    },
    {
      value: "acceptEdits",
      label: t("settings.permissionModeAcceptEdits")
    },
    {
      value: "bypassPermissions",
      label: t("settings.permissionModeBypassPermissions")
    }
  ];

  return (
    <div className="settings-page">
      <div className="settings-container">
        <h1 className="settings-title">{t("settings.title")}</h1>

        <section className="settings-section">
          <h2 className="settings-section-title">{t("settings.appearance")}</h2>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.language")}</span>
                <span className="settings-row-description">{t("settings.languageDescription")}</span>
              </div>
              <div className="settings-row-control">
                <LanguageSwitcher />
              </div>
            </div>

            <div className="settings-row settings-row-theme">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.theme")}</span>
              </div>
              <div className="settings-row-control settings-row-control-stretch">
                <div className="theme-selector">
                  {THEMES.map((themeOption) => (
                    <button
                      key={themeOption.id}
                      type="button"
                      className={`theme-card ${theme === themeOption.id ? "active" : ""}`}
                      aria-pressed={theme === themeOption.id}
                      onClick={() => setTheme(themeOption.id as ThemeId)}
                    >
                      <span className="theme-preview" style={{ background: themeOption.color }} />
                      <span className="theme-label">{getThemeLabel(themeOption)}</span>
                      {theme === themeOption.id ? <span className="theme-check">✓</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">{t("settings.connection")}</h2>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.serverAddress")}</span>
                <span className="settings-row-description">{t("settings.serverDescription")}</span>
              </div>
              <div className="settings-row-control settings-row-control-stretch">
                <form className="settings-inline-form" onSubmit={handleHostBaseUrlSubmit}>
                  <input
                    aria-label={t("settings.serverAddress")}
                    className="settings-text-input"
                    value={hostBaseUrlDraft}
                    onChange={(event) => setHostBaseUrlDraft(event.target.value)}
                  />
                  <button className="settings-button" disabled={!canSaveHostBaseUrl} type="submit">
                    {t("common.save")}
                  </button>
                </form>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.releaseChannel")}</span>
                <span className="settings-row-description">
                  {t("settings.releaseChannelDescription")}
                </span>
              </div>
              <div className="settings-row-control">
                <select
                  aria-label={t("settings.releaseChannel")}
                  className="settings-select"
                  value={runtimeConfig.releaseChannel}
                  onChange={(event) => {
                    void clientConfigStore.update({
                      releaseChannel: event.target.value === "beta" ? "beta" : "stable"
                    });
                  }}
                >
                  <option value="stable">{t("settings.releaseStable")}</option>
                  <option value="beta">{t("settings.releaseBeta")}</option>
                </select>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.autoReconnect")}</span>
                <span className="settings-row-description">
                  {t("settings.autoReconnectDescription")}
                </span>
              </div>
              <div className="settings-row-control">
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={runtimeConfig.autoReconnect}
                    onChange={(event) => {
                      void clientConfigStore.update({
                        autoReconnect: event.target.checked
                      });
                    }}
                  />
                  <span>{runtimeConfig.autoReconnect ? t("settings.enabled") : t("settings.disabled")}</span>
                </label>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.autoCheckUpdate")}</span>
                <span className="settings-row-description">
                  {t("settings.autoCheckUpdateDescription")}
                </span>
              </div>
              <div className="settings-row-control">
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={runtimeConfig.autoCheckUpdate}
                    onChange={(event) => {
                      void clientConfigStore.update({
                        autoCheckUpdate: event.target.checked
                      });
                    }}
                  />
                  <span>{runtimeConfig.autoCheckUpdate ? t("settings.enabled") : t("settings.disabled")}</span>
                </label>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.defaultPermissionMode")}</span>
                <span className="settings-row-description">
                  {t("settings.defaultPermissionModeDescription")}
                </span>
              </div>
              <div className="settings-row-control">
                <select
                  aria-label={t("settings.defaultPermissionMode")}
                  className="settings-select"
                  value={runtimeConfig.defaultPermissionMode}
                  onChange={(event) => {
                    const value = event.target.value;
                    void clientConfigStore.update({
                      defaultPermissionMode:
                        value === "acceptEdits" || value === "bypassPermissions"
                          ? value
                          : "default"
                    });
                  }}
                >
                  {permissionModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">{t("settings.desktopRelease")}</h2>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.runtimePlatform")}</span>
                <span className="settings-row-description">
                  {t("settings.runtimePlatformDescription")}
                </span>
              </div>
              <div className="settings-row-control">
                <span className="settings-runtime-badge">
                  {platform.isDesktop ? t("settings.platformDesktop") : t("settings.platformWeb")}
                </span>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.desktopRelease")}</span>
                <span className="settings-row-description">
                  {t("settings.desktopReleaseDescription")}
                </span>
              </div>
              <div className="settings-row-control settings-row-control-stretch">
                <ReleasePanel enabled={platform.isDesktop} />
              </div>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">{t("settings.account")}</h2>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.logout")}</span>
                <span className="settings-row-description">{t("settings.logoutDescription")}</span>
              </div>
              <div className="settings-row-control">
                <button className="settings-button settings-button-danger" onClick={handleLogout} type="button">
                  {t("common.logout")}
                </button>
              </div>
            </div>
          </div>
        </section>

        <div className="settings-footer">
          <span className="settings-version">CodingNS v1.0.0</span>
        </div>
      </div>
    </div>
  );
}
