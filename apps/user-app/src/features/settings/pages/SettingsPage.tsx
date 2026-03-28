import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { clientConfigStore, useClientConfigSelector } from "../../../config/client-config-store";
import { canConfigureHostBaseUrl } from "../../../config/client-config-service";
import type {
  AppLanguage,
  ClientRuntimeConfig,
  ClientPermissionMode,
  ReleaseChannel
} from "../../../config/client-config-types";
import { normalizeServerBaseUrl } from "../../../config/server-config";
import { usePlatform } from "../../../platform/platform-provider";
import { LanguageSwitcher, t } from "../../../shared/i18n";
import { THEMES, getThemeLabel, useTheme, type ThemeId } from "../../../shared/theme";
import { ReleasePanel } from "../../../settings/ReleasePanel";
import { ServiceUpdatePanel } from "../../../settings/ServiceUpdatePanel";
import { authStore } from "../../auth/store/auth-store";
import { MobilePageHeader } from "../../mobile-shell/components/MobilePageHeader";

type SettingsSectionId =
  | "appearance"
  | "server-connection"
  | "security-privacy"
  | "software-update";

interface SettingsPageModel {
  readonly platform: ReturnType<typeof usePlatform>;
  readonly theme: ThemeId;
  readonly setTheme: (id: ThemeId) => void;
  readonly runtimeConfig: ClientRuntimeConfig;
  readonly showServerSettings: boolean;
  readonly canConfigureServerAddress: boolean;
  readonly hostBaseUrlDraft: string;
  readonly setHostBaseUrlDraft: (value: string) => void;
  readonly canSaveHostBaseUrl: boolean;
  readonly permissionModeOptions: Array<{
    value: ClientPermissionMode;
    label: string;
  }>;
  readonly handleHostBaseUrlSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly handleLogout: () => void;
  readonly updateReleaseChannel: (value: string) => void;
  readonly updateAutoReconnect: (enabled: boolean) => void;
  readonly updateAutoCheckUpdate: (enabled: boolean) => void;
  readonly updateDefaultPermissionMode: (value: string) => void;
}

interface SettingsSectionMeta {
  readonly id: SettingsSectionId;
  readonly title: string;
  readonly description: string;
  readonly value?: string;
  readonly icon: ReactNode;
}

function isSettingsSectionId(value: string | undefined): value is SettingsSectionId {
  return (
    value === "appearance" ||
    value === "server-connection" ||
    value === "security-privacy" ||
    value === "software-update"
  );
}

function getLanguageLabel(language: AppLanguage): string {
  return language === "en-US" ? t("locale.enUS") : t("locale.zhCN");
}

function getReleaseChannelLabel(channel: ReleaseChannel): string {
  return channel === "beta" ? t("settings.releaseBeta") : t("settings.releaseStable");
}

function getPermissionModeLabel(mode: ClientPermissionMode): string {
  switch (mode) {
    case "acceptEdits":
      return t("settings.permissionModeAcceptEdits");
    case "bypassPermissions":
      return t("settings.permissionModeBypassPermissions");
    default:
      return t("settings.permissionModeDefault");
  }
}

function useSettingsPageModel(): SettingsPageModel {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const runtimeConfig = useClientConfigSelector((state) => state);
  const platform = usePlatform();
  const canConfigureServerAddress = canConfigureHostBaseUrl(runtimeConfig.platform);
  const showServerSettings = canConfigureServerAddress;
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

  function updateReleaseChannel(value: string): void {
    void clientConfigStore.update({
      releaseChannel: value === "beta" ? "beta" : "stable"
    });
  }

  function updateAutoReconnect(enabled: boolean): void {
    void clientConfigStore.update({
      autoReconnect: enabled
    });
  }

  function updateAutoCheckUpdate(enabled: boolean): void {
    void clientConfigStore.update({
      autoCheckUpdate: enabled
    });
  }

  function updateDefaultPermissionMode(value: string): void {
    void clientConfigStore.update({
      defaultPermissionMode:
        value === "acceptEdits" || value === "bypassPermissions" ? value : "default"
    });
  }

  return {
    platform,
    theme,
    setTheme,
    runtimeConfig,
    showServerSettings,
    canConfigureServerAddress,
    hostBaseUrlDraft,
    setHostBaseUrlDraft,
    canSaveHostBaseUrl,
    permissionModeOptions,
    handleHostBaseUrlSubmit,
    handleLogout,
    updateReleaseChannel,
    updateAutoReconnect,
    updateAutoCheckUpdate,
    updateDefaultPermissionMode
  };
}

export function SettingsPage() {
  const model = useSettingsPageModel();

  if (model.platform.isMobile) {
    return <MobileSettingsPage model={model} />;
  }

  return <DesktopSettingsPage model={model} />;
}

function DesktopSettingsPage({ model }: { model: SettingsPageModel }) {
  const {
    theme,
    setTheme,
    runtimeConfig,
    showServerSettings,
    hostBaseUrlDraft,
    setHostBaseUrlDraft,
    canSaveHostBaseUrl,
    permissionModeOptions,
    platform,
    handleHostBaseUrlSubmit,
    handleLogout,
    updateReleaseChannel,
    updateAutoReconnect,
    updateAutoCheckUpdate,
    updateDefaultPermissionMode
  } = model;

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

        {showServerSettings ? (
          <section className="settings-section">
            <h2 className="settings-section-title">{t("settings.serverConnection")}</h2>
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
                      onChange={(event) => updateAutoReconnect(event.target.checked)}
                    />
                    <span>{runtimeConfig.autoReconnect ? t("settings.enabled") : t("settings.disabled")}</span>
                  </label>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className="settings-section">
          <h2 className="settings-section-title">{t("settings.securityPrivacy")}</h2>
          <div className="settings-card">
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
                  onChange={(event) => updateDefaultPermissionMode(event.target.value)}
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
          <h2 className="settings-section-title">{t("settings.softwareUpdate")}</h2>
          <div className="settings-card">
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
                  onChange={(event) => updateReleaseChannel(event.target.value)}
                >
                  <option value="stable">{t("settings.releaseStable")}</option>
                  <option value="beta">{t("settings.releaseBeta")}</option>
                </select>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.serverUpdate")}</span>
              </div>
              <div className="settings-row-control settings-row-control-stretch">
                <ServiceUpdatePanel />
              </div>
            </div>

            {!platform.isWeb ? (
              <>
                <div className="settings-row">
                  <div className="settings-row-label">
                    <span className="settings-row-title">{t("settings.autoCheckUpdate")}</span>
                  </div>
                  <div className="settings-row-control">
                    <label className="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={runtimeConfig.autoCheckUpdate}
                        onChange={(event) => updateAutoCheckUpdate(event.target.checked)}
                      />
                      <span>{runtimeConfig.autoCheckUpdate ? t("settings.enabled") : t("settings.disabled")}</span>
                    </label>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-label">
                    <span className="settings-row-title">{t("settings.clientUpdate")}</span>
                  </div>
                  <div className="settings-row-control settings-row-control-stretch">
                    <ReleasePanel />
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </section>

        <div className="settings-footer settings-footer-with-logout">
          <span className="settings-version">CodingNS v1.0.0</span>
          <button className="settings-button settings-button-danger settings-button-sticky" onClick={handleLogout} type="button">
            {t("common.logout")}
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileSettingsPage({ model }: { model: SettingsPageModel }) {
  const navigate = useNavigate();
  const { section } = useParams<{ section?: string }>();
  const activeSection = isSettingsSectionId(section) ? section : null;
  const sectionEntries: SettingsSectionMeta[] = model.showServerSettings
    ? [
      {
        id: "appearance",
        title: t("settings.appearance"),
        description: t("settings.appearanceSectionSummary"),
        value: getLanguageLabel(model.runtimeConfig.language),
        icon: <AppearanceSectionIcon />
      },
      {
        id: "server-connection",
        title: t("settings.serverConnection"),
        description: t("settings.serverConnectionSectionSummary"),
        value: model.runtimeConfig.hostBaseUrl,
        icon: <ConnectionSectionIcon />
      },
      {
        id: "security-privacy",
        title: t("settings.securityPrivacy"),
        description: t("settings.securityPrivacySectionSummary"),
        value: getPermissionModeLabel(model.runtimeConfig.defaultPermissionMode),
        icon: <SecurityPrivacySectionIcon />
      },
      {
        id: "software-update",
        title: t("settings.softwareUpdate"),
        description: t("settings.softwareUpdateSectionSummary"),
        value: getReleaseChannelLabel(model.runtimeConfig.releaseChannel),
        icon: <DesktopReleaseSectionIcon />
      }
    ]
    : [
      {
        id: "appearance",
        title: t("settings.appearance"),
        description: t("settings.appearanceSectionSummary"),
        value: getLanguageLabel(model.runtimeConfig.language),
        icon: <AppearanceSectionIcon />
      },
      {
        id: "security-privacy",
        title: t("settings.securityPrivacy"),
        description: t("settings.securityPrivacySectionSummary"),
        value: getPermissionModeLabel(model.runtimeConfig.defaultPermissionMode),
        icon: <SecurityPrivacySectionIcon />
      },
      {
        id: "software-update",
        title: t("settings.softwareUpdate"),
        description: t("settings.softwareUpdateSectionSummary"),
        value: getReleaseChannelLabel(model.runtimeConfig.releaseChannel),
        icon: <DesktopReleaseSectionIcon />
      }
    ];
  const currentSection = activeSection
    ? sectionEntries.find((entry) => entry.id === activeSection) ?? null
    : null;

  if (!currentSection) {
    return (
      <div className="settings-page settings-page-mobile mobile-page-scroll-root mobile-page-with-top-header">
        <MobilePageHeader title={t("settings.title")} />
        <div className="settings-mobile-container">
          <section className="settings-mobile-group-section">
            <div className="settings-mobile-card">
              {sectionEntries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="settings-mobile-nav-row"
                  onClick={() => navigate(`/settings/${entry.id}`)}
                >
                  <span className="settings-mobile-nav-icon">{entry.icon}</span>
                  <span className="settings-mobile-nav-copy">
                    <span className="settings-mobile-nav-title">{entry.title}</span>
                    <span className="settings-mobile-nav-description">{entry.description}</span>
                  </span>
                  <span className="settings-mobile-nav-trailing">
                    {entry.value ? <span className="settings-mobile-nav-value">{entry.value}</span> : null}
                    <ChevronRightIcon />
                  </span>
                </button>
              ))}
            </div>
          </section>

          <div className="settings-footer settings-footer-mobile">
            <span className="settings-version">CodingNS v1.0.0</span>
          </div>
        </div>
        <MobileSettingsLogoutBar onLogout={model.handleLogout} />
      </div>
    );
  }

  return (
    <div className="settings-page settings-page-mobile mobile-page-scroll-root mobile-page-with-top-header">
      <MobilePageHeader title={t("settings.title")} />
      <div className="settings-mobile-container">
        {activeSection === "appearance" ? <MobileAppearanceSection model={model} /> : null}
        {activeSection === "server-connection" && model.showServerSettings
          ? <MobileServerConnectionSection model={model} />
          : null}
        {activeSection === "security-privacy" ? <MobileSecurityPrivacySection model={model} /> : null}
        {activeSection === "software-update" ? <MobileSoftwareUpdateSection model={model} /> : null}
      </div>
      <MobileSettingsLogoutBar onLogout={model.handleLogout} />
    </div>
  );
}

function MobileAppearanceSection({ model }: { model: SettingsPageModel }) {
  return (
    <>
      <section className="settings-mobile-group-section">
        <h2 className="settings-mobile-group-title">{t("settings.language")}</h2>
        <p className="settings-mobile-group-note">{t("settings.languageDescription")}</p>
        <div className="settings-mobile-card">
          <div className="settings-mobile-form-row">
            <div className="settings-mobile-row-copy">
              <span className="settings-mobile-row-title">{t("settings.language")}</span>
            </div>
            <LanguageSwitcher variant="compact" className="settings-mobile-language-switcher" />
          </div>
        </div>
      </section>

      <section className="settings-mobile-group-section">
        <h2 className="settings-mobile-group-title">{t("settings.theme")}</h2>
        <p className="settings-mobile-group-note">{t("settings.themeDescription")}</p>
        <div className="settings-mobile-card">
          {THEMES.map((themeOption) => {
            const isActive = model.theme === themeOption.id;

            return (
              <button
                key={themeOption.id}
                type="button"
                className={`settings-mobile-choice-row${isActive ? " active" : ""}`}
                aria-pressed={isActive}
                onClick={() => model.setTheme(themeOption.id as ThemeId)}
              >
                <span className="settings-mobile-choice-leading">
                  <span
                    className="settings-mobile-choice-dot"
                    style={{ background: themeOption.color }}
                    aria-hidden="true"
                  />
                  <span className="settings-mobile-choice-label">{getThemeLabel(themeOption)}</span>
                </span>
                <span className="settings-mobile-choice-indicator" aria-hidden="true">
                  {isActive ? <CheckIcon /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

function MobileServerConnectionSection({ model }: { model: SettingsPageModel }) {
  return (
    <>
      {model.canConfigureServerAddress ? (
        <section className="settings-mobile-group-section">
          <h2 className="settings-mobile-group-title">{t("settings.serverAddress")}</h2>
          <p className="settings-mobile-group-note">{t("settings.serverDescription")}</p>
          <div className="settings-mobile-card">
            <form className="settings-mobile-form-stack" onSubmit={model.handleHostBaseUrlSubmit}>
              <input
                aria-label={t("settings.serverAddress")}
                className="settings-text-input settings-mobile-input"
                value={model.hostBaseUrlDraft}
                onChange={(event) => model.setHostBaseUrlDraft(event.target.value)}
              />
              <button
                className="settings-mobile-primary-button"
                disabled={!model.canSaveHostBaseUrl}
                type="submit"
              >
                {t("common.save")}
              </button>
            </form>
          </div>
        </section>
      ) : null}

      <section className="settings-mobile-group-section">
        <h2 className="settings-mobile-group-title">{t("settings.serverConnection")}</h2>
        <div className="settings-mobile-card">
          <div className="settings-mobile-form-row">
            <div className="settings-mobile-row-copy">
              <span className="settings-mobile-row-title">{t("settings.autoReconnect")}</span>
              <span className="settings-mobile-row-description">
                {t("settings.autoReconnectDescription")}
              </span>
            </div>
            <MobileSwitch
              checked={model.runtimeConfig.autoReconnect}
              label={t("settings.autoReconnect")}
              onChange={model.updateAutoReconnect}
            />
          </div>
        </div>
      </section>
    </>
  );
}

function MobileSecurityPrivacySection({ model }: { model: SettingsPageModel }) {
  return (
    <section className="settings-mobile-group-section">
      <h2 className="settings-mobile-group-title">{t("settings.securityPrivacy")}</h2>
      <p className="settings-mobile-group-note">{t("settings.securityPrivacySectionSummary")}</p>
      <div className="settings-mobile-card">
        <div className="settings-mobile-form-row">
          <div className="settings-mobile-row-copy">
            <span className="settings-mobile-row-title">{t("settings.defaultPermissionMode")}</span>
            <span className="settings-mobile-row-description">
              {t("settings.defaultPermissionModeDescription")}
            </span>
          </div>
          <select
            aria-label={t("settings.defaultPermissionMode")}
            className="settings-select settings-mobile-select"
            value={model.runtimeConfig.defaultPermissionMode}
            onChange={(event) => model.updateDefaultPermissionMode(event.target.value)}
          >
            {model.permissionModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}

function MobileSoftwareUpdateSection({ model }: { model: SettingsPageModel }) {
  return (
    <>
      <section className="settings-mobile-group-section">
        <h2 className="settings-mobile-group-title">{t("settings.softwareUpdate")}</h2>
        <p className="settings-mobile-group-note">{t("settings.softwareUpdateSectionSummary")}</p>
        <div className="settings-mobile-card">
          <div className="settings-mobile-form-row">
            <div className="settings-mobile-row-copy">
              <span className="settings-mobile-row-title">{t("settings.releaseChannel")}</span>
              <span className="settings-mobile-row-description">
                {t("settings.releaseChannelDescription")}
              </span>
            </div>
            <select
              aria-label={t("settings.releaseChannel")}
              className="settings-select settings-mobile-select"
              value={model.runtimeConfig.releaseChannel}
              onChange={(event) => model.updateReleaseChannel(event.target.value)}
            >
              <option value="stable">{t("settings.releaseStable")}</option>
              <option value="beta">{t("settings.releaseBeta")}</option>
            </select>
          </div>

        </div>
      </section>

      <section className="settings-mobile-group-section">
        <h2 className="settings-mobile-group-title">{t("settings.serverUpdate")}</h2>
        <div className="settings-mobile-card settings-mobile-release-card">
          <ServiceUpdatePanel />
        </div>
      </section>

      {!model.platform.isWeb ? (
        <section className="settings-mobile-group-section">
          <h2 className="settings-mobile-group-title">{t("settings.clientUpdate")}</h2>
          <div className="settings-mobile-card">
            <div className="settings-mobile-form-row">
              <div className="settings-mobile-row-copy">
                <span className="settings-mobile-row-title">{t("settings.autoCheckUpdate")}</span>
              </div>
              <MobileSwitch
                checked={model.runtimeConfig.autoCheckUpdate}
                label={t("settings.autoCheckUpdate")}
                onChange={model.updateAutoCheckUpdate}
              />
            </div>
          </div>
          <div className="settings-mobile-card settings-mobile-release-card">
            <ReleasePanel />
          </div>
        </section>
      ) : null}
    </>
  );
}

function MobileSettingsLogoutBar({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="settings-mobile-sticky-footer">
      <button type="button" className="settings-mobile-danger-button settings-mobile-danger-button-sticky" onClick={onLogout}>
        {t("common.logout")}
      </button>
    </div>
  );
}

function MobileSwitch({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="settings-mobile-switch" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="settings-mobile-switch-track" aria-hidden="true">
        <span className="settings-mobile-switch-thumb" />
      </span>
    </label>
  );
}

function AppearanceSectionIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M10 3.5a6.5 6.5 0 1 0 6.5 6.5c0-.8-.6-1.4-1.4-1.4h-1.6A1.5 1.5 0 0 1 12 7.1V5.5c0-1.1-.9-2-2-2Z" />
      <circle cx="6.6" cy="9.2" r=".8" fill="currentColor" stroke="none" />
      <circle cx="8.8" cy="6.8" r=".8" fill="currentColor" stroke="none" />
      <circle cx="12.1" cy="6.6" r=".8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ConnectionSectionIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 7.5 10 4l6 3.5v5L10 16l-6-3.5v-5Z" />
      <path d="M10 9.5V16" />
      <path d="M4 7.5 10 11l6-3.5" />
    </svg>
  );
}

function DesktopReleaseSectionIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3.5" y="4" width="13" height="9.5" rx="2.2" />
      <path d="M7 16h6" />
      <path d="M10 13.5V16" />
      <path d="m8 8 2 2 3-3" />
    </svg>
  );
}

function SecurityPrivacySectionIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M10 3.2 15 5v4.4c0 3-1.9 5.8-5 7.4-3.1-1.6-5-4.4-5-7.4V5l5-1.8Z" />
      <path d="m8.3 9.8 1.2 1.2 2.4-2.5" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m4 2 4 4-4 4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m3.5 8.2 2.6 2.6 6-6" />
    </svg>
  );
}
