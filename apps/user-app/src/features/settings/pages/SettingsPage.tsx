import { useNavigate } from "react-router-dom";

import { clientConfigStore, useClientConfigSelector } from "../../../config/client-config-store";
import { normalizeServerBaseUrl } from "../../../config/server-config";
import { usePlatform } from "../../../platform/platform-provider";
import { t } from "../../../shared/i18n";
import { THEMES, useTheme, type ThemeId } from "../../../shared/theme";
import { authStore } from "../../auth/store/auth-store";
import { ReleasePanel } from "../../../settings/ReleasePanel";

export function SettingsPage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const runtimeConfig = useClientConfigSelector((state) => state);
  const platform = usePlatform();

  function handleLogout(): void {
    authStore.clear();
    navigate("/login", { replace: true });
  }

  function handleHostBaseUrlChange(value: string): void {
    try {
      void clientConfigStore.update({
        hostBaseUrl: normalizeServerBaseUrl(value)
      });
    } catch {
      // 输入过程中允许暂时非法，真正保存动作交给 blur。
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-container">
        <h1 className="settings-title">{t("settings.title")}</h1>

        {/* Appearance Section */}
        <section className="settings-section">
          <h2 className="settings-section-title">{t("settings.appearance")}</h2>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.theme")}</span>
                <span className="settings-row-description">
                  {t("settings.themeDescription")}
                </span>
              </div>
              <div className="settings-row-control">
                <div className="theme-selector">
                  {THEMES.map((tOption: { id: string; label: string; color: string }) => (
                    <button
                      key={tOption.id}
                      type="button"
                      className={`theme-card ${theme === tOption.id ? "active" : ""}`}
                      onClick={() => setTheme(tOption.id as ThemeId)}
                    >
                      <span
                        className="theme-preview"
                        style={{ background: tOption.color }}
                      />
                      <span className="theme-label">{tOption.label}</span>
                      {theme === tOption.id && (
                        <span className="theme-check">✓</span>
                      )}
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
                <input
                  className="settings-text-input"
                  defaultValue={runtimeConfig.hostBaseUrl}
                  onBlur={(event) => handleHostBaseUrlChange(event.target.value)}
                />
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.releaseChannel")}</span>
                <span className="settings-row-description">{t("settings.releaseChannelDescription")}</span>
              </div>
              <div className="settings-row-control">
                <select
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
                <span className="settings-row-description">{t("settings.autoReconnectDescription")}</span>
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
                <span className="settings-row-description">{t("settings.autoCheckUpdateDescription")}</span>
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
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">{t("settings.desktopRelease")}</h2>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.runtimePlatform")}</span>
                <span className="settings-row-description">{t("settings.runtimePlatformDescription")}</span>
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
                <span className="settings-row-description">{t("settings.desktopReleaseDescription")}</span>
              </div>
              <div className="settings-row-control settings-row-control-stretch">
                <ReleasePanel enabled={platform.isDesktop} />
              </div>
            </div>
          </div>
        </section>

        {/* Account Section */}
        <section className="settings-section">
          <h2 className="settings-section-title">{t("settings.account")}</h2>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.logout")}</span>
                <span className="settings-row-description">
                  {t("settings.logoutDescription")}
                </span>
              </div>
              <div className="settings-row-control">
                <button
                  className="settings-button settings-button-danger"
                  onClick={handleLogout}
                  type="button"
                >
                  {t("common.logout")}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Version Info */}
        <div className="settings-footer">
          <span className="settings-version">CodingNS v1.0.0</span>
        </div>
      </div>
    </div>
  );
}
