import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { clientConfigStore, useClientConfigSelector } from "../../../config/client-config-store";
import { canConfigureHostBaseUrl } from "../../../config/client-config-service";
import { getActiveHostBaseUrl } from "../../../config/client-config-types";
import type {
  AppLanguage,
  ClientRuntimeConfig,
  ClientPermissionMode,
  ReleaseChannel
} from "../../../config/client-config-types";
import { normalizeServerBaseUrl } from "../../../config/server-config";
import { usePlatform } from "../../../platform/platform-provider";
import {
  localUiPreferenceStore,
  useLocalUiPreferenceSelector
} from "../../../preferences/local-ui-preference-store";
import type { SessionDisplaySortMode } from "../../../preferences/local-ui-preference-store";
import { useUserPreferenceSelector, userPreferenceStore } from "../../../preferences/user-preference-store";
import { LanguageSwitcher, t } from "../../../shared/i18n";
import { THEMES, getThemeLabel, useTheme, type ThemeId } from "../../../shared/theme";
import { useAppVersion } from "../../../shared/version/app-version";
import { ParallelTaskDebugModal } from "../../../settings/ParallelTaskDebugModal";
import { ClientUpdatePanel } from "../../../settings/ClientUpdatePanel";
import { ServiceUpdatePanel } from "../../../settings/ServiceUpdatePanel";
import { SkillManagementPanel } from "../../../settings/SkillManagementPanel";
import { TailscalePanel } from "../../../settings/TailscalePanel";
import { authStore } from "../../auth/store/auth-store";
import { MobilePageHeader } from "../../mobile-shell/components/MobilePageHeader";

type SettingsSectionId =
  | "appearance"
  | "server-connection"
  | "remote-access"
  | "skills"
  | "security-privacy"
  | "software-update";

interface SettingsPageModel {
  readonly platform: ReturnType<typeof usePlatform>;
  readonly theme: ThemeId;
  readonly applyTheme: (id: ThemeId) => void;
  readonly runtimeConfig: ClientRuntimeConfig;
  readonly accountPreferences: {
    language: AppLanguage;
    defaultPermissionMode: ClientPermissionMode;
  };
  readonly sessionDisplaySortMode: SessionDisplaySortMode;
  readonly showSystemFiles: boolean;
  readonly notifyOnPermissionRequest: boolean;
  readonly notifyOnSessionCompleted: boolean;
  readonly notifyOnSessionFailed: boolean;
  readonly showServerSettings: boolean;
  readonly canConfigureServerAddress: boolean;
  readonly hostBaseUrlDraft: string;
  readonly setHostBaseUrlDraft: (value: string) => void;
  readonly canSaveHostBaseUrl: boolean;
  readonly permissionModeOptions: Array<{
    value: ClientPermissionMode;
    label: string;
  }>;
  readonly sessionDisplaySortModeOptions: Array<{
    value: SessionDisplaySortMode;
    label: string;
  }>;
  readonly handleHostBaseUrlSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly handleLogout: () => void;
  readonly updateReleaseChannel: (value: string) => void;
  readonly updateAutoReconnect: (enabled: boolean) => void;
  readonly updateAutoCheckUpdate: (enabled: boolean) => void;
  readonly updateDefaultPermissionMode: (value: string) => void;
  readonly updateSessionDisplaySortMode: (value: string) => void;
  readonly updateShowSystemFiles: (enabled: boolean) => void;
  readonly updateNotifyOnPermissionRequest: (enabled: boolean) => void;
  readonly updateNotifyOnSessionCompleted: (enabled: boolean) => void;
  readonly updateNotifyOnSessionFailed: (enabled: boolean) => void;
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
    value === "remote-access" ||
    value === "skills" ||
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
  const preferenceLanguage = useUserPreferenceSelector((state) => state.profile.language);
  const preferencePermissionMode = useUserPreferenceSelector(
    (state) => state.profile.defaultPermissionMode
  );
  const sessionDisplaySortMode = useLocalUiPreferenceSelector((state) => state.sessionDisplaySortMode);
  const showSystemFiles = useLocalUiPreferenceSelector((state) => state.showSystemFiles);
  const notifyOnPermissionRequest = useLocalUiPreferenceSelector(
    (state) => state.notificationPreferences.notifyOnPermissionRequest
  );
  const notifyOnSessionCompleted = useLocalUiPreferenceSelector(
    (state) => state.notificationPreferences.notifyOnSessionCompleted
  );
  const notifyOnSessionFailed = useLocalUiPreferenceSelector(
    (state) => state.notificationPreferences.notifyOnSessionFailed
  );
  const accountPreferences = {
    language: preferenceLanguage,
    defaultPermissionMode: preferencePermissionMode
  };
  const platform = usePlatform();
  const canConfigureServerAddress = canConfigureHostBaseUrl(runtimeConfig.platform);
  const showServerSettings = canConfigureServerAddress;
  const activeHostBaseUrl = getActiveHostBaseUrl(runtimeConfig) ?? "";
  const [hostBaseUrlDraft, setHostBaseUrlDraft] = useState(activeHostBaseUrl);

  useEffect(() => {
    setHostBaseUrlDraft(activeHostBaseUrl);
  }, [activeHostBaseUrl]);

  function handleLogout(): void {
    authStore.clear();
    userPreferenceStore.resetToLocalFallback();
    navigate("/login", { replace: true });
  }

  function applyTheme(id: ThemeId): void {
    setTheme(id);
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
    normalizedHostBaseUrlDraft !== null && normalizedHostBaseUrlDraft !== activeHostBaseUrl;

  function handleHostBaseUrlSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!normalizedHostBaseUrlDraft) {
      return;
    }

    void clientConfigStore.update({
      hosts: runtimeConfig.hosts.map((host) =>
        host.id === runtimeConfig.activeHostId
          ? {
              ...host,
              baseUrl: normalizedHostBaseUrlDraft,
              updatedAt: new Date().toISOString()
            }
          : host
      )
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

  const sessionDisplaySortModeOptions: Array<{
    value: SessionDisplaySortMode;
    label: string;
  }> = [
    {
      value: "createdAt",
      label: t("settings.sessionSortModeCreatedAt")
    },
    {
      value: "updatedAt",
      label: t("settings.sessionSortModeUpdatedAt")
    },
    {
      value: "title",
      label: t("settings.sessionSortModeTitle")
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
    const normalized =
      value === "acceptEdits" || value === "bypassPermissions" ? value : "default";
    void userPreferenceStore.updateProfile({ defaultPermissionMode: normalized }).catch(() => {});
  }

  function updateSessionDisplaySortMode(value: string): void {
    const normalized: SessionDisplaySortMode =
      value === "updatedAt" || value === "title" ? value : "createdAt";
    localUiPreferenceStore.setSessionDisplaySortMode(normalized);
  }

  function updateShowSystemFiles(enabled: boolean): void {
    localUiPreferenceStore.setShowSystemFiles(enabled);
  }

  function updateNotifyOnPermissionRequest(enabled: boolean): void {
    localUiPreferenceStore.setNotificationPreferences({
      notifyOnPermissionRequest: enabled
    });
  }

  function updateNotifyOnSessionCompleted(enabled: boolean): void {
    localUiPreferenceStore.setNotificationPreferences({
      notifyOnSessionCompleted: enabled
    });
  }

  function updateNotifyOnSessionFailed(enabled: boolean): void {
    localUiPreferenceStore.setNotificationPreferences({
      notifyOnSessionFailed: enabled
    });
  }

  return {
    platform,
    theme,
    applyTheme,
    runtimeConfig,
    accountPreferences,
    sessionDisplaySortMode,
    showSystemFiles,
    notifyOnPermissionRequest,
    notifyOnSessionCompleted,
    notifyOnSessionFailed,
    showServerSettings,
    canConfigureServerAddress,
    hostBaseUrlDraft,
    setHostBaseUrlDraft,
    canSaveHostBaseUrl,
    permissionModeOptions,
    sessionDisplaySortModeOptions,
    handleHostBaseUrlSubmit,
    handleLogout,
    updateReleaseChannel,
    updateAutoReconnect,
    updateAutoCheckUpdate,
    updateDefaultPermissionMode,
    updateSessionDisplaySortMode,
    updateShowSystemFiles,
    updateNotifyOnPermissionRequest,
    updateNotifyOnSessionCompleted,
    updateNotifyOnSessionFailed
  };
}

export function SettingsPage() {
  const model = useSettingsPageModel();
  const appVersion = useAppVersion();

  if (model.platform.isMobile) {
    return <MobileSettingsPage model={model} appVersion={appVersion} />;
  }

  return <DesktopSettingsPage model={model} appVersion={appVersion} />;
}

function DesktopSettingsPage({ model, appVersion }: { model: SettingsPageModel; appVersion: string }) {
  const [showParallelTaskDebug, setShowParallelTaskDebug] = useState(false);
  const {
    theme,
    applyTheme,
    runtimeConfig,
    accountPreferences,
    sessionDisplaySortMode,
    showSystemFiles,
    notifyOnPermissionRequest,
    notifyOnSessionCompleted,
    notifyOnSessionFailed,
    showServerSettings,
    hostBaseUrlDraft,
    setHostBaseUrlDraft,
    canSaveHostBaseUrl,
    permissionModeOptions,
    sessionDisplaySortModeOptions,
    platform,
    handleHostBaseUrlSubmit,
    handleLogout,
    updateReleaseChannel,
    updateAutoReconnect,
    updateAutoCheckUpdate,
    updateDefaultPermissionMode,
    updateSessionDisplaySortMode,
    updateShowSystemFiles,
    updateNotifyOnPermissionRequest,
    updateNotifyOnSessionCompleted,
    updateNotifyOnSessionFailed
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
                      onClick={() => applyTheme(themeOption.id as ThemeId)}
                    >
                      <span className="theme-preview" style={{ background: themeOption.color }} />
                      <span className="theme-label">{getThemeLabel(themeOption)}</span>
                      {theme === themeOption.id ? <span className="theme-check">✓</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.workspaceSessionSortMode")}</span>
                <span className="settings-row-description">
                  {t("settings.workspaceSessionSortModeDescription")}
                </span>
              </div>
              <div className="settings-row-control">
                <select
                  aria-label={t("settings.workspaceSessionSortMode")}
                  className="settings-select"
                  value={sessionDisplaySortMode}
                  onChange={(event) => updateSessionDisplaySortMode(event.target.value)}
                >
                  {sessionDisplaySortModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.showSystemFiles")}</span>
                <span className="settings-row-description">{t("settings.showSystemFilesDescription")}</span>
              </div>
              <div className="settings-row-control">
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    aria-label={t("settings.showSystemFiles")}
                    checked={showSystemFiles}
                    onChange={(event) => updateShowSystemFiles(event.target.checked)}
                  />
                  <span>{showSystemFiles ? t("settings.enabled") : t("settings.disabled")}</span>
                </label>
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
          <h2 className="settings-section-title">{t("settings.remoteAccess")}</h2>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-control settings-row-control-stretch">
                <TailscalePanel />
              </div>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">{t("settings.skills")}</h2>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-control settings-row-control-stretch">
                <SkillManagementPanel />
              </div>
            </div>
          </div>
        </section>

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
                  value={accountPreferences.defaultPermissionMode}
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

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.notifyOnPermissionRequest")}</span>
                <span className="settings-row-description">
                  {t("settings.notifyOnPermissionRequestDescription")}
                </span>
              </div>
              <div className="settings-row-control">
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    aria-label={t("settings.notifyOnPermissionRequest")}
                    checked={notifyOnPermissionRequest}
                    onChange={(event) => updateNotifyOnPermissionRequest(event.target.checked)}
                  />
                  <span>{notifyOnPermissionRequest ? t("settings.enabled") : t("settings.disabled")}</span>
                </label>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.notifyOnSessionCompleted")}</span>
                <span className="settings-row-description">
                  {t("settings.notifyOnSessionCompletedDescription")}
                </span>
              </div>
              <div className="settings-row-control">
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    aria-label={t("settings.notifyOnSessionCompleted")}
                    checked={notifyOnSessionCompleted}
                    onChange={(event) => updateNotifyOnSessionCompleted(event.target.checked)}
                  />
                  <span>{notifyOnSessionCompleted ? t("settings.enabled") : t("settings.disabled")}</span>
                </label>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.notifyOnSessionFailed")}</span>
                <span className="settings-row-description">
                  {t("settings.notifyOnSessionFailedDescription")}
                </span>
              </div>
              <div className="settings-row-control">
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    aria-label={t("settings.notifyOnSessionFailed")}
                    checked={notifyOnSessionFailed}
                    onChange={(event) => updateNotifyOnSessionFailed(event.target.checked)}
                  />
                  <span>{notifyOnSessionFailed ? t("settings.enabled") : t("settings.disabled")}</span>
                </label>
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
                    <ClientUpdatePanel />
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">{t("settings.advancedSettings")}</h2>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.parallelTaskDebug")}</span>
                <span className="settings-row-description">
                  {t("settings.parallelTaskDebugDescription")}
                </span>
              </div>
              <div className="settings-row-control">
                <button
                  className="settings-button"
                  type="button"
                  onClick={() => setShowParallelTaskDebug(true)}
                >
                  {t("settings.parallelTaskDebugAction")}
                </button>
              </div>
            </div>
          </div>
        </section>

        <div className="settings-footer settings-footer-with-logout">
          <span className="settings-version">CodingNS v{appVersion}</span>
          <button className="settings-button settings-button-danger settings-button-sticky" onClick={handleLogout} type="button">
            {t("common.logout")}
          </button>
        </div>
      </div>
      <ParallelTaskDebugModal
        isOpen={showParallelTaskDebug}
        onClose={() => setShowParallelTaskDebug(false)}
      />
    </div>
  );
}

function MobileSettingsPage({ model, appVersion }: { model: SettingsPageModel; appVersion: string }) {
  const navigate = useNavigate();
  const { section } = useParams<{ section?: string }>();
  const activeSection = isSettingsSectionId(section) ? section : null;
  const sectionEntries: SettingsSectionMeta[] = [
    {
      id: "appearance",
      title: t("settings.appearance"),
      description: t("settings.appearanceSectionSummary"),
      value: getLanguageLabel(model.accountPreferences.language),
      icon: <AppearanceSectionIcon />
    }
  ];

  if (model.showServerSettings) {
    sectionEntries.push({
      id: "server-connection",
      title: t("settings.serverConnection"),
      description: t("settings.serverConnectionSectionSummary"),
      value: getActiveHostBaseUrl(model.runtimeConfig) ?? "",
      icon: <ConnectionSectionIcon />
    });
  }

  sectionEntries.push(
    {
      id: "remote-access",
      title: t("settings.remoteAccess"),
      description: t("settings.remoteAccessSectionSummary"),
      value: t("settings.tailscaleBrand"),
      icon: <RemoteAccessSectionIcon />
    },
    {
      id: "skills",
      title: t("settings.skills"),
      description: t("settings.skillsSectionSummary"),
      value: t("settings.skillsNavValue"),
      icon: <SkillsSectionIcon />
    },
    {
      id: "security-privacy",
      title: t("settings.securityPrivacy"),
      description: t("settings.securityPrivacySectionSummary"),
      value: getPermissionModeLabel(model.accountPreferences.defaultPermissionMode),
      icon: <SecurityPrivacySectionIcon />
    },
    {
      id: "software-update",
      title: t("settings.softwareUpdate"),
      description: t("settings.softwareUpdateSectionSummary"),
      value: getReleaseChannelLabel(model.runtimeConfig.releaseChannel),
      icon: <DesktopReleaseSectionIcon />
    }
  );
  const currentSection = activeSection
    ? sectionEntries.find((entry) => entry.id === activeSection) ?? null
    : null;

  if (!currentSection) {
    return (
      <div className="settings-page settings-page-mobile mobile-page-scroll-root mobile-page-with-top-header">
        <MobilePageHeader title={t("settings.title")} />
        <div className="settings-mobile-container">
          <section className="settings-mobile-group-section">
            <div className="settings-mobile-list">
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
            <span className="settings-version">CodingNS v{appVersion}</span>
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
        {activeSection === "remote-access" ? <MobileRemoteAccessSection /> : null}
        {activeSection === "skills" ? <MobileSkillManagementSection /> : null}
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
        <div className="settings-mobile-list">
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
        <div className="settings-mobile-list">
          {THEMES.map((themeOption) => {
            const isActive = model.theme === themeOption.id;

            return (
              <button
                key={themeOption.id}
                type="button"
                className={`settings-mobile-choice-row${isActive ? " active" : ""}`}
                aria-pressed={isActive}
                onClick={() => model.applyTheme(themeOption.id as ThemeId)}
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

      <section className="settings-mobile-group-section">
        <h2 className="settings-mobile-group-title">{t("settings.fileManager")}</h2>
        <p className="settings-mobile-group-note">{t("settings.workspaceSessionSortModeDescription")}</p>
        <div className="settings-mobile-list">
          <div className="settings-mobile-form-row">
            <div className="settings-mobile-row-copy">
              <span className="settings-mobile-row-title">{t("settings.workspaceSessionSortMode")}</span>
              <span className="settings-mobile-row-description">
                {t("settings.workspaceSessionSortModeDescription")}
              </span>
            </div>
            <select
              aria-label={t("settings.workspaceSessionSortMode")}
              className="settings-select settings-mobile-select"
              value={model.sessionDisplaySortMode}
              onChange={(event) => model.updateSessionDisplaySortMode(event.target.value)}
            >
              {model.sessionDisplaySortModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-mobile-form-row">
            <div className="settings-mobile-row-copy">
              <span className="settings-mobile-row-title">{t("settings.showSystemFiles")}</span>
              <span className="settings-mobile-row-description">
                {t("settings.showSystemFilesDescription")}
              </span>
            </div>
            <MobileSwitch
              checked={model.showSystemFiles}
              label={t("settings.showSystemFiles")}
              onChange={model.updateShowSystemFiles}
            />
          </div>
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
          <div className="settings-mobile-list">
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
        <div className="settings-mobile-list">
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
    <>
      <section className="settings-mobile-group-section">
        <h2 className="settings-mobile-group-title">{t("settings.securityPrivacy")}</h2>
        <p className="settings-mobile-group-note">{t("settings.securityPrivacySectionSummary")}</p>
        <div className="settings-mobile-list">
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
              value={model.accountPreferences.defaultPermissionMode}
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

      <section className="settings-mobile-group-section">
        <h2 className="settings-mobile-group-title">{t("settings.notificationSettings")}</h2>
        <p className="settings-mobile-group-note">{t("settings.notificationSettingsDescription")}</p>
        <div className="settings-mobile-list">
          <div className="settings-mobile-form-row">
            <div className="settings-mobile-row-copy">
              <span className="settings-mobile-row-title">{t("settings.notifyOnPermissionRequest")}</span>
              <span className="settings-mobile-row-description">
                {t("settings.notifyOnPermissionRequestDescription")}
              </span>
            </div>
            <MobileSwitch
              checked={model.notifyOnPermissionRequest}
              label={t("settings.notifyOnPermissionRequest")}
              onChange={model.updateNotifyOnPermissionRequest}
            />
          </div>

          <div className="settings-mobile-form-row">
            <div className="settings-mobile-row-copy">
              <span className="settings-mobile-row-title">{t("settings.notifyOnSessionCompleted")}</span>
              <span className="settings-mobile-row-description">
                {t("settings.notifyOnSessionCompletedDescription")}
              </span>
            </div>
            <MobileSwitch
              checked={model.notifyOnSessionCompleted}
              label={t("settings.notifyOnSessionCompleted")}
              onChange={model.updateNotifyOnSessionCompleted}
            />
          </div>

          <div className="settings-mobile-form-row">
            <div className="settings-mobile-row-copy">
              <span className="settings-mobile-row-title">{t("settings.notifyOnSessionFailed")}</span>
              <span className="settings-mobile-row-description">
                {t("settings.notifyOnSessionFailedDescription")}
              </span>
            </div>
            <MobileSwitch
              checked={model.notifyOnSessionFailed}
              label={t("settings.notifyOnSessionFailed")}
              onChange={model.updateNotifyOnSessionFailed}
            />
          </div>
        </div>
      </section>
    </>
  );
}

function MobileRemoteAccessSection() {
  return (
    <section className="settings-mobile-group-section">
      <h2 className="settings-mobile-group-title">{t("settings.remoteAccess")}</h2>
      <p className="settings-mobile-group-note">{t("settings.remoteAccessSectionSummary")}</p>
      <div className="settings-mobile-panel-shell">
        <TailscalePanel />
      </div>
    </section>
  );
}

function MobileSkillManagementSection() {
  return (
    <section className="settings-mobile-group-section">
      <h2 className="settings-mobile-group-title">{t("settings.skills")}</h2>
      <p className="settings-mobile-group-note">{t("settings.skillsSectionSummary")}</p>
      <div className="settings-mobile-panel-shell">
        <SkillManagementPanel />
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
        <div className="settings-mobile-list">
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
        <div className="settings-mobile-panel-shell">
          <ServiceUpdatePanel />
        </div>
      </section>

      {!model.platform.isWeb ? (
        <section className="settings-mobile-group-section">
          <h2 className="settings-mobile-group-title">{t("settings.clientUpdate")}</h2>
          <div className="settings-mobile-list">
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
          <div className="settings-mobile-panel-shell">
            <ClientUpdatePanel />
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

function RemoteAccessSectionIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="10" cy="10" r="5.8" />
      <path d="M10 4.2c1.5 1.3 2.4 3.5 2.4 5.8s-.9 4.5-2.4 5.8c-1.5-1.3-2.4-3.5-2.4-5.8s.9-4.5 2.4-5.8Z" />
      <path d="M4.6 8.1h10.8" />
      <path d="M4.6 11.9h10.8" />
    </svg>
  );
}

function SkillsSectionIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="3.5" y="4" width="13" height="12" rx="2.5" />
      <path d="M6 7h8M6 10h8M6 13h4" strokeLinecap="round" />
      <path d="m12.7 13.2 1.4 1.4 2.6-2.8" strokeLinecap="round" strokeLinejoin="round" />
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
