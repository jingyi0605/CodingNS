import { useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  ModalEmptyState,
  ModalList,
  ModalListItem,
  ModalSection,
  ModalTag
} from "../components/ModalAtoms";
import { useAuthSelector } from "../features/auth/store/auth-store";
import type {
  OpenCliCatalogDto,
  OpenCliCatalogEntryDto,
  OpenCliHealthState,
  OpenCliInstallState,
  OpenCliRuntimeAvailability,
  OpenCliSiteGroupDto,
  UpdateOpenCliConfigResultDto
} from "../features/settings/api/opencli-api";
import {
  fetchOpenCliCatalog,
  refreshOpenCliState,
  updateOpenCliConfig
} from "../features/settings/api/opencli-api";
import { WorkbenchModal } from "../features/conversation/components/WorkbenchModal";
import { t } from "../shared/i18n";
import { ApiError } from "../shared/network/api-error";

type OpenCliFilterId =
  | "all"
  | "enabled"
  | "browser"
  | "direct"
  | `strategy:${string}`;

interface OpenCliFilterOption {
  readonly id: OpenCliFilterId;
  readonly label: string;
}

type OpenCliCommandSortId = "status" | "browser" | "name";

interface OpenCliCommandSortOption {
  readonly id: OpenCliCommandSortId;
  readonly label: string;
}

const DEFAULT_OPENCLI_FILTER: OpenCliFilterId = "all";
const DEFAULT_OPENCLI_COMMAND_SORT: OpenCliCommandSortId = "status";

export interface OpenCliManagementToolbarState {
  readonly draftEnabled: boolean;
  readonly enableDisabled: boolean;
  readonly refreshDisabled: boolean;
  readonly detailDisabled: boolean;
  readonly saveDisabled: boolean;
  readonly refreshing: boolean;
  readonly saving: boolean;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly onRefresh: () => void;
  readonly onShowDetails: () => void;
  readonly onSave: () => void;
}

interface OpenCliManagementPanelProps {
  readonly toolbarMode?: "internal" | "external";
  readonly onToolbarStateChange?: (state: OpenCliManagementToolbarState | null) => void;
}

export function OpenCliManagementPanel({
  toolbarMode = "internal",
  onToolbarStateChange
}: OpenCliManagementPanelProps = {}) {
  const accessToken = useAuthSelector((state) => state.session?.accessToken ?? null);
  const [catalog, setCatalog] = useState<OpenCliCatalogDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftCommandIds, setDraftCommandIds] = useState<string[]>([]);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<OpenCliFilterId>(DEFAULT_OPENCLI_FILTER);
  const [commandModalSite, setCommandModalSite] = useState<string | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [commandSearchText, setCommandSearchText] = useState("");
  const [commandSort, setCommandSort] = useState<OpenCliCommandSortId>(DEFAULT_OPENCLI_COMMAND_SORT);

  useEffect(() => {
    let active = true;

    if (!accessToken) {
      setCatalog(null);
      setDraftEnabled(false);
      setDraftCommandIds([]);
      setPanelError(null);
      setStatusText(null);
      setLoading(false);
      setActiveFilter(DEFAULT_OPENCLI_FILTER);
      setCommandModalSite(null);
      setDetailModalOpen(false);
      setCommandSearchText("");
      setCommandSort(DEFAULT_OPENCLI_COMMAND_SORT);
      return;
    }

    const load = async () => {
      setLoading(true);
      setPanelError(null);
      setStatusText(null);

      try {
        const nextCatalog = await refreshOpenCliState();

        if (!active) {
          return;
        }

        applyCatalogState(nextCatalog);
      } catch (error) {
        if (!active) {
          return;
        }

        const refreshError = resolveOpenCliPanelError(error);

        try {
          const fallbackCatalog = await fetchOpenCliCatalog();

          if (!active) {
            return;
          }

          applyCatalogState(fallbackCatalog);
          setPanelError(refreshError);
        } catch (fallbackError) {
          if (!active) {
            return;
          }

          setPanelError(resolveOpenCliPanelError(fallbackError));
        }
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

  const selectedCommandIdSet = useMemo(() => new Set(draftCommandIds), [draftCommandIds]);
  const filterOptions = useMemo(
    () => buildOpenCliFilterOptions(catalog?.entries ?? []),
    [catalog?.entries]
  );
  const commandSortOptions = useMemo(() => buildOpenCliCommandSortOptions(), []);

  useEffect(() => {
    if (!filterOptions.some((option) => option.id === activeFilter)) {
      setActiveFilter(DEFAULT_OPENCLI_FILTER);
    }
  }, [activeFilter, filterOptions]);

  const filteredSiteGroups = useMemo(() => {
    return (catalog?.siteGroups ?? []).filter((siteGroup) =>
      siteGroup.commands.some((command) => matchesOpenCliFilter(command, activeFilter, selectedCommandIdSet))
    );
  }, [activeFilter, catalog?.siteGroups, selectedCommandIdSet]);

  const commandModalSiteGroup = useMemo(() => {
    if (!commandModalSite) {
      return null;
    }

    return filteredSiteGroups.find((siteGroup) => siteGroup.site === commandModalSite) ?? null;
  }, [commandModalSite, filteredSiteGroups]);

  useEffect(() => {
    if (commandModalSite && !commandModalSiteGroup) {
      setCommandModalSite(null);
    }
  }, [commandModalSite, commandModalSiteGroup]);

  useEffect(() => {
    setCommandSearchText("");
    setCommandSort(DEFAULT_OPENCLI_COMMAND_SORT);
  }, [commandModalSite]);

  const visibleModalCommands = useMemo(() => {
    if (!commandModalSiteGroup) {
      return [];
    }

    const normalizedQuery = commandSearchText.trim().toLowerCase();

    return commandModalSiteGroup.commands
      .filter((command) => (
        matchesOpenCliFilter(command, activeFilter, selectedCommandIdSet)
        && matchesOpenCliCommandSearch(command, normalizedQuery)
      ))
      .sort((left, right) => compareOpenCliCommands(left, right, {
        sortId: commandSort,
        selectedCommandIdSet
      }));
  }, [activeFilter, commandModalSiteGroup, commandSearchText, commandSort, selectedCommandIdSet]);

  const isDirty = Boolean(
    catalog
    && (
      catalog.provider.enabled !== draftEnabled
      || catalog.entries.some((entry) => entry.enabled !== selectedCommandIdSet.has(entry.commandId))
    )
  );

  const toolbarState = useMemo<OpenCliManagementToolbarState>(() => ({
    draftEnabled,
    enableDisabled: loading || refreshing || saving,
    refreshDisabled: !accessToken || loading || refreshing || saving,
    detailDisabled: !catalog || loading,
    saveDisabled: !accessToken || loading || refreshing || saving || !catalog || !isDirty,
    refreshing,
    saving,
    onEnabledChange: handleProviderEnabledChange,
    onRefresh: () => {
      void handleRefresh();
    },
    onShowDetails: () => setDetailModalOpen(true),
    onSave: () => {
      void handleSave();
    }
  }), [
    accessToken,
    catalog,
    draftCommandIds,
    draftEnabled,
    isDirty,
    loading,
    refreshing,
    saving
  ]);

  useEffect(() => {
    onToolbarStateChange?.(toolbarState);
  }, [onToolbarStateChange, toolbarState]);

  useEffect(() => {
    return () => {
      onToolbarStateChange?.(null);
    };
  }, [onToolbarStateChange]);

  async function handleRefresh(): Promise<void> {
    if (!accessToken) {
      return;
    }

    setRefreshing(true);
    setPanelError(null);
    setStatusText(null);

    try {
      const nextCatalog = await refreshOpenCliState();
      applyCatalogState(nextCatalog);
      setStatusText(resolveRefreshStatusText(nextCatalog.refreshState, nextCatalog.runtimeAvailability));
    } catch (error) {
      setPanelError(resolveOpenCliPanelError(error));
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSave(): Promise<void> {
    if (!accessToken) {
      return;
    }

    setSaving(true);
    setPanelError(null);
    setStatusText(null);

    try {
      const nextCatalog = await updateOpenCliConfig({
        enabled: draftEnabled,
        enabledCommandIds: draftCommandIds
      });
      applyCatalogState(nextCatalog);
      setStatusText(resolveSaveStatusText(nextCatalog));
    } catch (error) {
      setPanelError(resolveOpenCliPanelError(error));
    } finally {
      setSaving(false);
    }
  }

  function applyCatalogState(nextCatalog: OpenCliCatalogDto): void {
    setCatalog(nextCatalog);
    setDraftEnabled(nextCatalog.provider.enabled);
    setDraftCommandIds(
      nextCatalog.entries
        .filter((entry) => entry.enabled)
        .map((entry) => entry.commandId)
        .sort((left, right) => left.localeCompare(right))
    );
    setPanelError(null);
  }

  function handleProviderEnabledChange(enabled: boolean): void {
    setDraftEnabled(enabled);
  }

  function handleSiteToggle(siteGroup: OpenCliSiteGroupDto, enabled: boolean): void {
    const siteCommandIds = siteGroup.commands.map((entry) => entry.commandId);

    setDraftCommandIds((current) => {
      const next = new Set(current);

      for (const commandId of siteCommandIds) {
        if (enabled) {
          next.add(commandId);
        } else {
          next.delete(commandId);
        }
      }

      return [...next].sort((left, right) => left.localeCompare(right));
    });
  }

  function handleCommandToggle(commandId: string, enabled: boolean): void {
    setDraftCommandIds((current) => {
      const next = new Set(current);

      if (enabled) {
        next.add(commandId);
      } else {
        next.delete(commandId);
      }

      return [...next].sort((left, right) => left.localeCompare(right));
    });
  }

  const summary = catalog?.summary ?? {
    catalogCount: 0,
    enabledCount: 0,
    browserDependentCount: 0,
    installState: "not_installed" as OpenCliInstallState,
    healthState: "unknown" as OpenCliHealthState
  };

  return (
    <section className="settings-opencli-panel settings-skill-section">
      {toolbarMode === "internal" ? (
        <OpenCliToolbarControls state={toolbarState} className="settings-opencli-inline-toolbar" />
      ) : null}

      <div className="settings-skill-summary-grid">
        <SummaryCard
          label={t("settings.opencliSummaryInstallState")}
          value={resolveInstallStateLabel(summary.installState)}
        />
        <SummaryCard
          label={t("settings.opencliSummaryCatalogCount")}
          value={String(summary.catalogCount)}
        />
        <SummaryCard
          label={t("settings.opencliSummaryEnabledCount")}
          value={String(draftCommandIds.length)}
        />
        <SummaryCard
          label={t("settings.opencliSummaryBrowserCount")}
          value={String(summary.browserDependentCount)}
        />
      </div>

      {statusText ? <p className="settings-release-status">{statusText}</p> : null}
      {panelError ? <p className="settings-release-status">{panelError}</p> : null}

      {loading ? (
        <div className="settings-skill-empty">{t("settings.opencliLoading")}</div>
      ) : catalog?.siteGroups.length ? (
        <section className="settings-opencli-catalog-section settings-skill-section">
          <div className="settings-model-tabs settings-opencli-filter-tabs" role="tablist" aria-label={t("settings.opencliFilterTabsLabel")}>
            {filterOptions.map((option) => {
              const selected = activeFilter === option.id;

              return (
                <button
                  key={option.id}
                  type="button"
                  role="tab"
                  className="settings-model-tab"
                  aria-selected={selected}
                  data-active={selected ? "true" : "false"}
                  onClick={() => setActiveFilter(option.id)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {filteredSiteGroups.length > 0 ? (
            <div className="settings-opencli-site-grid">
              {filteredSiteGroups.map((siteGroup) => {
                const selectionState = resolveSiteSelectionState(siteGroup, selectedCommandIdSet);
                const strategies = collectSiteStrategies(siteGroup.commands);
                const siteDescription = buildSiteDescription(siteGroup, { maxDescriptions: 2 });
                const fullSiteDescription = buildSiteDescription(siteGroup);
                const siteVisual = buildSiteVisual(siteGroup.site);
                const siteSelected = commandModalSite === siteGroup.site;

                return (
                  <div
                    key={siteGroup.site}
                    className="settings-opencli-site-card"
                    data-selected={siteSelected ? "true" : "false"}
                  >
                    <div className="settings-opencli-site-card-head">
                      <div className="settings-opencli-site-card-visual" style={siteVisual.style}>
                        <span>{siteVisual.label}</span>
                      </div>
                      <div className="settings-opencli-site-card-body">
                        <div className="settings-opencli-site-card-topline">
                          <strong className="settings-skill-entry-title">{siteGroup.site}</strong>
                          <div className="settings-opencli-site-card-actions">
                            <button
                              className="ghost-button settings-opencli-site-detail-button"
                              type="button"
                              onClick={() => setCommandModalSite(siteGroup.site)}
                            >
                              {t("settings.opencliSiteViewAction")}
                            </button>
                            <label className="settings-opencli-checkbox settings-opencli-site-toggle">
                              <input
                                aria-label={t("settings.opencliSiteToggleLabel", { site: siteGroup.site })}
                                type="checkbox"
                                checked={selectionState.allSelected}
                                disabled={refreshing || saving}
                                ref={(element) => {
                                  if (element) {
                                    element.indeterminate = selectionState.partialSelected;
                                  }
                                }}
                                onChange={(event) => handleSiteToggle(siteGroup, event.target.checked)}
                              />
                              <span>{t("settings.opencliSiteEnableAction")}</span>
                            </label>
                          </div>
                        </div>
                        <p
                          className="settings-opencli-site-card-description"
                          title={fullSiteDescription}
                        >
                          {siteDescription}
                        </p>
                      </div>
                    </div>

                    <div className="settings-opencli-site-card-summary">
                      <div className="settings-opencli-site-card-tag-rows">
                        <div className="settings-skill-tags settings-opencli-site-card-tag-row settings-opencli-site-card-type-row">
                          {(strategies.length > 0 ? strategies : ["unknown"]).slice(0, 2).map((strategy) => (
                            <span
                              key={`${siteGroup.site}:${strategy}`}
                              className="settings-skill-tag settings-opencli-strategy-tag"
                              data-strategy={resolveStrategyTone(strategy)}
                            >
                              {resolveStrategyShortLabel(strategy)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="settings-skill-empty">{t("settings.opencliFilteredEmpty")}</div>
          )}
        </section>
      ) : (
        <div className="settings-skill-empty">{resolveOpenCliEmptyText(catalog)}</div>
      )}

      <WorkbenchModal
        open={detailModalOpen}
        title={t("settings.opencliDetailTitle")}
        className="settings-opencli-detail-modal"
        onClose={() => setDetailModalOpen(false)}
      >
        {catalog ? (
          <>
            <ModalSection
              heading={t("settings.opencliDetailStatusHeading")}
              actions={(
                <div className="settings-opencli-detail-tags">
                  <ModalTag>{resolveInstallStateLabel(catalog.provider.installState)}</ModalTag>
                  <ModalTag>{resolveHealthStateLabel(catalog.provider.healthState)}</ModalTag>
                  <ModalTag>{resolveRuntimeStatusLabel(catalog.activeRuntimeProfile?.status ?? null)}</ModalTag>
                </div>
              )}
            >
              <ModalList compact className="settings-opencli-detail-list">
                <ModalListItem
                  label={t("settings.opencliEnabledStateLabel")}
                  trailing={<span className="settings-opencli-detail-value">{draftEnabled ? t("settings.opencliEnabledStateOn") : t("settings.opencliEnabledStateOff")}</span>}
                />
                <ModalListItem
                  label={t("settings.opencliSummaryCatalogCount")}
                  trailing={<span className="settings-opencli-detail-value">{String(summary.catalogCount)}</span>}
                />
                <ModalListItem
                  label={t("settings.opencliSummaryEnabledCount")}
                  trailing={<span className="settings-opencli-detail-value">{String(draftCommandIds.length)}</span>}
                />
                <ModalListItem
                  label={t("settings.opencliSummaryBrowserCount")}
                  trailing={<span className="settings-opencli-detail-value">{String(summary.browserDependentCount)}</span>}
                />
                <ModalListItem
                  label={t("settings.opencliVersionLabel")}
                  trailing={<span className="settings-opencli-detail-value">{catalog.provider.version ?? "-"}</span>}
                />
                <ModalListItem
                  label={t("settings.opencliCatalogSourceLabel")}
                  trailing={<span className="settings-opencli-detail-value">{resolveCatalogSourceLabel(catalog.effectiveCatalogSource ?? null)}</span>}
                />
                <ModalListItem
                  label={t("settings.opencliLastCheckedLabel")}
                  trailing={<span className="settings-opencli-detail-value">{formatDateTime(catalog.provider.lastCheckedAt)}</span>}
                />
                <ModalListItem
                  label={t("settings.opencliCatalogRefreshedLabel")}
                  trailing={<span className="settings-opencli-detail-value">{formatDateTime(catalog.provider.catalogRefreshedAt)}</span>}
                />
                <ModalListItem
                  label={t("settings.opencliInstallPathLabel")}
                  description={catalog.provider.installPath ?? "-"}
                />
                <ModalListItem
                  label={t("settings.opencliDetailRuntimeIdLabel")}
                  description={catalog.provider.activeRuntimeId ?? "-"}
                />
                <ModalListItem
                  label={t("settings.opencliDetailRuntimeRootLabel")}
                  description={catalog.activeRuntimeProfile?.runtimeRootPath ?? "-"}
                />
              </ModalList>
            </ModalSection>

            {catalog.provider.lastErrorDetail || catalog.activeRuntimeProfile?.lastErrorDetail ? (
              <ModalSection tone="danger" heading={t("settings.opencliDetailErrorHeading")}>
                <div className="settings-opencli-detail-errors">
                  {catalog.provider.lastErrorDetail ? (
                    <p className="settings-skill-entry-meta">{catalog.provider.lastErrorDetail}</p>
                  ) : null}
                  {catalog.activeRuntimeProfile?.lastErrorDetail ? (
                    <p className="settings-skill-entry-meta">{catalog.activeRuntimeProfile.lastErrorDetail}</p>
                  ) : null}
                </div>
              </ModalSection>
            ) : null}
          </>
        ) : null}
      </WorkbenchModal>

      <WorkbenchModal
        open={commandModalSiteGroup !== null}
        title={commandModalSiteGroup ? t("settings.opencliSiteDetailTitle", { site: commandModalSiteGroup.site }) : t("settings.opencliCommandModalFallbackTitle")}
        description={commandModalSiteGroup
          ? t("settings.opencliSiteDetailDescription", {
            count: visibleModalCommands.length,
            total: commandModalSiteGroup.totalCount
          })
          : undefined}
        className="settings-opencli-command-modal"
        onClose={() => setCommandModalSite(null)}
      >
        {commandModalSiteGroup ? (
          <section className="settings-skill-section">
            <ModalSection heading={t("settings.opencliSiteDescriptionHeading")}>
              <div className="settings-opencli-site-detail-copy">
                {collectSiteDescriptions(commandModalSiteGroup.commands).map((description) => (
                  <p key={description} className="settings-opencli-site-detail-description">
                    {description}
                  </p>
                ))}
              </div>
            </ModalSection>

            <ModalSection
              heading={t("settings.opencliCommandSearchLabel")}
              actions={<ModalTag>{t("settings.opencliCommandResultCount", { count: visibleModalCommands.length })}</ModalTag>}
            >
              <div className="settings-opencli-command-tools">
                <label className="settings-opencli-command-search" htmlFor="opencli-command-search">
                  <span className="settings-opencli-command-search-label">{t("settings.opencliCommandSearchLabel")}</span>
                  <input
                    id="opencli-command-search"
                    className="settings-text-input"
                    type="search"
                    value={commandSearchText}
                    placeholder={t("settings.opencliCommandSearchPlaceholder")}
                    onChange={(event) => setCommandSearchText(event.target.value)}
                  />
                </label>
                <div className="settings-opencli-command-sort">
                  <span className="settings-opencli-command-search-label">{t("settings.opencliCommandSortLabel")}</span>
                  <div className="settings-opencli-command-sort-tabs" role="tablist" aria-label={t("settings.opencliCommandSortLabel")}>
                    {commandSortOptions.map((option) => {
                      const selected = commandSort === option.id;

                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="tab"
                          className="settings-model-tab settings-opencli-command-sort-button"
                          aria-selected={selected}
                          data-active={selected ? "true" : "false"}
                          onClick={() => setCommandSort(option.id)}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </ModalSection>

            {visibleModalCommands.length > 0 ? (
              <div className="settings-opencli-command-grid">
                {visibleModalCommands.map((command) => (
                  <OpenCliCommandCard
                    key={command.commandId}
                    command={command}
                    checked={selectedCommandIdSet.has(command.commandId)}
                    disabled={refreshing || saving}
                    onToggle={handleCommandToggle}
                  />
                ))}
              </div>
            ) : (
              <ModalEmptyState
                compact
                title={t("settings.opencliCommandModalEmpty")}
              />
            )}
          </section>
        ) : null}
      </WorkbenchModal>
    </section>
  );
}

function OpenCliToolbarControls({
  state,
  className
}: {
  state: OpenCliManagementToolbarState;
  className?: string;
}) {
  return (
    <div className={`settings-opencli-toolbar${className ? ` ${className}` : ""}`}>
      <label className="settings-opencli-checkbox settings-opencli-toolbar-toggle">
        <input
          aria-label={t("settings.opencliProviderToggleLabel")}
          type="checkbox"
          checked={state.draftEnabled}
          disabled={state.enableDisabled}
          onChange={(event) => state.onEnabledChange(event.target.checked)}
        />
        <span>{t("settings.opencliEnableAction")}</span>
      </label>
      <button
        className="secondary-button"
        type="button"
        disabled={state.refreshDisabled}
        onClick={state.onRefresh}
      >
        {state.refreshing ? t("common.loading") : t("settings.opencliRefreshAction")}
      </button>
      <button
        className="secondary-button"
        type="button"
        disabled={state.detailDisabled}
        onClick={state.onShowDetails}
      >
        {t("settings.opencliDetailAction")}
      </button>
      <button
        className="primary-button"
        type="button"
        disabled={state.saveDisabled}
        onClick={state.onSave}
      >
        {state.saving ? t("common.loading") : t("settings.opencliSaveAction")}
      </button>
    </div>
  );
}

function OpenCliCommandCard({
  command,
  checked,
  disabled,
  onToggle
}: {
  command: OpenCliCatalogEntryDto;
  checked: boolean;
  disabled: boolean;
  onToggle: (commandId: string, enabled: boolean) => void;
}) {
  const commandVisual = buildSiteVisual(command.commandId);

  return (
    <div className="settings-opencli-command-card">
      <div className="settings-opencli-command-card-head">
        <div className="settings-opencli-command-badge" style={commandVisual.style}>
          <span>{command.name.slice(0, 1).toUpperCase()}</span>
        </div>
        <div className="settings-opencli-command-card-main">
          <label className="settings-opencli-checkbox">
            <input
              aria-label={t("settings.opencliCommandToggleLabel", { commandId: command.commandId })}
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={(event) => onToggle(command.commandId, event.target.checked)}
            />
            <span>{command.commandId}</span>
          </label>
          <p className="settings-skill-entry-meta">
            {command.description || t("settings.opencliCommandDescriptionEmpty")}
          </p>
        </div>
      </div>

      <div className="settings-skill-tags">
        <span
          className="settings-skill-tag settings-opencli-strategy-tag"
          data-strategy={resolveStrategyTone(command.strategy)}
        >
          {resolveStrategyLabel(command.strategy)}
        </span>
        {command.browser ? (
          <span className="settings-skill-tag" data-status="failed">
            {t("settings.opencliBrowserTag")}
          </span>
        ) : (
          <span className="settings-skill-tag" data-status="synced">
            {t("settings.opencliHttpTag")}
          </span>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-skill-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildOpenCliFilterOptions(entries: readonly OpenCliCatalogEntryDto[]): OpenCliFilterOption[] {
  const strategies = Array.from(new Set(entries
    .map((entry) => entry.strategy.trim())
    .filter((strategy) => strategy.length > 0 && strategy !== "unknown"))).sort((left, right) => left.localeCompare(right));

  return [
    { id: "all", label: t("settings.opencliFilterAll") },
    { id: "enabled", label: t("settings.opencliFilterEnabled") },
    { id: "browser", label: t("settings.opencliFilterBrowser") },
    { id: "direct", label: t("settings.opencliFilterDirect") },
    ...strategies.map((strategy) => ({
      id: `strategy:${strategy}` as OpenCliFilterId,
      label: t("settings.opencliFilterStrategy", { strategy: resolveStrategyShortLabel(strategy) })
    }))
  ];
}

function matchesOpenCliFilter(
  command: OpenCliCatalogEntryDto,
  filterId: OpenCliFilterId,
  selectedCommandIdSet: ReadonlySet<string>
): boolean {
  switch (filterId) {
    case "all":
      return true;
    case "enabled":
      return selectedCommandIdSet.has(command.commandId);
    case "browser":
      return command.browser;
    case "direct":
      return !command.browser;
    default:
      return filterId.startsWith("strategy:")
        ? command.strategy === filterId.slice("strategy:".length)
        : true;
  }
}

function resolveSiteSelectionState(
  siteGroup: OpenCliSiteGroupDto,
  selectedCommandIdSet: ReadonlySet<string>
): {
  readonly selectedCount: number;
  readonly allSelected: boolean;
  readonly partialSelected: boolean;
} {
  const selectedCount = siteGroup.commands.filter((entry) => selectedCommandIdSet.has(entry.commandId)).length;

  return {
    selectedCount,
    allSelected: selectedCount > 0 && selectedCount === siteGroup.commands.length,
    partialSelected: selectedCount > 0 && selectedCount < siteGroup.commands.length
  };
}

function matchesOpenCliCommandSearch(
  command: OpenCliCatalogEntryDto,
  normalizedQuery: string
): boolean {
  if (!normalizedQuery) {
    return true;
  }

  const haystack = [
    command.commandId,
    command.name,
    command.description,
    command.strategy
  ]
    .join("\n")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

function compareOpenCliCommands(
  left: OpenCliCatalogEntryDto,
  right: OpenCliCatalogEntryDto,
  options: {
    readonly sortId: OpenCliCommandSortId;
    readonly selectedCommandIdSet: ReadonlySet<string>;
  }
): number {
  const bySort = resolveCommandSortRank(left, options) - resolveCommandSortRank(right, options);

  if (bySort !== 0) {
    return bySort;
  }

  const byName = left.name.localeCompare(right.name);

  if (byName !== 0) {
    return byName;
  }

  return left.commandId.localeCompare(right.commandId);
}

function resolveCommandSortRank(
  command: OpenCliCatalogEntryDto,
  options: {
    readonly sortId: OpenCliCommandSortId;
    readonly selectedCommandIdSet: ReadonlySet<string>;
  }
): number {
  const enabledRank = options.selectedCommandIdSet.has(command.commandId) ? 0 : 1;
  const browserRank = command.browser ? 1 : 0;

  switch (options.sortId) {
    case "browser":
      return (command.browser ? 0 : 2) + enabledRank;
    case "name":
      return 0;
    case "status":
    default:
      return (enabledRank * 2) + browserRank;
  }
}

function buildOpenCliCommandSortOptions(): OpenCliCommandSortOption[] {
  return [
    { id: "status", label: t("settings.opencliCommandSortStatus") },
    { id: "browser", label: t("settings.opencliCommandSortBrowser") },
    { id: "name", label: t("settings.opencliCommandSortName") }
  ];
}

function collectSiteDescriptions(commands: readonly OpenCliCatalogEntryDto[]): string[] {
  return Array.from(new Set(commands
    .map((command) => command.description.trim())
    .filter((description) => description.length > 0)));
}

function buildSiteDescription(
  siteGroup: OpenCliSiteGroupDto,
  options: {
    readonly maxDescriptions?: number;
  } = {}
): string {
  const descriptions = collectSiteDescriptions(siteGroup.commands);

  if (descriptions.length === 0) {
    return t("settings.opencliSiteDescriptionEmpty");
  }

  const maxDescriptions = options.maxDescriptions ?? descriptions.length;

  return descriptions.slice(0, maxDescriptions).join(" · ");
}

function collectSiteStrategies(commands: readonly OpenCliCatalogEntryDto[]): string[] {
  return Array.from(new Set(commands
    .map((command) => command.strategy.trim())
    .filter((strategy) => strategy.length > 0 && strategy !== "unknown"))).sort((left, right) => left.localeCompare(right));
}

function buildSiteVisual(site: string): {
  readonly label: string;
  readonly style: CSSProperties;
} {
  const override = SITE_VISUAL_OVERRIDES[site.toLowerCase()];

  if (override) {
    return {
      label: override.label,
      style: {
        background: override.background
      }
    };
  }

  const palette = OPENCLI_VISUAL_PALETTES[Math.abs(hashText(site)) % OPENCLI_VISUAL_PALETTES.length]!;

  return {
    label: toSiteMonogram(site),
    style: {
      background: `linear-gradient(135deg, ${palette[0]} 0%, ${palette[1]} 100%)`
    }
  };
}

function toSiteMonogram(site: string): string {
  const parts = site
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }

  const compact = parts[0] ?? site;

  return compact.slice(0, Math.min(2, compact.length)).toUpperCase();
}

function hashText(value: string): number {
  let hash = 0;

  for (const character of value) {
    hash = ((hash << 5) - hash) + character.charCodeAt(0);
    hash |= 0;
  }

  return hash;
}

function resolveOpenCliPanelError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message || t("settings.opencliLoadFailed");
  }

  return error instanceof Error ? error.message : t("settings.opencliLoadFailed");
}

function resolveInstallStateLabel(state: OpenCliInstallState): string {
  switch (state) {
    case "installed":
      return t("settings.opencliInstallInstalled");
    case "broken":
      return t("settings.opencliInstallBroken");
    default:
      return t("settings.opencliInstallMissing");
  }
}

function resolveHealthStateLabel(state: OpenCliHealthState): string {
  switch (state) {
    case "ready":
      return t("settings.opencliHealthReady");
    case "bridge_missing":
      return t("settings.opencliHealthBridgeMissing");
    case "binary_ready":
      return t("settings.opencliHealthBinaryReady");
    case "runtime_build_failed":
      return t("settings.opencliHealthRuntimeBuildFailed");
    default:
      return t("settings.opencliHealthUnknown");
  }
}

function resolveCatalogSourceLabel(value: string | null): string {
  switch (value) {
    case "manifest":
      return t("settings.opencliCatalogSourceManifest");
    case "cli_list":
      return t("settings.opencliCatalogSourceCliList");
    case "local_manifest":
      return t("settings.opencliCatalogSourceLocalManifest");
    case "cache":
      return t("settings.opencliCatalogSourceCache");
    default:
      return "-";
  }
}

function resolveRuntimeStatusLabel(status: string | null): string {
  switch (status) {
    case "ready":
      return t("settings.opencliRuntimeReady");
    case "failed":
      return t("settings.opencliRuntimeFailed");
    case "pending":
      return t("settings.opencliRuntimePending");
    case "stale":
      return t("settings.opencliRuntimeStale");
    default:
      return t("settings.opencliRuntimeIdle");
  }
}

function resolveStrategyLabel(strategy: string): string {
  return t("settings.opencliStrategyLabel", { strategy: resolveStrategyName(strategy) });
}

function resolveStrategyShortLabel(strategy: string): string {
  return t("settings.opencliStrategyShortLabel", { strategy: resolveStrategyName(strategy) });
}

function resolveStrategyName(strategy: string): string {
  switch (normalizeStrategyValue(strategy)) {
    case "cookie":
      return t("settings.opencliStrategyCookie");
    case "header":
      return t("settings.opencliStrategyHeader");
    case "intercept":
      return t("settings.opencliStrategyIntercept");
    case "local":
      return t("settings.opencliStrategyLocal");
    case "public":
      return t("settings.opencliStrategyPublic");
    case "ui":
      return t("settings.opencliStrategyUi");
    default:
      return t("settings.opencliStrategyUnknown");
  }
}

function resolveStrategyTone(strategy: string): string {
  return normalizeStrategyValue(strategy);
}

function normalizeStrategyValue(strategy: string): string {
  const normalized = strategy.trim().toLowerCase();

  return normalized.length > 0 ? normalized : "unknown";
}

function resolveRefreshStatusText(
  refreshState: "fresh" | "cache_retained" | "unavailable",
  runtimeAvailability: OpenCliRuntimeAvailability
): string {
  if (refreshState === "cache_retained") {
    return t("settings.opencliRefreshCacheRetained");
  }

  if (refreshState === "unavailable") {
    return t("settings.opencliRefreshUnavailable");
  }

  if (runtimeAvailability === "ready") {
    return t("settings.opencliRefreshReady");
  }

  return t("settings.opencliRefreshDone");
}

function resolveSaveStatusText(result: UpdateOpenCliConfigResultDto): string {
  if (result.runtimeAvailability === "ready") {
    return t("settings.opencliSaveReady");
  }

  if (result.provider.enabled) {
    return t("settings.opencliSaveEnabled");
  }

  return t("settings.opencliSaveDisabled");
}

function resolveOpenCliEmptyText(catalog: OpenCliCatalogDto | null): string {
  if (!catalog) {
    return t("settings.opencliEmpty");
  }

  if (catalog.provider.installState !== "installed") {
    return t("settings.opencliEmptyNotInstalled");
  }

  return t("settings.opencliEmpty");
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Date(timestamp).toLocaleString();
}

const OPENCLI_VISUAL_PALETTES = [
  ["#2563eb", "#0ea5e9"],
  ["#0f766e", "#14b8a6"],
  ["#7c3aed", "#6366f1"],
  ["#ea580c", "#f59e0b"],
  ["#be123c", "#f43f5e"],
  ["#1d4ed8", "#38bdf8"]
] as const;

const SITE_VISUAL_OVERRIDES: Record<string, { label: string; background: string }> = {
  github: {
    label: "GH",
    background: "linear-gradient(135deg, #111827 0%, #374151 100%)"
  },
  hackernews: {
    label: "HN",
    background: "linear-gradient(135deg, #f97316 0%, #fb923c 100%)"
  },
  twitter: {
    label: "TW",
    background: "linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)"
  },
  x: {
    label: "X",
    background: "linear-gradient(135deg, #111827 0%, #6b7280 100%)"
  },
  reddit: {
    label: "RD",
    background: "linear-gradient(135deg, #f97316 0%, #ef4444 100%)"
  }
};
