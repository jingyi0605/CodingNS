import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ModalActions, ModalEmptyState, ModalList, ModalListItem, ModalSection, ModalTag } from "../../../components/ModalAtoms";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  disablePlugin,
  enablePlugin,
  getPlugin,
  listPluginRuns,
  type PluginDetailDto,
  type PluginRunDto
} from "../api/plugins-api";
import {
  buildWorkspacePluginContainerPath,
  buildWorkspacePluginsPath
} from "../../workbench/utils/workbench-navigation";

export function PluginDetailPage() {
  const { workspaceId = "", pluginId = "" } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [detail, setDetail] = useState<PluginDetailDto | null>(null);
  const [runs, setRuns] = useState<PluginRunDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
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
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [pluginId]);

  const desktopPermissions = useMemo(
    () => detail?.manifest.permissions.desktop ?? [],
    [detail]
  );

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
      await load();
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

  if (loading) {
    return (
      <main className="mobile-feature-page mobile-page-scroll-root plugins-page">
        <article className="surface-card plugins-panel">
          <p className="plugins-hint-text">{t("plugins.loading")}</p>
        </article>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="mobile-feature-page mobile-page-scroll-root plugins-page">
        <article className="surface-card plugins-panel">
          <ModalEmptyState
            title={t("plugins.detailMissingTitle")}
            description={t("plugins.detailMissingDescription")}
            action={
              <button type="button" className="secondary-button" onClick={() => navigate(buildWorkspacePluginsPath(workspaceId))}>
                {t("plugins.backToList")}
              </button>
            }
          />
        </article>
      </main>
    );
  }

  return (
    <main className="mobile-feature-page mobile-page-scroll-root plugins-page">
      <article className="surface-card plugins-panel">
        <header className="plugins-page-header">
          <div>
            <h1>{detail.manifest.name}</h1>
            <p>{detail.manifest.description ?? detail.definition.id}</p>
          </div>
          <div className="plugins-list-tags">
            <ModalTag tone={detail.enablement.enabled ? "success" : "default"}>
              {detail.enablement.enabled ? t("plugins.enabled") : t("plugins.disabled")}
            </ModalTag>
            <ModalTag>{`v${detail.manifest.version}`}</ModalTag>
          </div>
        </header>

        <ModalSection heading={t("plugins.summaryTitle")} description={t("plugins.summaryDescription")}>
          <ModalList>
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
          <div className="plugins-list-tags">
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
              : <ModalTag tone="default">{t("plugins.noDesktopPermission")}</ModalTag>}
          </div>
        </ModalSection>

        {detail.manifest.backend?.actions?.length ? (
          <ModalSection heading={t("plugins.actionTitle")} description={t("plugins.actionDescription")}>
            <ModalList>
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
            />
          ) : (
            <ModalList>
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

        <ModalActions align="between" stack>
          <button type="button" className="secondary-button" onClick={() => navigate(buildWorkspacePluginsPath(workspaceId))}>
            {t("plugins.backToList")}
          </button>
          <div className="plugins-detail-actions">
            {detail.frontend ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigate(buildWorkspacePluginContainerPath(workspaceId, detail.definition.id))}
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
      </article>
    </main>
  );
}
