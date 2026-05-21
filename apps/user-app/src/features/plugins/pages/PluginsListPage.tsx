import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ModalEmptyState, ModalList, ModalListItem, ModalTag } from "../../../components/ModalAtoms";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import { listPlugins, type PluginSummaryDto } from "../api/plugins-api";
import { buildWorkspacePluginDetailPath } from "../../workbench/utils/workbench-navigation";

export function PluginsListPage() {
  const { workspaceId = "" } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [items, setItems] = useState<PluginSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    void listPlugins()
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setItems(payload.items);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        showToast({
          title: error instanceof Error ? error.message : t("plugins.listLoadFailed"),
          tone: "error"
        });
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showToast]);

  return (
    <main className="mobile-feature-page mobile-page-scroll-root plugins-page">
      <article className="surface-card plugins-panel">
        <header className="plugins-page-header">
          <div>
            <h1>{t("plugins.listTitle")}</h1>
            <p>{t("plugins.listDescription")}</p>
          </div>
        </header>

        {loading ? <p className="plugins-hint-text">{t("plugins.loading")}</p> : null}

        {!loading && items.length === 0 ? (
          <ModalEmptyState
            title={t("plugins.emptyTitle")}
            description={t("plugins.emptyDescription")}
          />
        ) : null}

        {items.length > 0 ? (
          <ModalList className="plugins-list">
            {items.map((plugin) => (
              <ModalListItem
                key={plugin.id}
                as="button"
                className="plugins-list-item"
                label={plugin.name}
                description={`${plugin.id} · v${plugin.version}`}
                trailing={
                  <div className="plugins-list-tags">
                    <ModalTag tone={plugin.enabled ? "success" : "default"}>
                      {plugin.enabled ? t("plugins.enabled") : t("plugins.disabled")}
                    </ModalTag>
                    {plugin.hasFrontend ? <ModalTag>{t("plugins.frontendTag")}</ModalTag> : null}
                    {plugin.hasBackend ? <ModalTag>{t("plugins.backendTag")}</ModalTag> : null}
                  </div>
                }
                onClick={() => navigate(buildWorkspacePluginDetailPath(workspaceId, plugin.id))}
              />
            ))}
          </ModalList>
        ) : null}
      </article>
    </main>
  );
}
