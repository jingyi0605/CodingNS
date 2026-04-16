import { useEffect, useState } from "react";

import { useAuthSelector } from "../features/auth/store/auth-store";
import { clearSessionProviderPickerCapabilityCache } from "../features/conversation/components/SessionProviderPicker";
import { WorkbenchModal } from "../features/conversation/components/WorkbenchModal";
import type {
  ModelManagementAppSnapshotDto,
  ModelManagementSnapshotDto,
  ModelPresetOptionDto,
  ModelSwitchAppId,
  ModelSwitchAppStatus
} from "../features/settings/api/model-switch-api";
import {
  fetchModelManagementSnapshot,
  switchModelPreset
} from "../features/settings/api/model-switch-api";
import { t } from "../shared/i18n";
import { ApiError } from "../shared/network/api-error";

type PendingActionKey = string | null;
const URL_PATTERN = /(https?:\/\/[^\s]+)/i;

export function ModelManagementPanel() {
  const accessToken = useAuthSelector((state) => state.session?.accessToken ?? null);
  const [snapshot, setSnapshot] = useState<ModelManagementSnapshotDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingActionKey, setPendingActionKey] = useState<PendingActionKey>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeApp, setActiveApp] = useState<ModelSwitchAppId>("codex");

  useEffect(() => {
    let active = true;

    if (!accessToken) {
      setSnapshot(null);
      setPanelError(null);
      setStatusText(null);
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);

      try {
        const nextSnapshot = await fetchModelManagementSnapshot();

        if (!active) {
          return;
        }

        setSnapshot(nextSnapshot);
        setPanelError(null);
        setActiveApp((current) => resolveNextActiveApp(nextSnapshot, current));
      } catch (error) {
        if (!active) {
          return;
        }

        setPanelError(resolveModelPanelError(error));
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
  }, [accessToken]);

  async function reloadSnapshot(): Promise<void> {
    const nextSnapshot = await fetchModelManagementSnapshot();
    setSnapshot(nextSnapshot);
    setPanelError(null);
    setActiveApp((current) => resolveNextActiveApp(nextSnapshot, current));
  }

  async function handleRefresh(): Promise<void> {
    if (!accessToken) {
      return;
    }

    setPendingActionKey("refresh");
    setPanelError(null);
    setStatusText(null);

    try {
      await reloadSnapshot();
      setStatusText(t("settings.modelManagementRefreshSuccess"));
    } catch (error) {
      setPanelError(resolveModelPanelError(error));
    } finally {
      setPendingActionKey(null);
    }
  }

  async function handleSwitch(app: ModelSwitchAppId, option: ModelPresetOptionDto): Promise<void> {
    if (!accessToken || option.isCurrent) {
      return;
    }

    const actionKey = buildSwitchActionKey(app, option.id);
    setPendingActionKey(actionKey);
    setPanelError(null);
    setStatusText(null);

    try {
      const nextItem = await switchModelPreset({
        app,
        presetId: option.id
      });

      clearSessionProviderPickerCapabilityCache();
      setSnapshot((current) => replaceSnapshotItem(current, nextItem));
      setStatusText(
        t("settings.modelManagementSwitchSuccess", {
          app: nextItem.displayName,
          preset: nextItem.currentPresetName ?? option.name
        })
      );
    } catch (error) {
      setPanelError(resolveModelPanelError(error));
    } finally {
      setPendingActionKey(null);
    }
  }

  const items = snapshot?.items ?? [];
  const activeItem = items.find((item) => item.app === activeApp) ?? items[0] ?? null;
  const missingCliNotice = resolveMissingCcSwitchCliNotice(items);

  return (
    <>
      <div className="settings-model-panel">
        <div className="settings-release-card">
          {statusText ? <p className="settings-release-status">{statusText}</p> : null}
          {panelError ? <p className="settings-release-status">{panelError}</p> : null}

          {missingCliNotice ? (
            <section className="settings-model-missing-state">
              <p className="settings-model-missing-copy">{missingCliNotice.message}</p>
              <a
                className="settings-tailscale-link settings-model-missing-link"
                href={missingCliNotice.url}
                rel="noreferrer"
                target="_blank"
              >
                {missingCliNotice.url}
              </a>
            </section>
          ) : items.length > 0 ? (
            <>
              <div className="settings-model-grid">
                {items.map((item) => (
                  <section key={item.app} className="settings-model-card">
                    <div className="settings-model-card-main">
                      <div className="settings-model-card-copy">
                        <strong className="settings-model-card-title">{item.displayName}</strong>
                        <span className="settings-model-card-status" data-status={item.status}>
                          {resolveStatusLabel(item.status)}
                        </span>
                      </div>
                      <div className="settings-model-value-line">
                        <strong className="settings-model-preset-value">
                          {item.currentPresetName ?? t("settings.modelManagementPresetMissing")}
                        </strong>
                        <strong className="settings-model-current-value">
                          {item.currentModel ?? t("settings.modelManagementModelUnknown")}
                        </strong>
                      </div>
                    </div>
                    {item.statusText ? (
                      <p className="settings-model-card-note">{item.statusText}</p>
                    ) : null}
                  </section>
                ))}
              </div>

              <div className="settings-model-panel-actions">
                <button
                  className="secondary-button settings-model-open-action"
                  type="button"
                  disabled={!accessToken || loading}
                  onClick={() => {
                    setModalOpen(true);
                  }}
                >
                  {t("settings.modelManagementOpenSwitcher")}
                </button>
              </div>
            </>
          ) : (
            <div className="settings-model-empty">{t("settings.modelManagementOptionsEmpty")}</div>
          )}
        </div>
      </div>

      <WorkbenchModal
        open={modalOpen && !missingCliNotice}
        title={t("settings.modelManagementModalTitle")}
        description={t("settings.modelManagementModalDescription")}
        className="settings-model-modal"
        headerActions={(
          <button
            className="secondary-button"
            type="button"
            disabled={!accessToken || loading || pendingActionKey !== null}
            onClick={() => {
              void handleRefresh();
            }}
          >
            {pendingActionKey === "refresh" ? t("common.loading") : t("settings.modelManagementRefresh")}
          </button>
        )}
        onClose={() => setModalOpen(false)}
      >
        <div className="settings-model-tabs" role="tablist" aria-label={t("settings.modelManagementTabsLabel")}>
          {items.map((item) => {
            const selected = activeItem?.app === item.app;

            return (
              <button
                key={item.app}
                type="button"
                role="tab"
                className="settings-model-tab"
                aria-selected={selected}
                data-active={selected ? "true" : "false"}
                onClick={() => setActiveApp(item.app)}
              >
                {item.displayName}
              </button>
            );
          })}
        </div>

        {activeItem ? (
          <section className="settings-model-modal-panel">
            <div className="settings-model-modal-summary">
              <div className="settings-model-modal-summary-row">
                <span>{t("settings.modelManagementCurrentProfile")}</span>
                <strong>{activeItem.currentPresetName ?? t("settings.modelManagementPresetMissing")}</strong>
              </div>
              <div className="settings-model-modal-summary-row">
                <span>{t("settings.modelManagementCurrentModel")}</span>
                <strong>{activeItem.currentModel ?? t("settings.modelManagementModelUnknown")}</strong>
              </div>
            </div>

            {activeItem.statusText ? (
              <p className="settings-model-modal-note">{activeItem.statusText}</p>
            ) : null}

            {activeItem.options.length > 0 ? (
              <div className="settings-model-switcher-list">
                {activeItem.options.map((option) => {
                  const actionKey = buildSwitchActionKey(activeItem.app, option.id);

                  return (
                    <div
                      key={`${activeItem.app}:${option.id}`}
                      className="settings-model-switcher-item"
                      data-current={option.isCurrent ? "true" : "false"}
                    >
                      <div className="settings-model-switcher-item-main">
                        <strong>{option.name}</strong>
                        <span>{option.model ?? t("settings.modelManagementModelUnknown")}</span>
                      </div>
                      <div className="settings-model-switcher-item-actions">
                        {option.isCurrent ? (
                          <span className="settings-model-card-status" data-status="ready">
                            {t("settings.modelManagementCurrentTag")}
                          </span>
                        ) : (
                          <button
                            className="secondary-button settings-model-option-action"
                            type="button"
                            disabled={loading || pendingActionKey !== null || activeItem.status !== "ready"}
                            onClick={() => {
                              void handleSwitch(activeItem.app, option);
                            }}
                          >
                            {pendingActionKey === actionKey
                              ? t("common.loading")
                              : t("settings.modelManagementSwitchAction")}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="settings-model-empty">
                {activeItem.statusText ?? t("settings.modelManagementOptionsEmpty")}
              </div>
            )}
          </section>
        ) : (
          <div className="settings-model-empty">{t("settings.modelManagementOptionsEmpty")}</div>
        )}
      </WorkbenchModal>
    </>
  );
}

function buildSwitchActionKey(app: ModelSwitchAppId, presetId: string): string {
  return `switch:${app}:${presetId}`;
}

function replaceSnapshotItem(
  snapshot: ModelManagementSnapshotDto | null,
  nextItem: ModelManagementAppSnapshotDto
): ModelManagementSnapshotDto | null {
  if (!snapshot) {
    return snapshot;
  }

  return {
    ...snapshot,
    scannedAt: new Date().toISOString(),
    items: snapshot.items.map((item) => (item.app === nextItem.app ? nextItem : item))
  };
}

function resolveNextActiveApp(
  snapshot: ModelManagementSnapshotDto,
  current: ModelSwitchAppId
): ModelSwitchAppId {
  const currentExists = snapshot.items.some((item) => item.app === current);

  if (currentExists) {
    return current;
  }

  return snapshot.items[0]?.app ?? "codex";
}

function resolveStatusLabel(status: ModelSwitchAppStatus): string {
  switch (status) {
    case "unconfigured":
      return t("settings.modelManagementStatusUnconfigured");
    case "unavailable":
      return t("settings.modelManagementStatusUnavailable");
    case "error":
      return t("settings.modelManagementStatusError");
    default:
      return t("settings.modelManagementStatusReady");
  }
}

function resolveModelPanelError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message || t("settings.modelManagementLoadFailed");
  }

  return error instanceof Error ? error.message : t("settings.modelManagementLoadFailed");
}

function resolveMissingCcSwitchCliNotice(items: ModelManagementAppSnapshotDto[]): {
  message: string;
  url: string;
} | null {
  if (
    items.length === 0
    || !items.every((item) => item.status === "unavailable" && !item.cliAvailable && Boolean(item.statusText))
  ) {
    return null;
  }

  const rawText = items[0]?.statusText?.trim() ?? "";
  const matchedUrl = rawText.match(URL_PATTERN)?.[1] ?? "";

  if (!matchedUrl) {
    return null;
  }

  const message = rawText.replace(matchedUrl, "").trim();

  return {
    message,
    url: matchedUrl
  };
}
