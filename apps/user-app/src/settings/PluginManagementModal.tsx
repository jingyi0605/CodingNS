import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { DesktopModal } from "../components/DesktopModal";
import { ModalActions, ModalEmptyState, ModalList, ModalListItem, ModalSection, ModalTag } from "../components/ModalAtoms";
import { MobileSheet } from "../components/MobileSheet";
import {
  disablePlugin,
  enablePlugin,
  getPlugin,
  listPluginPermissionGrants,
  listPluginRuns,
  listPlugins,
  revokePluginPermissionGrant,
  type PluginDetailDto,
  type PluginPermissionGrantDto,
  type PluginRunDto,
  type PluginSummaryDto
} from "../features/plugins/api/plugins-api";
import { buildWorkspacePluginContainerPath } from "../features/workbench/utils/workbench-navigation";
import { t } from "../shared/i18n";
import { useToast } from "../shared/toast";
import { PluginAccessOverview } from "../features/plugins/components/PluginAccessOverview";

interface PluginManagementModalProps {
  readonly open: boolean;
  readonly mobile: boolean;
  readonly workspaceId: string | null;
  readonly onClose: () => void;
}

export function PluginManagementModal({
  open,
  mobile,
  workspaceId,
  onClose
}: PluginManagementModalProps) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [items, setItems] = useState<PluginSummaryDto[]>([]);
  const [selectedPluginId, setSelectedPluginId] = useState("");
  const [detail, setDetail] = useState<PluginDetailDto | null>(null);
  const [runs, setRuns] = useState<PluginRunDto[]>([]);
  const [grants, setGrants] = useState<PluginPermissionGrantDto[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingGrants, setLoadingGrants] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null);

  async function loadList(preferredPluginId?: string) {
    setLoadingList(true);
    try {
      const payload = await listPlugins();
      const nextItems = payload.items;
      setItems(nextItems);

      const nextSelectedPluginId = resolveNextSelectedPluginId(
        preferredPluginId ?? selectedPluginId,
        nextItems
      );
      setSelectedPluginId(nextSelectedPluginId);
      return nextSelectedPluginId;
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("plugins.listLoadFailed"),
        tone: "error"
      });
      return "";
    } finally {
      setLoadingList(false);
    }
  }

  async function loadDetail(pluginId: string) {
    if (!pluginId) {
      setDetail(null);
      setRuns([]);
      return;
    }

    setLoadingDetail(true);
    try {
      const [pluginDetail, runsPayload] = await Promise.all([
        getPlugin(pluginId),
        listPluginRuns(pluginId)
      ]);
      setDetail(pluginDetail);
      setRuns(runsPayload.items);
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("plugins.detailLoadFailed"),
        tone: "error"
      });
      setDetail(null);
      setRuns([]);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function loadGrants(pluginId: string) {
    const normalizedWorkspaceId = workspaceId?.trim() ?? "";
    if (!pluginId || !normalizedWorkspaceId) {
      setGrants([]);
      return;
    }

    setLoadingGrants(true);
    try {
      const payload = await listPluginPermissionGrants(pluginId, normalizedWorkspaceId);
      setGrants(payload.items);
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("plugins.permissionGrantLoadFailed"),
        tone: "error"
      });
      setGrants([]);
    } finally {
      setLoadingGrants(false);
    }
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadList();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadDetail(selectedPluginId);
    void loadGrants(selectedPluginId);
  }, [open, selectedPluginId]);

  const desktopPermissions = useMemo(
    () => detail?.manifest.permissions.desktop ?? [],
    [detail]
  );
  const canOpenPlugin = Boolean(detail?.frontend && workspaceId?.trim());

  async function handleToggleEnablement() {
    if (!detail || saving) {
      return;
    }

    setSaving(true);
    try {
      if (detail.enablement.enabled) {
        await disablePlugin(detail.definition.id, t("plugins.disabledByUserReason"));
      } else {
        await enablePlugin(detail.definition.id);
      }
      const nextSelectedPluginId = await loadList(detail.definition.id);
      await loadDetail(nextSelectedPluginId || detail.definition.id);
      showToast({
        title: detail.enablement.enabled ? t("plugins.disableSuccess") : t("plugins.enableSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("plugins.saveFailed"),
        tone: "error"
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleRevokeGrant(grant: PluginPermissionGrantDto) {
    const normalizedWorkspaceId = workspaceId?.trim() ?? "";
    if (!detail || !normalizedWorkspaceId || revokingGrantId) {
      return;
    }

    setRevokingGrantId(grant.id);
    try {
      await revokePluginPermissionGrant(detail.definition.id, grant.id, normalizedWorkspaceId);
      await Promise.all([
        loadDetail(detail.definition.id),
        loadGrants(detail.definition.id)
      ]);
      showToast({
        title: t("plugins.revokeGrantSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("plugins.revokeGrantFailed"),
        tone: "error"
      });
    } finally {
      setRevokingGrantId(null);
    }
  }

  function handleOpenPlugin() {
    const normalizedWorkspaceId = workspaceId?.trim() ?? "";
    if (!detail?.frontend || !normalizedWorkspaceId) {
      return;
    }

    navigate(buildWorkspacePluginContainerPath(normalizedWorkspaceId, detail.definition.id));
    onClose();
  }

  const content = (
    <div className="settings-plugin-manager-layout">
      <ModalSection
        heading={t("settings.pluginManagementModalListTitle")}
        description={t("settings.pluginManagementModalListDescription")}
        className="settings-plugin-modal-section"
      >
        {loadingList ? (
          <p className="plugins-hint-text">{t("plugins.loading")}</p>
        ) : items.length === 0 ? (
          <ModalEmptyState
            title={t("plugins.emptyTitle")}
            description={t("plugins.emptyDescription")}
            compact
          />
        ) : (
          <ModalList className="settings-plugin-modal-list">
            {items.map((plugin) => (
              <ModalListItem
                key={plugin.id}
                as="button"
                selected={selectedPluginId === plugin.id}
                label={plugin.name}
                description={`${plugin.id} · v${plugin.version}`}
                trailing={
                  <div className="settings-plugin-modal-tags">
                    <ModalTag tone={plugin.enabled ? "success" : "default"}>
                      {plugin.enabled ? t("plugins.enabled") : t("plugins.disabled")}
                    </ModalTag>
                    {plugin.hasFrontend ? <ModalTag>{t("plugins.frontendTag")}</ModalTag> : null}
                    {plugin.hasBackend ? <ModalTag>{t("plugins.backendTag")}</ModalTag> : null}
                  </div>
                }
                onClick={() => setSelectedPluginId(plugin.id)}
              />
            ))}
          </ModalList>
        )}
      </ModalSection>

      <ModalSection
        heading={t("settings.pluginManagementModalDetailTitle")}
        description={t("settings.pluginManagementModalDetailDescription")}
        className="settings-plugin-modal-section settings-plugin-modal-detail-section"
      >
        {!selectedPluginId && !loadingList ? (
          <ModalEmptyState
            title={t("settings.pluginManagementSelectPluginTitle")}
            description={t("settings.pluginManagementSelectPluginDescription")}
            compact
          />
        ) : loadingDetail ? (
          <p className="plugins-hint-text">{t("plugins.loading")}</p>
        ) : !detail ? (
          <ModalEmptyState
            title={t("plugins.detailMissingTitle")}
            description={t("plugins.detailMissingDescription")}
            compact
          />
        ) : (
          <div className="settings-plugin-modal-detail-stack">
            <header className="settings-plugin-modal-header">
              <div>
                <strong>{detail.manifest.name}</strong>
                <p>{detail.manifest.description ?? detail.definition.id}</p>
              </div>
              <div className="settings-plugin-modal-tags">
                <ModalTag tone={detail.enablement.enabled ? "success" : "default"}>
                  {detail.enablement.enabled ? t("plugins.enabled") : t("plugins.disabled")}
                </ModalTag>
                <ModalTag>{`v${detail.manifest.version}`}</ModalTag>
              </div>
            </header>

            <ModalSection heading={t("plugins.summaryTitle")} description={t("plugins.summaryDescription")}>
              <ModalList compact>
                <ModalListItem label={t("plugins.pluginIdLabel")} description={detail.definition.id} />
                <ModalListItem label={t("plugins.installRootLabel")} description={detail.definition.installRoot} />
                <ModalListItem
                  label={t("plugins.runtimeLabel")}
                  description={
                    detail.manifest.backend
                      ? `${t("plugins.backendTag")} · ${detail.manifest.backend.mode ?? "on_demand"}`
                      : t("plugins.frontendOnly")
                  }
                />
              </ModalList>
            </ModalSection>

            <ModalSection heading={t("plugins.permissionTitle")} description={t("plugins.permissionDescription")}>
              <div className="settings-plugin-modal-tags">
                <ModalTag tone={detail.manifest.permissions.workspaceRead ? "success" : "default"}>
                  {detail.manifest.permissions.workspaceRead ? t("plugins.workspaceReadAllowed") : t("plugins.workspaceReadDenied")}
                </ModalTag>
                <ModalTag tone={detail.manifest.permissions.network ? "warning" : "default"}>
                  {detail.manifest.permissions.network ? t("plugins.networkAllowed") : t("plugins.networkDenied")}
                </ModalTag>
                {desktopPermissions.length > 0
                  ? desktopPermissions.map((permission) => (
                      <ModalTag key={permission}>{permission}</ModalTag>
                    ))
                  : <ModalTag>{t("plugins.noDesktopPermission")}</ModalTag>}
              </div>
            </ModalSection>

            <PluginAccessOverview
              grants={grants}
              auditEvents={detail.auditEvents}
              loading={loadingGrants}
              revokingGrantId={revokingGrantId}
              onRevokeGrant={(grant) => {
                void handleRevokeGrant(grant);
              }}
            />

            {detail.manifest.backend?.actions?.length ? (
              <ModalSection heading={t("plugins.actionTitle")} description={t("plugins.actionDescription")}>
                <ModalList compact>
                  {detail.manifest.backend.actions.map((action) => (
                    <ModalListItem
                      key={action.id}
                      label={action.title}
                      description={`${action.id} · ${action.timeoutMs ?? 30000}ms`}
                    />
                  ))}
                </ModalList>
              </ModalSection>
            ) : null}

            <ModalSection heading={t("plugins.runHistoryTitle")} description={t("plugins.runHistoryDescription")}>
              {runs.length === 0 ? (
                <ModalEmptyState
                  title={t("plugins.runHistoryEmptyTitle")}
                  description={t("plugins.runHistoryEmptyDescription")}
                  compact
                />
              ) : (
                <ModalList compact>
                  {runs.slice(0, 10).map((run) => (
                    <ModalListItem
                      key={run.id}
                      label={run.actionId ?? t("plugins.unknownAction")}
                      description={`${run.status} · ${run.createdAt}`}
                      trailing={run.errorCode ? <ModalTag tone="danger">{run.errorCode}</ModalTag> : null}
                    />
                  ))}
                </ModalList>
              )}
            </ModalSection>

            {!canOpenPlugin ? (
              <p className="settings-plugin-modal-workspace-note">
                {t("settings.pluginManagementWorkspaceRequired")}
              </p>
            ) : null}

            <ModalActions align="between" stack>
              <button type="button" className="secondary-button" onClick={onClose}>
                {t("common.close")}
              </button>
              <div className="settings-plugin-modal-actions">
                {detail.frontend ? (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!canOpenPlugin}
                    onClick={handleOpenPlugin}
                  >
                    {t("plugins.openPlugin")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={detail.enablement.enabled ? "secondary-button" : "primary-button"}
                  disabled={saving}
                  onClick={() => {
                    void handleToggleEnablement();
                  }}
                >
                  {detail.enablement.enabled ? t("plugins.disableAction") : t("plugins.enableAction")}
                </button>
              </div>
            </ModalActions>
          </div>
        )}
      </ModalSection>
    </div>
  );

  if (mobile) {
    return (
      <MobileSheet
        open={open}
        title={t("settings.pluginManagementModalTitle")}
        description={t("settings.pluginManagementModalDescription")}
        height="full"
        kind="form"
        showHandle
        onClose={onClose}
      >
        {content}
      </MobileSheet>
    );
  }

  return (
    <DesktopModal
      open={open}
      title={t("settings.pluginManagementModalTitle")}
      description={t("settings.pluginManagementModalDescription")}
      size="xwide"
      layout="list"
      bodyClassName="settings-plugin-modal-body"
      onClose={onClose}
    >
      {content}
    </DesktopModal>
  );
}

function resolveNextSelectedPluginId(
  preferredPluginId: string,
  items: PluginSummaryDto[]
): string {
  if (preferredPluginId && items.some((item) => item.id === preferredPluginId)) {
    return preferredPluginId;
  }

  return items[0]?.id ?? "";
}
