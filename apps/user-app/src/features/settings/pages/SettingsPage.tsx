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
import { ModelManagementPanel } from "../../../settings/ModelManagementPanel";
import { ProviderManagementPanel } from "../../../settings/ProviderManagementPanel";
import { ChannelsManagementPanel } from "../../../settings/ChannelsManagementPanel";
import { AuthDeviceManagementPanel } from "../../../settings/AuthDeviceManagementPanel";
import { ServiceUpdatePanel } from "../../../settings/ServiceUpdatePanel";
import { RemoteAccessManagerModal } from "../../../settings/RemoteAccessManagerModal";
import { authStore } from "../../auth/store/auth-store";
import { MobilePageHeader } from "../../mobile-shell/components/MobilePageHeader";
import type { DebugPortPoolConfig } from "../../../preferences/types";

const DEFAULT_DEBUG_PORT_POOLS: DebugPortPoolConfig = {
  start: 43000,
  end: 47999
};

type SettingsSectionId =
  | "appearance"
  | "ability-management"
  | "channels-management"
  | "model-management"
  | "provider-management"
  | "server-connection"
  | "remote-access"
  | "security-privacy"
  | "software-update";

interface SettingsPageModel {
  readonly platform: ReturnType<typeof usePlatform>;
  readonly theme: ThemeId;
  readonly selectedTheme: ThemeId;
  readonly autoTheme: boolean;
  readonly applyTheme: (id: ThemeId) => void;
  readonly applyAutoTheme: (enabled: boolean) => void;
  readonly runtimeConfig: ClientRuntimeConfig;
  readonly accountPreferences: {
    language: AppLanguage;
    defaultPermissionMode: ClientPermissionMode;
    debugPortPools: DebugPortPoolConfig;
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
  readonly updateDebugPortPools: (config: DebugPortPoolConfig) => Promise<void>;
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
    value === "ability-management" ||
    value === "channels-management" ||
    value === "model-management" ||
    value === "provider-management" ||
    value === "server-connection" ||
    value === "remote-access" ||
    value === "security-privacy" ||
    value === "software-update"
  );
}

function normalizeSettingsSectionId(value: string | undefined): SettingsSectionId | null {
  if (!isSettingsSectionId(value)) {
    return null;
  }

  if (value === "model-management" || value === "provider-management") {
    return "ability-management";
  }

  return value;
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
  const { theme, selectedTheme, autoTheme, setTheme, setAutoTheme } = useTheme();
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
    defaultPermissionMode: preferencePermissionMode,
    debugPortPools:
      useUserPreferenceSelector((state) => state.profile.debugPortPools)
      ?? DEFAULT_DEBUG_PORT_POOLS
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

  function applyAutoTheme(enabled: boolean): void {
    setAutoTheme(enabled);
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

  async function updateDebugPortPools(config: DebugPortPoolConfig): Promise<void> {
    await userPreferenceStore.updateProfile({
      debugPortPools: config
    });
  }

  return {
    platform,
    theme,
    selectedTheme,
    autoTheme,
    applyTheme,
    applyAutoTheme,
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
    updateNotifyOnSessionFailed,
    updateDebugPortPools
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
  const [remoteAccessModalOpen, setRemoteAccessModalOpen] = useState(false);
  const {
    theme,
    selectedTheme,
    autoTheme,
    applyTheme,
    applyAutoTheme,
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
    updateNotifyOnSessionFailed,
    updateDebugPortPools
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
                <span className="settings-row-description">{t("settings.themeDescription")}</span>
              </div>
              <div className="settings-row-control settings-row-control-stretch">
                <div className="settings-theme-panel">
                  <div className="settings-theme-toggle-row">
                    <span className="settings-row-title">{t("settings.autoTheme")}</span>
                    <SettingsSwitch
                      checked={autoTheme}
                      label={t("settings.autoTheme")}
                      onChange={applyAutoTheme}
                    />
                  </div>
                  <span className="settings-theme-note">{t("settings.autoThemeDescription")}</span>
                </div>
                <div className="theme-selector">
                  {THEMES.map((themeOption) => (
                    <button
                      key={themeOption.id}
                      type="button"
                      className={`theme-card ${selectedTheme === themeOption.id && !autoTheme ? "active" : ""}`}
                      aria-pressed={selectedTheme === themeOption.id && !autoTheme}
                      disabled={autoTheme}
                      onClick={() => applyTheme(themeOption.id as ThemeId)}
                    >
                      <span className="theme-preview" style={{ background: themeOption.color }} />
                      <span className="theme-label">{getThemeLabel(themeOption)}</span>
                      {selectedTheme === themeOption.id && !autoTheme ? <span className="theme-check">✓</span> : null}
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
                <SettingsSwitch
                  checked={showSystemFiles}
                  label={t("settings.showSystemFiles")}
                  onChange={updateShowSystemFiles}
                />
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
                  <SettingsSwitch
                    checked={runtimeConfig.autoReconnect}
                    label={t("settings.autoReconnect")}
                    onChange={updateAutoReconnect}
                  />
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className="settings-section">
          <h2 className="settings-section-title">{t("settings.abilityManagement")}</h2>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.providerManagement")}</span>
                <span className="settings-row-description">
                  {t("settings.providerManagementDescription")}
                </span>
              </div>
              <div className="settings-row-control">
                <ProviderManagementPanel />
              </div>
            </div>

            <div className="settings-row settings-row-stacked">
              <div className="settings-row-label settings-row-label-single-line">
                <span className="settings-row-title settings-row-title-strong">
                  {t("settings.modelManagementSectionTitle")}
                </span>
              </div>
              <div className="settings-row-control settings-row-control-stretch settings-row-control-full-width">
                <ModelManagementPanel />
              </div>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">{t("settings.channelsManagement")}</h2>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.channelsManagement")}</span>
                <span className="settings-row-description">
                  {t("settings.channelsManagementDescription")}
                </span>
              </div>
              <div className="settings-row-control settings-row-control-stretch">
                <ChannelsManagementPanel />
              </div>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">{t("settings.remoteAccess")}</h2>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">{t("settings.remoteAccessManageTitle")}</span>
                <span className="settings-row-description">
                  {t("settings.remoteAccessManageDescription")}
                </span>
              </div>
              <div className="settings-row-control">
                <button
                  className="settings-button"
                  type="button"
                  onClick={() => setRemoteAccessModalOpen(true)}
                >
                  {t("settings.remoteAccessManageAction")}
                </button>
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
                <span className="settings-row-title">{t("settings.authDeviceManagement")}</span>
                <span className="settings-row-description">
                  {t("settings.authDeviceManagementDescription")}
                </span>
              </div>
              <div className="settings-row-control settings-row-control-stretch">
                <AuthDeviceManagementPanel />
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
                <SettingsSwitch
                  checked={notifyOnPermissionRequest}
                  label={t("settings.notifyOnPermissionRequest")}
                  onChange={updateNotifyOnPermissionRequest}
                />
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
                <SettingsSwitch
                  checked={notifyOnSessionCompleted}
                  label={t("settings.notifyOnSessionCompleted")}
                  onChange={updateNotifyOnSessionCompleted}
                />
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
                <SettingsSwitch
                  checked={notifyOnSessionFailed}
                  label={t("settings.notifyOnSessionFailed")}
                  onChange={updateNotifyOnSessionFailed}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">{t("settings.debugPortPool")}</h2>
          <div className="settings-card">
            <DebugPortPoolEditor
              value={accountPreferences.debugPortPools}
              onSave={updateDebugPortPools}
            />
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
                    <SettingsSwitch
                      checked={runtimeConfig.autoCheckUpdate}
                      label={t("settings.autoCheckUpdate")}
                      onChange={updateAutoCheckUpdate}
                    />
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
      <RemoteAccessManagerModal
        open={remoteAccessModalOpen}
        mobile={false}
        onClose={() => setRemoteAccessModalOpen(false)}
      />
    </div>
  );
}

function MobileSettingsPage({ model, appVersion }: { model: SettingsPageModel; appVersion: string }) {
  const navigate = useNavigate();
  const { section } = useParams<{ section?: string }>();
  const activeSection = normalizeSettingsSectionId(section);
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
      id: "ability-management",
      title: t("settings.abilityManagement"),
      description: t("settings.abilityManagementSectionSummary"),
      value: t("settings.abilityManagementNavValue"),
      icon: <ProviderManagementSectionIcon />
    },
    {
      id: "channels-management",
      title: t("settings.channelsManagement"),
      description: t("settings.channelsManagementSectionSummary"),
      value: t("settings.channelsManagementNavValue"),
      icon: <ChannelsManagementSectionIcon />
    },
    {
      id: "remote-access",
      title: t("settings.remoteAccess"),
      description: t("settings.remoteAccessSectionSummary"),
      value: t("settings.remoteAccessNavValue"),
      icon: <RemoteAccessSectionIcon />
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
        {activeSection === "ability-management" ? <MobileAbilityManagementSection /> : null}
        {activeSection === "channels-management" ? <MobileChannelsManagementSection /> : null}
        {activeSection === "server-connection" && model.showServerSettings
          ? <MobileServerConnectionSection model={model} />
          : null}
        {activeSection === "remote-access" ? <MobileRemoteAccessSection model={model} /> : null}
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
          <div className="settings-mobile-form-row">
            <div className="settings-mobile-row-copy">
              <span className="settings-mobile-row-title">{t("settings.autoTheme")}</span>
              <span className="settings-mobile-row-description">
                {t("settings.autoThemeDescription")}
              </span>
            </div>
            <SettingsSwitch
              checked={model.autoTheme}
              label={t("settings.autoTheme")}
              onChange={model.applyAutoTheme}
            />
          </div>

          {THEMES.map((themeOption) => {
            const isActive = model.selectedTheme === themeOption.id && !model.autoTheme;

            return (
              <button
                key={themeOption.id}
                type="button"
                className={`settings-mobile-choice-row${isActive ? " active" : ""}`}
                aria-pressed={isActive}
                disabled={model.autoTheme}
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
            <SettingsSwitch
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
            <SettingsSwitch
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
        <h2 className="settings-mobile-group-title">{t("settings.authDeviceManagement")}</h2>
        <p className="settings-mobile-group-note">{t("settings.authDeviceManagementDescription")}</p>
        <div className="settings-mobile-panel-shell">
          <AuthDeviceManagementPanel compact />
        </div>
      </section>

      <section className="settings-mobile-group-section">
        <h2 className="settings-mobile-group-title">{t("settings.debugPortPool")}</h2>
        <div className="settings-mobile-list">
          <DebugPortPoolEditor
            value={model.accountPreferences.debugPortPools}
            onSave={model.updateDebugPortPools}
            compact
          />
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
            <SettingsSwitch
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
            <SettingsSwitch
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
            <SettingsSwitch
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

interface DebugPortPoolDraft {
  start: string;
  end: string;
}

function DebugPortPoolEditor(props: {
  value: DebugPortPoolConfig | undefined;
  onSave: (config: DebugPortPoolConfig) => Promise<void>;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState<DebugPortPoolDraft>(() => toDebugPortPoolDraft(props.value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(toDebugPortPoolDraft(props.value));
  }, [props.value]);

  async function handleSave(): Promise<void> {
    setError(null);
    setSaved(false);

    let nextConfig: DebugPortPoolConfig;

    try {
      nextConfig = parseDebugPortPoolDraft(draft);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("settings.debugPortPoolSaveFailed"));
      return;
    }

    try {
      setSaving(true);
      await props.onSave(nextConfig);
      setSaved(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("settings.debugPortPoolSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={props.compact ? "settings-mobile-form-stack" : "settings-debug-port-pool-editor"}>
      <div className={props.compact ? "settings-mobile-form-row" : "settings-row"}>
        <div className={props.compact ? "settings-mobile-row-copy" : "settings-row-label settings-debug-port-pool-label"}>
          <span className={props.compact ? "settings-mobile-row-title" : "settings-row-title"}>
            {t("settings.debugPortPoolRangeLabel")}
          </span>
        </div>
        <div className={props.compact ? "settings-mobile-form-stack" : "settings-row-control settings-row-control-stretch"}>
          <div className="settings-inline-form">
            <input
              aria-label={`${t("settings.debugPortPool")} ${t("settings.debugPortPoolStart")}`}
              className="settings-text-input"
              inputMode="numeric"
              value={draft.start}
              onChange={(event) => {
                const value = event.target.value;
                setDraft((current) => ({
                  ...current,
                  start: value
                }));
              }}
            />
            <span>{t("settings.debugPortPoolRangeSeparator")}</span>
            <input
              aria-label={`${t("settings.debugPortPool")} ${t("settings.debugPortPoolEnd")}`}
              className="settings-text-input"
              inputMode="numeric"
              value={draft.end}
              onChange={(event) => {
                const value = event.target.value;
                setDraft((current) => ({
                  ...current,
                  end: value
                }));
              }}
            />
            <button
              type="button"
              className={props.compact ? "settings-mobile-primary-button" : "settings-button"}
              disabled={saving}
              onClick={() => {
                void handleSave();
              }}
            >
              {saving ? t("common.loading") : t("common.save")}
            </button>
            {saved ? <span>{t("settings.debugPortPoolSaved")}</span> : null}
          </div>
        </div>
      </div>
      {error ? <p className="status-text settings-debug-port-pool-feedback" data-tone="error">{error}</p> : null}
    </div>
  );
}

function toDebugPortPoolDraft(value: DebugPortPoolConfig | undefined): DebugPortPoolDraft {
  const resolved = value ?? DEFAULT_DEBUG_PORT_POOLS;

  return {
    start: String(resolved.start),
    end: String(resolved.end)
  };
}

function parseDebugPortPoolDraft(draft: DebugPortPoolDraft): DebugPortPoolConfig {
  const start = Number.parseInt(draft.start, 10);
  const end = Number.parseInt(draft.end, 10);

  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error(t("settings.debugPortPoolValidationInteger"));
  }

  if (start < 1024 || end > 65535 || start >= end) {
    throw new Error(t("settings.debugPortPoolValidationRange"));
  }

  return { start, end };
}

function MobileRemoteAccessSection({ model }: { model: SettingsPageModel }) {
  const [remoteAccessModalOpen, setRemoteAccessModalOpen] = useState(false);

  return (
    <>
      <section className="settings-mobile-group-section">
        <h2 className="settings-mobile-group-title">{t("settings.remoteAccess")}</h2>
        <p className="settings-mobile-group-note">{t("settings.remoteAccessManageDescription")}</p>
        <div className="settings-mobile-list">
          <div className="settings-mobile-form-row">
            <div className="settings-mobile-row-copy">
              <span className="settings-mobile-row-title">{t("settings.remoteAccessManageTitle")}</span>
              <span className="settings-mobile-row-description">
                {t("settings.remoteAccessSectionSummary")}
              </span>
            </div>
            <button
              className="settings-mobile-primary-button"
              type="button"
              onClick={() => setRemoteAccessModalOpen(true)}
            >
              {t("settings.remoteAccessManageAction")}
            </button>
          </div>
        </div>
      </section>

      <RemoteAccessManagerModal
        open={remoteAccessModalOpen}
        mobile
        onClose={() => setRemoteAccessModalOpen(false)}
      />
    </>
  );
}

function MobileAbilityManagementSection() {
  return (
    <section className="settings-mobile-group-section">
      <h2 className="settings-mobile-group-title">{t("settings.abilityManagement")}</h2>
      <p className="settings-mobile-group-note">{t("settings.abilityManagementSectionSummary")}</p>
      <div className="settings-mobile-ability-stack">
        <div className="settings-mobile-panel-shell settings-mobile-provider-shell">
          <div className="settings-mobile-row-copy settings-mobile-ability-copy">
            <span className="settings-mobile-row-title">{t("settings.providerManagement")}</span>
            <span className="settings-mobile-row-description">
              {t("settings.providerManagementDescription")}
            </span>
          </div>
          <ProviderManagementPanel />
        </div>
        <div className="settings-mobile-panel-shell settings-mobile-model-shell">
          <div className="settings-mobile-row-copy settings-mobile-ability-copy settings-mobile-row-copy-single-line">
            <span className="settings-mobile-row-title settings-mobile-row-title-strong">
              {t("settings.modelManagementSectionTitle")}
            </span>
          </div>
          <ModelManagementPanel />
        </div>
      </div>
    </section>
  );
}

function MobileChannelsManagementSection() {
  return (
    <section className="settings-mobile-group-section">
      <h2 className="settings-mobile-group-title">{t("settings.channelsManagement")}</h2>
      <p className="settings-mobile-group-note">{t("settings.channelsManagementSectionSummary")}</p>
      <div className="settings-mobile-panel-shell settings-mobile-channels-shell">
        <div className="settings-mobile-row-copy settings-mobile-ability-copy">
          <span className="settings-mobile-row-title">{t("settings.channelsManagement")}</span>
          <span className="settings-mobile-row-description">
            {t("settings.channelsManagementDescription")}
          </span>
        </div>
        <ChannelsManagementPanel />
      </div>
    </section>
  );
}

function MobileSoftwareUpdateSection({ model }: { model: SettingsPageModel }) {
  return (
    <>
      <section className="settings-mobile-group-section">
        <h2 className="settings-mobile-group-title">{t("settings.softwareUpdate")}</h2>
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
        <div className="settings-mobile-panel-shell settings-mobile-update-shell">
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
            <SettingsSwitch
              checked={model.runtimeConfig.autoCheckUpdate}
              label={t("settings.autoCheckUpdate")}
              onChange={model.updateAutoCheckUpdate}
            />
            </div>
          </div>
          <div className="settings-mobile-panel-shell settings-mobile-update-shell">
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

function SettingsSwitch({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className="settings-mobile-switch"
      aria-label={label}
      onClick={(event) => {
        if (event.target instanceof HTMLInputElement) {
          return;
        }

        event.preventDefault();
        // 不再把可点击性赌在隐藏 input 的默认行为上，直接让可见开关自己负责切换。
        onChange(!checked);
      }}
    >
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
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

function ModelManagementSectionIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="3.5" y="4" width="13" height="12" rx="2.5" />
      <path d="M6.2 8.1h7.6M6.2 11.9h4.1" strokeLinecap="round" />
      <path d="m12.8 11.3 1.3 1.3 2-2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProviderManagementSectionIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 5.5h7" />
      <path d="M4 10h12" />
      <path d="M4 14.5h9" />
      <circle cx="13.5" cy="5.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="8" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="14.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ChannelsManagementSectionIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M5 5.5h4.5" />
      <path d="M10.5 5.5h4.5" />
      <path d="M5 10h3.5" />
      <path d="M11.5 10H15" />
      <path d="M5 14.5h4.5" />
      <path d="M10.5 14.5h4.5" />
      <circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none" />
      <path d="m8.9 8.9-1.8-1.8M11.1 8.9l1.8-1.8M8.9 11.1l-1.8 1.8M11.1 11.1l1.8 1.8" />
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
