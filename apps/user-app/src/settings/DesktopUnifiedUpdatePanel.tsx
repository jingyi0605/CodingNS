import { useEffect, useState } from "react";

import type { ManagedServicePackageInfo, ServiceUpdateTaskInfo } from "../config/client-config-types";
import { useClientConfigSelector } from "../config/client-config-store";
import {
  downloadDesktopUpdate,
  installDesktopUpdate,
  markDesktopRestartRequired
} from "../platform/desktop/release-manager";
import { useDesktopUpdateSelector } from "../platform/desktop/desktop-update-store";
import {
  fetchCurrentHostVersion,
  getServiceUpdateTask,
  installServiceUpdate
} from "../platform/server/service-update-manager";
import { checkCombinedUpdates } from "../platform/update/unified-update-manager";
import { createPlatformAdapter } from "../platform/platform-adapter";
import { t } from "../shared/i18n";
import { ReleaseInstallReadyModal } from "./ReleaseInstallReadyModal";

const SERVICE_UPDATE_POLL_INTERVAL_MS = 1500;
const SERVICE_UPDATE_POLL_TIMEOUT_MS = 120000;

export function DesktopUnifiedUpdatePanel() {
  const autoDownloadUpdate = useClientConfigSelector((state) => state.autoDownloadUpdate);
  const platform = createPlatformAdapter();
  const latestState = useDesktopUpdateSelector((state) => state.latestState);
  const pendingRestartVersion = useDesktopUpdateSelector((state) => state.pendingRestartVersion);
  const [servicePackage, setServicePackage] = useState<ManagedServicePackageInfo | null>(null);
  const [currentHostVersion, setCurrentHostVersion] = useState<string | null>(null);
  const [serviceTask, setServiceTask] = useState<ServiceUpdateTaskInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [openingPage, setOpeningPage] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [downloadedVersion, setDownloadedVersion] = useState<string | null>(null);
  const clientManifest = latestState?.manifest ?? null;
  const clientHasUpdate = latestState?.hasUpdate ?? false;
  const serviceHasUpdate = Boolean(servicePackage?.hasUpdate && !servicePackage.restartRequired);
  const hasAnyUpdate = serviceHasUpdate || Boolean(clientHasUpdate && clientManifest);
  const installPromptOpen = Boolean(
    downloadedVersion && !pendingRestartVersion && downloadedVersion === clientManifest?.version
  );
  const busy = checking || installing;

  // 挂载时自动获取服务端当前版本（不查 NPM registry）
  useEffect(() => {
    let cancelled = false;
    void fetchCurrentHostVersion().then((version) => {
      if (!cancelled) {
        setCurrentHostVersion(version);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCheckAll() {
    if (pendingRestartVersion) {
      return;
    }

    setChecking(true);
    setStatusText(null);
    setDownloadedVersion(null);

    try {
      const result = await checkCombinedUpdates({ notify: "never" });
      const nextServicePackage = result.servicePackage;
      setServicePackage(nextServicePackage);
      setServiceTask(nextServicePackage?.installTask ?? null);

      const clientState = result.clientState;

      if (autoDownloadUpdate && clientState?.hasUpdate && clientState.manifest) {
        const downloadResult = await downloadDesktopUpdate();
        if (downloadResult.ok) {
          setDownloadedVersion(downloadResult.version ?? clientState.manifest.version);
        }
      }

      setStatusText(
        resolveCombinedCheckStatus(
          nextServicePackage,
          Boolean(clientState?.hasUpdate),
          result.serviceError,
          result.clientError
        )
      );
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.updateCheckFailed"));
    } finally {
      setChecking(false);
    }
  }

  async function handleInstallAll() {
    if (!hasAnyUpdate || pendingRestartVersion) {
      return;
    }

    setInstalling(true);
    setStatusText(t("settings.updateInstallingSequential"));

    try {
      if (serviceHasUpdate && servicePackage?.packageName) {
        const startedTask = await installServiceUpdate(servicePackage.packageName);
        setServiceTask(startedTask);
        setStatusText(t("settings.updateInstallingServerFirst"));
        const finishedTask = await waitForServiceTask(startedTask);
        setServiceTask(finishedTask);

        if (finishedTask.status !== "succeeded") {
          setStatusText(finishedTask.errorMessage ?? t("settings.serverInstallFailed"));
          return;
        }
      }

      if (clientHasUpdate && clientManifest) {
        setStatusText(t("settings.updateInstallingClientNext"));
        const result = await installDesktopUpdate();
        if (!result.ok) {
          setStatusText(result.detail ?? t("settings.releaseInstallFailed"));
          return;
        }

        markDesktopRestartRequired(clientManifest.version);
        setDownloadedVersion(null);
        setStatusText(t("settings.releaseRestartRequired"));
        return;
      }

      setStatusText(t("settings.serverInstallSucceeded"));
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.releaseInstallFailed"));
    } finally {
      setInstalling(false);
    }
  }

  async function handleOpenReleasePage() {
    if (!clientManifest?.htmlUrl) {
      return;
    }

    setOpeningPage(true);
    try {
      const result = await platform.bridge.openExternal(clientManifest.htmlUrl);
      if (!result.ok) {
        setStatusText(result.detail ?? t("settings.releasePageOpenFailed"));
      }
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.releasePageOpenFailed"));
    } finally {
      setOpeningPage(false);
    }
  }

  return (
    <>
      <div className="settings-update-card">
        <div className="settings-update-summary">
          <div className="settings-update-field">
            <span className="settings-update-label">{t("settings.serverCurrentVersion")}</span>
            <strong className="settings-update-value">{servicePackage?.currentVersion ?? currentHostVersion ?? "-"}</strong>
          </div>
          <div className="settings-update-field">
            <span className="settings-update-label">{t("settings.serverTargetVersion")}</span>
            <strong className="settings-update-value">{servicePackage?.latestVersion ?? "-"}</strong>
          </div>
          <div className="settings-update-field">
            <span className="settings-update-label">{t("settings.releaseCurrentVersion")}</span>
            <strong className="settings-update-value">
              {latestState?.currentVersion ?? t("settings.releaseUnknownVersion")}
            </strong>
          </div>
          <div className="settings-update-field">
            <span className="settings-update-label">{t("settings.releaseTargetVersion")}</span>
            <strong className="settings-update-value">
              {clientManifest?.version ?? pendingRestartVersion ?? "-"}
            </strong>
          </div>
        </div>

        {serviceTask && isPendingServiceTask(serviceTask.status) ? (
          <div className="settings-update-progress" role="status" aria-label={t("settings.serverProgressLabel")}>
            <div className="settings-update-progress-track">
              <span className="settings-update-progress-bar" style={{ width: serviceTask.status === "queued" ? "20%" : "65%" }} />
            </div>
            <span className="settings-update-progress-text">
              {t("settings.serverProgressCurrentStage", {
                stage: serviceTask.status === "queued"
                  ? t("settings.serverProgressQueued")
                  : t("settings.serverProgressInstalling")
              })}
            </span>
            <span className="settings-update-progress-hint">{t("settings.serverProgressHint")}</span>
          </div>
        ) : null}

        {downloadedVersion ? (
          <p className="settings-update-status" data-tone="warning">
            {t("settings.releaseDownloadedReady")}
          </p>
        ) : null}
        {statusText ? (
          <p className="settings-update-status" data-tone={hasAnyUpdate ? "warning" : "success"}>
            {statusText}
          </p>
        ) : null}

        <div className="settings-update-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={busy || Boolean(pendingRestartVersion)}
            onClick={handleCheckAll}
          >
            {checking ? t("settings.updateChecking") : t("settings.updateCheckAll")}
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!hasAnyUpdate || busy || Boolean(pendingRestartVersion)}
            onClick={handleInstallAll}
          >
            {installing ? t("common.loading") : t("settings.updateInstallAll")}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={!clientManifest?.htmlUrl || busy || openingPage}
            onClick={handleOpenReleasePage}
          >
            {openingPage ? t("common.loading") : t("settings.releaseOpenPage")}
          </button>
        </div>
      </div>
      <ReleaseInstallReadyModal
        open={installPromptOpen}
        version={downloadedVersion}
        installing={installing}
        onClose={() => setDownloadedVersion(null)}
        onConfirm={() => {
          setDownloadedVersion(null);
          void handleInstallAll();
        }}
      />
    </>
  );
}

async function waitForServiceTask(task: ServiceUpdateTaskInfo): Promise<ServiceUpdateTaskInfo> {
  let currentTask = task;
  const startedAt = Date.now();

  while (isPendingServiceTask(currentTask.status)) {
    if (Date.now() - startedAt > SERVICE_UPDATE_POLL_TIMEOUT_MS) {
      return {
        ...currentTask,
        status: "timeout",
        errorMessage: t("settings.serverInstallTimeout")
      };
    }

    await delay(SERVICE_UPDATE_POLL_INTERVAL_MS);
    currentTask = await getServiceUpdateTask(currentTask.taskId);
  }

  return currentTask;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isPendingServiceTask(status: ServiceUpdateTaskInfo["status"]): boolean {
  return status === "queued" || status === "running";
}

function resolveCombinedCheckStatus(
  servicePackage: ManagedServicePackageInfo | null,
  clientHasUpdate: boolean,
  serviceError: string | null,
  clientError: string | null
): string {
  const serviceHasUpdate = Boolean(servicePackage?.hasUpdate);

  if (servicePackage?.checkStatus === "check_failed" || serviceError) {
    if (clientHasUpdate) {
      return t("settings.updateClientReadyServiceCheckFailed");
    }

    return servicePackage?.checkError ?? serviceError ?? t("settings.serverCheckFailed");
  }

  if (clientError) {
    if (serviceHasUpdate) {
      return t("settings.updateServerReadyClientCheckFailed");
    }

    return t("settings.updateCheckIncomplete");
  }

  if (serviceHasUpdate && clientHasUpdate) {
    return t("settings.updateBothReady");
  }

  if (serviceHasUpdate) {
    return t("settings.updateServerReadyOnly");
  }

  if (clientHasUpdate) {
    return t("settings.updateClientReadyOnly");
  }

  return t("settings.updateAllUpToDate");
}
