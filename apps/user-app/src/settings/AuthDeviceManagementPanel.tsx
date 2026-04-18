import { type ReactNode, useEffect, useState } from "react";
import type { IconType } from "react-icons";
import {
  MdDesktopWindows,
  MdHelpOutline,
  MdLanguage,
  MdOutlinePhoneIphone
} from "react-icons/md";
import {
  SiAndroid,
} from "react-icons/si";

import { WorkbenchModal } from "../features/conversation/components/WorkbenchModal";
import { useAuthSelector } from "../features/auth/store/auth-store";
import type {
  AuthClientType,
  AuthDeviceManagementSnapshotDto,
  AuthDeviceViewDto,
  RecentLoginRecordViewDto
} from "../features/settings/api/auth-device-api";
import {
  fetchAuthDeviceManagementSnapshot,
  logoutDevice,
  updateCurrentDevicePrimary
} from "../features/settings/api/auth-device-api";
import { t } from "../shared/i18n";
import { ApiError } from "../shared/network/api-error";

type PrimaryIntent = "enable" | "disable" | null;

export function AuthDeviceManagementPanel({ compact = false }: { compact?: boolean }) {
  const accessToken = useAuthSelector((state) => state.session?.accessToken ?? null);
  const [snapshot, setSnapshot] = useState<AuthDeviceManagementSnapshotDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [showLegacyCompatibility, setShowLegacyCompatibility] = useState(false);
  const [pendingAction, setPendingAction] = useState<"reload" | "primary" | null>(null);
  const [pendingLogoutDeviceId, setPendingLogoutDeviceId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [primaryIntent, setPrimaryIntent] = useState<PrimaryIntent>(null);
  const [password, setPassword] = useState("");
  const [primaryActionError, setPrimaryActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!managementOpen) {
      setLoading(false);
      return;
    }

    if (!accessToken) {
      setSnapshot(null);
      setLoading(false);
      setStatusText(null);
      setPanelError(null);
      return;
    }

    const load = async () => {
      setLoading(true);

      try {
        const nextSnapshot = await fetchAuthDeviceManagementSnapshot();

        if (!active) {
          return;
        }

        setSnapshot(nextSnapshot);
        setPanelError(null);
      } catch (error) {
        if (!active) {
          return;
        }

        setPanelError(resolveDevicePanelError(error));
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
  }, [accessToken, managementOpen]);

  async function reloadSnapshot(): Promise<void> {
    const nextSnapshot = await fetchAuthDeviceManagementSnapshot();
    setSnapshot(nextSnapshot);
    setPanelError(null);
  }

  function openManagementModal(): void {
    setManagementOpen(true);
    setShowLegacyCompatibility(false);
    setStatusText(null);
    setPanelError(null);
  }

  function closeManagementModal(): void {
    if (pendingAction === "primary") {
      return;
    }

    setManagementOpen(false);
    setShowLegacyCompatibility(false);
    setPrimaryIntent(null);
    setPassword("");
    setPrimaryActionError(null);
  }

  function openPrimaryModal(intent: PrimaryIntent): void {
    setPrimaryIntent(intent);
    setPassword("");
    setPrimaryActionError(null);
  }

  async function handlePrimarySubmit(): Promise<void> {
    if (!primaryIntent) {
      return;
    }

    setPendingAction("primary");
    setPrimaryActionError(null);
    setPanelError(null);
    setStatusText(null);

    try {
      await updateCurrentDevicePrimary({
        password,
        primary: primaryIntent === "enable"
      });
      await reloadSnapshot();
      setStatusText(
        primaryIntent === "enable"
          ? t("settings.authDevicePrimaryEnabled")
          : t("settings.authDevicePrimaryDisabled")
      );
      setPrimaryIntent(null);
      setPassword("");
    } catch (error) {
      const message = resolveDevicePanelError(error);
      setPrimaryActionError(message);
      setPanelError(message);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleLogoutDevice(device: AuthDeviceViewDto): Promise<void> {
    if (!device.deviceId) {
      return;
    }

    setPendingLogoutDeviceId(device.deviceId);
    setPanelError(null);
    setStatusText(null);

    try {
      const result = await logoutDevice(device.deviceId);
      await reloadSnapshot();
      setStatusText(
        t("settings.authDeviceLogoutDeviceSuccess", {
          device: getDeviceTitle(device),
          count: String(result.revokedSessionCount)
        })
      );
    } catch (error) {
      setPanelError(resolveDevicePanelError(error));
    } finally {
      setPendingLogoutDeviceId(null);
    }
  }

  const currentDevice = snapshot?.currentDevice ?? null;
  const visibleOtherDevices = snapshot?.otherActiveDevices.filter((device) => !device.isLegacy) ?? [];
  const legacyOtherDevices = snapshot?.otherActiveDevices.filter((device) => device.isLegacy) ?? [];
  const visibleRecentLoginRecords = snapshot?.recentLoginRecords.filter((record) => !record.isLegacy) ?? [];
  const legacyRecentLoginRecords = snapshot?.recentLoginRecords.filter((record) => record.isLegacy) ?? [];
  const hiddenLegacyCount = legacyOtherDevices.length + legacyRecentLoginRecords.length;
  const canManagePrimary = currentDevice !== null && !currentDevice.isLegacy;
  const canLogoutDevices = currentDevice?.isPrimary === true;

  return (
    <>
      <div className={`settings-device-panel${compact ? " settings-device-panel-compact" : ""}`}>
        <div className="settings-device-entry-actions">
          <button
            className="settings-button"
            type="button"
            disabled={!accessToken}
            onClick={openManagementModal}
          >
            {t("settings.authDeviceOpenManager")}
          </button>
        </div>
      </div>

      <WorkbenchModal
        open={managementOpen}
        title={t("settings.authDeviceManagement")}
        description={t("settings.authDeviceManagementDescription")}
        className="settings-device-browser-modal"
        onClose={closeManagementModal}
      >
        <>
          {statusText ? <p className="settings-release-status">{statusText}</p> : null}
          {panelError ? <p className="settings-release-status">{panelError}</p> : null}

          {loading ? (
            <div className="settings-device-empty">{t("common.loading")}</div>
          ) : (
            <>
              {hiddenLegacyCount > 0 ? (
                <section className="settings-device-section">
                  <div className="settings-device-compat-banner">
                    <p className="settings-device-inline-note">
                      {t("settings.authDeviceLegacyHiddenHint", {
                        count: String(hiddenLegacyCount)
                      })}
                    </p>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setShowLegacyCompatibility((current) => !current)}
                    >
                      {showLegacyCompatibility
                        ? t("settings.authDeviceLegacyHide")
                        : t("settings.authDeviceLegacyReveal")}
                    </button>
                  </div>
                </section>
              ) : null}

              <section className="settings-device-section">
                <div className="settings-device-section-header">
                  <strong>{t("settings.authDeviceCurrentTitle")}</strong>
                </div>

                {currentDevice ? (
                  <DeviceCard
                    current
                    title={getDeviceTitle(currentDevice)}
                    clientType={currentDevice.clientType}
                    browserName={currentDevice.browserName}
                    browserVersion={currentDevice.browserVersion}
                    osName={currentDevice.osName}
                    osVersion={currentDevice.osVersion}
                    timeLabelKey="settings.authDeviceLastSeen"
                    timestamp={currentDevice.lastSeenAt}
                    sourceAddress={currentDevice.lastSourceAddress}
                    badges={(
                      <>
                        <span className="settings-device-tag" data-tone="current">
                          {t("settings.authDeviceCurrentTag")}
                        </span>
                        {currentDevice.isPrimary ? (
                          <span className="settings-device-tag" data-tone="primary">
                            {t("settings.authDevicePrimaryTag")}
                          </span>
                        ) : null}
                      </>
                    )}
                    actions={(
                      <>
                        <button
                          className="secondary-button"
                          data-variant="device-neutral"
                          type="button"
                          disabled={!canManagePrimary || pendingAction !== null}
                          onClick={() => openPrimaryModal(currentDevice.isPrimary ? "disable" : "enable")}
                        >
                          {currentDevice.isPrimary
                            ? t("settings.authDeviceDisablePrimary")
                            : t("settings.authDeviceEnablePrimary")}
                        </button>
                      </>
                    )}
                    note={!canManagePrimary ? t("settings.authDevicePrimaryUnavailable") : null}
                  />
                ) : (
                  <div className="settings-device-empty">{t("settings.authDeviceCurrentEmpty")}</div>
                )}
              </section>

              <section className="settings-device-section">
                <div className="settings-device-section-header">
                  <strong>{t("settings.authDeviceOthersTitle")}</strong>
                </div>

                {visibleOtherDevices.length > 0 ? (
                  <div className="settings-device-list">
                    {visibleOtherDevices.map((device, index) => (
                      <DeviceCard
                        key={`${device.deviceId ?? "legacy"}-${device.lastSeenAt}-${index}`}
                        title={getDeviceTitle(device)}
                        clientType={device.clientType}
                        browserName={device.browserName}
                        browserVersion={device.browserVersion}
                        osName={device.osName}
                        osVersion={device.osVersion}
                        timeLabelKey="settings.authDeviceLastSeen"
                        timestamp={device.lastSeenAt}
                        sourceAddress={device.lastSourceAddress}
                        badges={(
                          <>
                            {device.isPrimary ? (
                              <span className="settings-device-tag" data-tone="primary">
                                {t("settings.authDevicePrimaryTag")}
                              </span>
                            ) : null}
                            {device.isLegacy ? (
                              <span className="settings-device-tag" data-tone="legacy">
                                {t("settings.authDeviceLegacyTag")}
                              </span>
                            ) : null}
                          </>
                        )}
                        actions={device.deviceId ? (
                          <button
                            className="settings-button settings-button-danger"
                            data-variant="device-danger"
                            type="button"
                            disabled={!canLogoutDevices || pendingAction !== null || pendingLogoutDeviceId !== null}
                            onClick={() => {
                              void handleLogoutDevice(device);
                            }}
                          >
                            {pendingLogoutDeviceId === device.deviceId
                              ? t("common.loading")
                              : t("settings.authDeviceLogoutDevice")}
                          </button>
                        ) : null}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="settings-device-empty">{t("settings.authDeviceOthersEmpty")}</div>
                )}
              </section>

              <section className="settings-device-section">
                <div className="settings-device-section-header">
                  <strong>{t("settings.authDeviceRecentTitle")}</strong>
                </div>

                {visibleRecentLoginRecords.length > 0 ? (
                  <div className="settings-device-list">
                    {visibleRecentLoginRecords.map((record) => (
                      <DeviceCard
                        key={record.id}
                        title={getRecentRecordTitle(record)}
                        clientType={record.clientType}
                        browserName={record.browserName}
                        browserVersion={record.browserVersion}
                        osName={record.osName}
                        osVersion={record.osVersion}
                        timeLabelKey="settings.authDeviceLoginAt"
                        timestamp={record.occurredAt}
                        sourceAddress={record.sourceAddress}
                        badges={record.isCurrentDevice ? (
                          <span className="settings-device-tag" data-tone="current">
                            {t("settings.authDeviceCurrentTag")}
                          </span>
                        ) : null}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="settings-device-empty">{t("settings.authDeviceRecentEmpty")}</div>
                )}
              </section>

              {showLegacyCompatibility && legacyOtherDevices.length > 0 ? (
                <section className="settings-device-section">
                  <div className="settings-device-section-header">
                    <strong>{t("settings.authDeviceLegacyDevicesTitle")}</strong>
                  </div>

                  <div className="settings-device-list">
                    {legacyOtherDevices.map((device, index) => (
                      <DeviceCard
                        key={`legacy-device-${device.lastSeenAt}-${index}`}
                        title={getDeviceTitle(device)}
                        clientType={device.clientType}
                        browserName={device.browserName}
                        browserVersion={device.browserVersion}
                        osName={device.osName}
                        osVersion={device.osVersion}
                        timeLabelKey="settings.authDeviceLastSeen"
                        timestamp={device.lastSeenAt}
                        sourceAddress={device.lastSourceAddress}
                        badges={(
                          <span className="settings-device-tag" data-tone="legacy">
                            {t("settings.authDeviceLegacyTag")}
                          </span>
                        )}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {showLegacyCompatibility && legacyRecentLoginRecords.length > 0 ? (
                <section className="settings-device-section">
                  <div className="settings-device-section-header">
                    <strong>{t("settings.authDeviceLegacyRecentTitle")}</strong>
                  </div>

                  <div className="settings-device-list">
                    {legacyRecentLoginRecords.map((record) => (
                      <DeviceCard
                        key={record.id}
                        title={getRecentRecordTitle(record)}
                        clientType={record.clientType}
                        browserName={record.browserName}
                        browserVersion={record.browserVersion}
                        osName={record.osName}
                        osVersion={record.osVersion}
                        timeLabelKey="settings.authDeviceLoginAt"
                        timestamp={record.occurredAt}
                        sourceAddress={record.sourceAddress}
                        badges={(
                          <span className="settings-device-tag" data-tone="legacy">
                            {t("settings.authDeviceLegacyTag")}
                          </span>
                        )}
                      />
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </>
      </WorkbenchModal>

      <WorkbenchModal
        open={primaryIntent !== null}
        title={
          primaryIntent === "enable"
            ? t("settings.authDeviceEnablePrimaryModalTitle")
            : t("settings.authDeviceDisablePrimaryModalTitle")
        }
        description={
          primaryIntent === "enable"
            ? t("settings.authDeviceEnablePrimaryModalDescription")
            : t("settings.authDeviceDisablePrimaryModalDescription")
        }
        className="settings-device-modal"
        onClose={() => {
          if (pendingAction === "primary") {
            return;
          }

          setPrimaryIntent(null);
          setPassword("");
          setPrimaryActionError(null);
        }}
      >
        <div className="settings-device-modal-body">
          <label className="settings-device-password-field">
            <span>{t("settings.authDevicePasswordLabel")}</span>
            <input
              type="password"
              className="settings-text-input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {primaryActionError ? <p className="settings-release-status">{primaryActionError}</p> : null}
          <div className="settings-device-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={pendingAction === "primary"}
              onClick={() => {
                setPrimaryIntent(null);
                setPassword("");
                setPrimaryActionError(null);
              }}
            >
              {t("common.cancel")}
            </button>
            <button
              className="settings-button"
              type="button"
              disabled={password.trim().length === 0 || pendingAction === "primary"}
              onClick={() => {
                void handlePrimarySubmit();
              }}
            >
              {pendingAction === "primary"
                ? t("common.loading")
                : primaryIntent === "enable"
                  ? t("settings.authDeviceEnablePrimary")
                  : t("settings.authDeviceDisablePrimary")}
            </button>
          </div>
        </div>
      </WorkbenchModal>
    </>
  );
}

function getDeviceTitle(device: AuthDeviceViewDto): string {
  if (device.isLegacy) {
    return t("settings.authDeviceLegacyLabel");
  }

  return device.displayName?.trim() || getClientTypeLabel(device.clientType);
}

function getRecentRecordTitle(record: RecentLoginRecordViewDto): string {
  if (record.isLegacy) {
    return t("settings.authDeviceLegacyLabel");
  }

  return record.displayName?.trim() || getClientTypeLabel(record.clientType);
}

function DeviceIdentity(props: {
  title: string;
  clientType: AuthClientType;
}) {
  return (
    <div className="settings-device-identity">
      <span className="settings-device-identity-icon" aria-hidden="true">
        <DeviceIcon kind={getClientIconKind(props.clientType)} />
      </span>
      <div className="settings-device-identity-body">
        <strong>{props.title}</strong>
      </div>
    </div>
  );
}

function DeviceCard(props: {
  title: string;
  clientType: AuthClientType;
  browserName: string | null;
  browserVersion: string | null;
  osName: string | null;
  osVersion: string | null;
  timeLabelKey: string;
  timestamp: string;
  sourceAddress: string | null;
  badges?: ReactNode;
  actions?: ReactNode;
  note?: string | null;
  current?: boolean;
}) {
  const metaItems = buildDeviceMetaItems(
    props.browserName,
    props.browserVersion,
    props.osName,
    props.osVersion,
    props.timeLabelKey,
    props.timestamp,
    props.sourceAddress
  );

  return (
    <article className="settings-device-item" data-current={props.current ? "true" : undefined}>
      <div className="settings-device-item-main">
        <div className="settings-device-item-content">
          <DeviceIdentity title={props.title} clientType={props.clientType} />
          <div className="settings-device-meta">
            {metaItems.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          {props.note ? <p className="settings-device-inline-note">{props.note}</p> : null}
        </div>
        {(props.badges || props.actions) ? (
          <div className="settings-device-item-controls">
            {props.badges ? <div className="settings-device-badges">{props.badges}</div> : null}
            {props.actions ? <div className="settings-device-actions">{props.actions}</div> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function getClientTypeLabel(clientType: AuthClientType): string {
  switch (clientType) {
    case "desktop":
      return t("settings.authDeviceClientDesktop");
    case "web":
      return t("settings.authDeviceClientWeb");
    case "ios":
      return t("settings.authDeviceClientIos");
    case "android":
      return t("settings.authDeviceClientAndroid");
    default:
      return t("settings.authDeviceClientUnknown");
  }
}

function formatDeviceMeta(labelKey: string, timestamp: string): string {
  return t(labelKey, {
    value: new Date(timestamp).toLocaleString()
  });
}

function formatDeviceAddress(sourceAddress: string | null): string {
  return sourceAddress
    ? t("settings.authDeviceSourceAddressValue", {
        value: sourceAddress
      })
    : t("settings.authDeviceSourceAddressUnknown");
}

function formatDeviceBrowser(browserName: string | null, browserVersion: string | null): string | null {
  if (!browserName) {
    return null;
  }

  return t("settings.authDeviceBrowserValue", {
    value: formatNameWithVersion(browserName, browserVersion)
  });
}

function formatDeviceOs(osName: string | null, osVersion: string | null): string | null {
  if (!osName) {
    return null;
  }

  return t("settings.authDeviceOsValue", {
    value: formatNameWithVersion(osName, osVersion)
  });
}

function buildDeviceMetaItems(
  browserName: string | null,
  browserVersion: string | null,
  osName: string | null,
  osVersion: string | null,
  timeLabelKey: string,
  timestamp: string,
  sourceAddress: string | null
): string[] {
  return [
    formatDeviceBrowser(browserName, browserVersion),
    formatDeviceOs(osName, osVersion),
    formatDeviceMeta(timeLabelKey, timestamp),
    formatDeviceAddress(sourceAddress)
  ].filter((item): item is string => Boolean(item));
}

type DeviceIconKind =
  | "desktop"
  | "web"
  | "ios"
  | "android"
  | "unknown";

function getClientIconKind(clientType: AuthClientType): DeviceIconKind {
  switch (clientType) {
    case "desktop":
      return "desktop";
    case "web":
      return "web";
    case "ios":
      return "ios";
    case "android":
      return "android";
    default:
      return "unknown";
  }
}

function formatNameWithVersion(name: string, version: string | null): string {
  return version?.trim() ? `${name} ${version}` : name;
}

function DeviceIcon({ kind }: { kind: DeviceIconKind }) {
  const iconDefinition = getDeviceIconDefinition(kind);
  const Icon = iconDefinition.icon;

  return <Icon color={iconDefinition.color} />;
}

function getDeviceIconDefinition(kind: DeviceIconKind): {
  icon: IconType;
  color: string;
} {
  switch (kind) {
    case "desktop":
      return {
        icon: MdDesktopWindows,
        color: "#2563eb"
      };
    case "web":
      return {
        icon: MdLanguage,
        color: "#0f766e"
      };
    case "ios":
      return {
        icon: MdOutlinePhoneIphone,
        color: "#111827"
      };
    case "android":
      return {
        icon: SiAndroid,
        color: "#3ddc84"
      };
    case "unknown":
      return {
        icon: MdHelpOutline,
        color: "#64748b"
      };
    default:
      return {
        icon: MdHelpOutline,
        color: "#64748b"
      };
  }
}

function resolveDevicePanelError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return t("settings.authDeviceLoadFailed");
}
