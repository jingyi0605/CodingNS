import { useEffect, useState } from "react";

import { DesktopModal } from "../components/DesktopModal";
import { MobileSheet } from "../components/MobileSheet";
import { ModalActions, ModalEmptyState, ModalSection, ModalTag } from "../components/ModalAtoms";
import type { ProviderCatalogEntryDto } from "../features/conversation/api/conversation-api";
import {
  listProviderCatalog,
  updateProviderCatalogEntry
} from "../features/conversation/api/conversation-api";
import { useAuthSelector } from "../features/auth/store/auth-store";
import { clearSessionProviderPickerCapabilityCache } from "../features/conversation/components/SessionProviderPicker";
import { usePlatform } from "../platform/platform-provider";
import { t } from "../shared/i18n";
import { ApiError } from "../shared/network/api-error";

type ProductCapabilityKey =
  | "streamingOutput"
  | "toolCalls"
  | "assistantService"
  | "sessionFork"
  | "skillUsage";

const PRODUCT_CAPABILITY_COLUMNS: Array<{
  key: ProductCapabilityKey;
  labelKey:
    | "settings.providerManagementCapabilityStreaming"
    | "settings.providerManagementCapabilityToolCalls"
    | "settings.providerManagementCapabilityAssistant"
    | "settings.providerManagementCapabilityFork"
    | "settings.providerManagementCapabilitySkill";
}> = [
  {
    key: "streamingOutput",
    labelKey: "settings.providerManagementCapabilityStreaming"
  },
  {
    key: "toolCalls",
    labelKey: "settings.providerManagementCapabilityToolCalls"
  },
  {
    key: "assistantService",
    labelKey: "settings.providerManagementCapabilityAssistant"
  },
  {
    key: "sessionFork",
    labelKey: "settings.providerManagementCapabilityFork"
  },
  {
    key: "skillUsage",
    labelKey: "settings.providerManagementCapabilitySkill"
  }
];

export function ProviderManagementPanel() {
  const platform = usePlatform();
  const accessToken = useAuthSelector((state) => state.session?.accessToken ?? null);
  const [modalOpen, setModalOpen] = useState(false);
  const [items, setItems] = useState<ProviderCatalogEntryDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const capabilityColumns = PRODUCT_CAPABILITY_COLUMNS.map((column) => ({
    ...column,
    label: t(column.labelKey)
  }));

  useEffect(() => {
    if (accessToken) {
      return;
    }

    setModalOpen(false);
    setItems(null);
    setLoading(false);
    setPendingProvider(null);
    setStatusText(null);
    setPanelError(null);
  }, [accessToken]);

  async function loadCatalog(options: { showRefreshSuccess?: boolean } = {}): Promise<void> {
    if (!accessToken) {
      return;
    }

    setLoading(true);
    setPanelError(null);

    try {
      const nextItems = await listProviderCatalog();
      setItems(nextItems);

      if (options.showRefreshSuccess) {
        setStatusText(t("settings.providerManagementRefreshSuccess"));
      }
    } catch (error) {
      setPanelError(resolveProviderManagementError(error, "load"));
    } finally {
      setLoading(false);
    }
  }

  function handleOpen(): void {
    setModalOpen(true);
    setStatusText(null);
    setPanelError(null);

    if (accessToken) {
      void loadCatalog();
    }
  }

  async function handleToggle(entry: ProviderCatalogEntryDto): Promise<void> {
    if (!accessToken) {
      return;
    }

    const nextEnabled = !entry.enabled;
    setPendingProvider(entry.provider);
    setPanelError(null);
    setStatusText(null);

    try {
      const nextEntry = await updateProviderCatalogEntry(entry.provider, nextEnabled);
      clearSessionProviderPickerCapabilityCache();
      setItems((current) => replaceProviderEntry(current, nextEntry));
      setStatusText(
        nextEnabled
          ? t("settings.providerManagementEnableSuccess", { provider: entry.displayName })
          : t("settings.providerManagementDisableSuccess", { provider: entry.displayName })
      );
    } catch (error) {
      setPanelError(resolveProviderManagementError(error, "save"));
    } finally {
      setPendingProvider(null);
    }
  }

  const providerItems = items ?? [];
  const enabledCount = providerItems.filter((item) => item.enabled).length;
  const disabledCount = providerItems.filter((item) => !item.enabled).length;
  const modalBody = (
    <div className="settings-provider-modal-layout">
      {statusText ? <p className="settings-provider-status">{statusText}</p> : null}
      {panelError ? <p className="settings-provider-error">{panelError}</p> : null}

      <ModalSection
        heading={t("settings.providerManagementSummaryTitle")}
        description={t("settings.providerManagementSummaryDescription")}
        className="settings-provider-modal-section"
      >
        <div className="settings-provider-summary-grid">
          <SummaryCard
            label={t("settings.providerManagementSummaryEnabled")}
            value={String(enabledCount)}
          />
          <SummaryCard
            label={t("settings.providerManagementSummaryDisabled")}
            value={String(disabledCount)}
          />
          <SummaryCard
            label={t("settings.providerManagementSummaryTotal")}
            value={String(providerItems.length)}
          />
        </div>
      </ModalSection>

      <ModalSection
        heading={t("settings.providerManagementMatrixTitle")}
        description={t("settings.providerManagementMatrixDescription")}
        className="settings-provider-modal-section"
      >
        {loading && providerItems.length === 0 ? (
          <ModalEmptyState
            compact
            title={t("settings.providerManagementLoading")}
          />
        ) : null}

        {!loading && providerItems.length === 0 ? (
          <ModalEmptyState
            title={t("settings.providerManagementEmpty")}
            description={t("settings.providerManagementEmptyDescription")}
            action={(
              <button
                type="button"
                className="secondary-button"
                disabled={!accessToken}
                onClick={() => {
                  void loadCatalog();
                }}
              >
                {t("settings.providerManagementRefresh")}
              </button>
            )}
          />
        ) : null}

        {providerItems.length > 0 ? (
          <div className="settings-provider-matrix-shell">
            <table className="settings-provider-matrix-table">
              <colgroup>
                <col className="settings-provider-matrix-provider-col" />
                {capabilityColumns.map((column) => (
                  <col key={column.key} className="settings-provider-matrix-capability-col" />
                ))}
                <col className="settings-provider-matrix-status-col" />
                <col className="settings-provider-matrix-toggle-col" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">{t("settings.providerManagementTableProvider")}</th>
                  {capabilityColumns.map((column) => (
                    <th key={column.key} scope="col">
                      {column.label}
                    </th>
                  ))}
                  <th scope="col">{t("settings.providerManagementTableStatus")}</th>
                  <th scope="col">{t("settings.providerManagementTableEnabled")}</th>
                </tr>
              </thead>
              <tbody>
                {providerItems.map((entry) => (
                  <tr key={entry.provider}>
                    <th scope="row" className="settings-provider-matrix-provider-cell">
                      <div className="settings-provider-matrix-provider">
                        <div className="settings-provider-matrix-provider-heading">
                          <strong className="settings-provider-matrix-provider-name">
                            {entry.displayName}
                          </strong>
                          <ModalTag tone={resolveInstallTone(entry.installState)}>
                            {resolveProviderVersionLabel(entry)}
                          </ModalTag>
                        </div>
                      </div>
                    </th>
                    {capabilityColumns.map((column) => (
                      <td key={column.key} className="settings-provider-matrix-capability-cell">
                        <CapabilityCell
                          enabled={entry.productCapabilities[column.key]}
                          label={column.label}
                        />
                      </td>
                    ))}
                    <td className="settings-provider-matrix-status-cell">
                      <ModalTag tone={entry.enabled ? "success" : "default"}>
                        {entry.enabled
                          ? t("settings.providerManagementStatusEnabled")
                          : t("settings.providerManagementStatusDisabled")}
                      </ModalTag>
                    </td>
                    <td className="settings-provider-matrix-toggle-cell">
                      <label className="settings-provider-matrix-switch">
                        <span className="settings-provider-visually-hidden">
                          {t("settings.providerManagementToggleLabel", {
                            provider: entry.displayName
                          })}
                        </span>
                        <input
                          type="checkbox"
                          checked={entry.enabled}
                          disabled={pendingProvider === entry.provider}
                          aria-label={t("settings.providerManagementToggleLabel", {
                            provider: entry.displayName
                          })}
                          onChange={() => {
                            void handleToggle(entry);
                          }}
                        />
                        <span className="settings-provider-matrix-switch-track" aria-hidden="true">
                          <span className="settings-provider-matrix-switch-thumb" />
                        </span>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </ModalSection>

      <ModalActions className="settings-provider-modal-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={!accessToken || loading || pendingProvider !== null}
          onClick={() => {
            void loadCatalog({ showRefreshSuccess: true });
          }}
        >
          {loading ? t("common.loading") : t("settings.providerManagementRefresh")}
        </button>
      </ModalActions>
    </div>
  );

  return (
    <>
      <div className="settings-provider-entrypoint">
        {!accessToken ? (
          <p className="settings-provider-entrypoint-note">
            {t("settings.providerManagementLoginRequired")}
          </p>
        ) : null}
        <button
          type="button"
          className="settings-button"
          disabled={!accessToken}
          onClick={handleOpen}
        >
          {t("settings.providerManagementManageAction")}
        </button>
      </div>

      {platform.isMobile ? (
        <MobileSheet
          open={modalOpen}
          title={t("settings.providerManagementModalTitle")}
          description={t("settings.providerManagementModalDescription")}
          height="three-quarter"
          kind="form"
          showHandle
          bodyClassName="settings-provider-modal-body"
          onClose={() => setModalOpen(false)}
        >
          {modalBody}
        </MobileSheet>
      ) : (
        <DesktopModal
          open={modalOpen}
          title={t("settings.providerManagementModalTitle")}
          description={t("settings.providerManagementModalDescription")}
          size="xwide"
          layout="list"
          bodyClassName="settings-provider-modal-body"
          onClose={() => setModalOpen(false)}
        >
          {modalBody}
        </DesktopModal>
      )}
    </>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-provider-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CapabilityCell({ enabled, label }: { enabled: boolean; label: string }) {
  const statusLabel = enabled
    ? t("settings.providerManagementCapabilityAvailable")
    : t("settings.providerManagementCapabilityUnavailable");

  if (!enabled) {
    return <span className="settings-provider-visually-hidden">{`${label}：${statusLabel}`}</span>;
  }

  return (
    <span
      className="settings-provider-matrix-capability"
      aria-label={`${label}：${statusLabel}`}
      role="img"
    >
      <span className="settings-provider-matrix-capability-check" aria-hidden="true" />
    </span>
  );
}

function replaceProviderEntry(
  current: ProviderCatalogEntryDto[] | null,
  nextEntry: ProviderCatalogEntryDto
): ProviderCatalogEntryDto[] {
  if (!current || current.length === 0) {
    return [nextEntry];
  }

  const nextItems = current.map((entry) => entry.provider === nextEntry.provider ? nextEntry : entry);

  if (nextItems.some((entry) => entry.provider === nextEntry.provider)) {
    return nextItems;
  }

  return [...nextItems, nextEntry];
}

function resolveInstallLabel(installState: ProviderCatalogEntryDto["installState"]): string {
  switch (installState) {
    case "ready":
      return t("settings.providerManagementInstallReady");
    case "missing":
      return t("settings.providerManagementInstallMissing");
    default:
      return t("settings.providerManagementInstallUnknown");
  }
}

function resolveProviderVersionLabel(entry: ProviderCatalogEntryDto): string {
  if (entry.installState === "ready" && entry.version) {
    return entry.version;
  }

  return resolveInstallLabel(entry.installState);
}

function resolveInstallTone(
  installState: ProviderCatalogEntryDto["installState"]
): "default" | "success" | "warning" {
  switch (installState) {
    case "ready":
      return "success";
    case "missing":
      return "warning";
    default:
      return "default";
  }
}

function resolveProviderManagementError(error: unknown, type: "load" | "save"): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return type === "save"
    ? t("settings.providerManagementSaveFailed")
    : t("settings.providerManagementLoadFailed");
}
