import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ModalActions, ModalEmptyState } from "../../../components/ModalAtoms";
import { getHostBaseUrl, getHostRequestUrl } from "../../../config/env";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  attachPluginBridge,
  buildPluginHostBridgeContext,
  type PluginHostBridgeContext
} from "../runtime/plugin-bridge";
import { buildWorkspacePluginDetailPath } from "../../workbench/utils/workbench-navigation";

const PLUGIN_IFRAME_SANDBOX = "allow-scripts allow-forms allow-modals allow-downloads";

export function PluginContainerPage() {
  const { workspaceId = "", pluginId = "" } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [context, setContext] = useState<PluginHostBridgeContext | null>(null);
  const [loading, setLoading] = useState(true);

  const hostOrigin = useMemo(() => {
    const baseUrl = getHostBaseUrl();
    try {
      return new URL(baseUrl).origin;
    } catch {
      return window.location.origin;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void buildPluginHostBridgeContext(pluginId, workspaceId, hostOrigin)
      .then((nextContext) => {
        if (cancelled) {
          return;
        }
        setContext(nextContext);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        showToast({
          title: error instanceof Error ? error.message : t("plugins.containerLoadFailed"),
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
  }, [hostOrigin, pluginId, showToast, workspaceId]);

  useEffect(() => {
    if (!context || !iframeRef.current) {
      return;
    }

    return attachPluginBridge({
      iframe: iframeRef.current,
      pluginId,
      workspaceId,
      hostOrigin,
      context
    });
  }, [context, hostOrigin, pluginId, workspaceId]);

  if (loading) {
    return (
      <main className="mobile-feature-page mobile-page-fixed-root plugins-page">
        <article className="surface-card plugins-panel plugins-container-panel">
          <p className="plugins-hint-text">{t("plugins.loading")}</p>
        </article>
      </main>
    );
  }

  if (!context) {
    return (
      <main className="mobile-feature-page mobile-page-fixed-root plugins-page">
        <article className="surface-card plugins-panel plugins-container-panel">
          <ModalEmptyState
            title={t("plugins.containerMissingTitle")}
            description={t("plugins.containerMissingDescription")}
            action={
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigate(buildWorkspacePluginDetailPath(workspaceId, pluginId))}
              >
                {t("plugins.backToDetail")}
              </button>
            }
          />
        </article>
      </main>
    );
  }

  return (
    <main className="mobile-feature-page mobile-page-fixed-root plugins-page">
      <article className="surface-card plugins-panel plugins-container-panel">
        <header className="plugins-page-header">
          <div>
            <h1>{context.pluginName}</h1>
            <p>{t("plugins.containerDescription")}</p>
          </div>
          <ModalActions>
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigate(buildWorkspacePluginDetailPath(workspaceId, pluginId))}
            >
              {t("plugins.backToDetail")}
            </button>
          </ModalActions>
        </header>

        <div className="plugins-runtime-shell">
          <iframe
            ref={iframeRef}
            title={context.pluginName}
            className="plugins-runtime-frame"
            src={getHostRequestUrl(context.frontendEntryUrl, getHostBaseUrl())}
            sandbox={PLUGIN_IFRAME_SANDBOX}
            referrerPolicy="no-referrer"
          />
        </div>
      </article>
    </main>
  );
}
