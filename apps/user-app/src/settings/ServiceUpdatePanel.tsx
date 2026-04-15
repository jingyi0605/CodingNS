import { useEffect, useState } from "react";

import type {
  ManagedServicePackageInfo,
  ServiceUpdateSnapshot,
  ServiceUpdateTaskInfo
} from "../config/client-config-types";
import { createPlatformAdapter } from "../platform/platform-adapter";
import {
  checkForServiceUpdate,
  getServiceUpdateTask,
  installServiceUpdate
} from "../platform/server/service-update-manager";
import { t } from "../shared/i18n";

const SERVICE_UPDATE_POLL_INTERVAL_MS = 1500;

export function ServiceUpdatePanel() {
  const platform = createPlatformAdapter();
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ServiceUpdateSnapshot | null>(null);
  const [task, setTask] = useState<ServiceUpdateTaskInfo | null>(null);
  const packageInfo = snapshot?.packages[0] ?? null;

  useEffect(() => {
    if (!task || !isPendingTask(task.status)) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const nextTask = await getServiceUpdateTask(task.taskId);

        if (cancelled) {
          return;
        }

        setTask(nextTask);
        setStatusText(resolveServiceTaskStatus(nextTask));

        if (!isPendingTask(nextTask.status)) {
          setInstalling(false);
          const nextSnapshot = await checkForServiceUpdate();

          if (cancelled) {
            return;
          }

          setSnapshot(nextSnapshot);
          setTask(nextSnapshot.packages[0]?.installTask ?? nextTask);
          setStatusText(resolveServiceStatus(nextSnapshot.packages[0] ?? null, nextTask));

          if (nextTask.restartRequired) {
            await platform.bridge.showNotification(
              t("settings.serverRestartRequired"),
              nextTask.targetVersion ?? "-"
            );
          }
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        setInstalling(false);
        setStatusText(error instanceof Error ? error.message : t("settings.serverInstallFailed"));
      }
    }, SERVICE_UPDATE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [platform.bridge, task]);

  async function handleCheckUpdate() {
    setLoading(true);
    setStatusText(null);

    try {
      const result = await checkForServiceUpdate();
      const nextPackage = result.packages[0] ?? null;

      setSnapshot(result);
      setTask(nextPackage?.installTask ?? null);
      setStatusText(resolveServiceStatus(nextPackage, nextPackage?.installTask ?? null));

      if (nextPackage?.hasUpdate) {
        await platform.bridge.showNotification(
          t("settings.serverUpdateReady"),
          `${t("settings.serverTargetVersion")}: ${nextPackage.latestVersion ?? "-"}`
        );
      }
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.serverCheckFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleInstallUpdate() {
    if (!packageInfo?.packageName) {
      return;
    }

    setInstalling(true);
    setStatusText(null);

    try {
      const nextTask = await installServiceUpdate(packageInfo.packageName);
      setTask(nextTask);
      setStatusText(resolveServiceTaskStatus(nextTask));
    } catch (error) {
      setInstalling(false);
      setStatusText(error instanceof Error ? error.message : t("settings.serverInstallFailed"));
    }
  }

  const canInstall = Boolean(
    packageInfo
    && packageInfo.checkStatus !== "check_failed"
    && packageInfo.hasUpdate
    && !packageInfo.restartRequired
    && !isPendingTask(task?.status)
  );

  return (
    <div className="settings-update-card">
      <div className="settings-update-summary">
        <div className="settings-update-field">
          <span className="settings-update-label">{t("settings.serverCurrentVersion")}</span>
          <strong className="settings-update-value">{packageInfo?.currentVersion ?? "-"}</strong>
        </div>
        <div className="settings-update-field">
          <span className="settings-update-label">{t("settings.serverTargetVersion")}</span>
          <strong className="settings-update-value">{packageInfo?.latestVersion ?? "-"}</strong>
        </div>
      </div>
      {statusText ? (
        <p
          className="settings-update-status"
          data-tone={resolveServiceTone(packageInfo, task)}
        >
          {statusText}
        </p>
      ) : null}
      <div className="settings-update-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={loading || installing}
          onClick={handleCheckUpdate}
        >
          {loading ? t("common.loading") : t("settings.serverCheckNow")}
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={!canInstall || loading || installing}
          onClick={handleInstallUpdate}
        >
          {installing ? t("common.loading") : t("settings.serverInstallNow")}
        </button>
      </div>
    </div>
  );
}

function resolveServiceStatus(
  packageInfo: ManagedServicePackageInfo | null,
  task: ServiceUpdateTaskInfo | null
): string {
  if (task) {
    return resolveServiceTaskStatus(task);
  }

  if (!packageInfo) {
    return t("settings.serverCheckNow");
  }

  if (packageInfo.restartRequired) {
    return t("settings.serverRestartRequired");
  }

  if (packageInfo.checkStatus === "check_failed") {
    return packageInfo.checkError ?? t("settings.serverCheckFailed");
  }

  if (!packageInfo.latestVersion) {
    return t("settings.serverLatestUnknown");
  }

  return packageInfo.hasUpdate
    ? t("settings.serverUpdateReady")
    : t("settings.serverUpToDate");
}

function resolveServiceTaskStatus(task: ServiceUpdateTaskInfo): string {
  switch (task.status) {
    case "queued":
      return t("settings.serverInstallQueued");
    case "running":
      return t("settings.serverInstalling");
    case "succeeded":
      return task.restartRequired
        ? t("settings.serverRestartRequired")
        : t("settings.serverInstallSucceeded");
    case "cancelled":
      return t("settings.serverInstallCancelled");
    case "timeout":
      return t("settings.serverInstallTimeout");
    case "failed":
      return task.errorMessage ?? t("settings.serverInstallFailed");
    default:
      return task.errorMessage ?? t("settings.serverInstallFailed");
  }
}

function resolveServiceTone(
  packageInfo: ManagedServicePackageInfo | null,
  task: ServiceUpdateTaskInfo | null
): "neutral" | "success" | "warning" | "danger" {
  if (task) {
    switch (task.status) {
      case "queued":
      case "running":
        return "warning";
      case "succeeded":
        return task.restartRequired ? "warning" : "success";
      case "failed":
      case "cancelled":
      case "timeout":
        return "danger";
      default:
        return "neutral";
    }
  }

  if (!packageInfo) {
    return "neutral";
  }

  if (packageInfo.checkStatus === "check_failed") {
    return "danger";
  }

  if (packageInfo.restartRequired || packageInfo.hasUpdate) {
    return "warning";
  }

  return "success";
}

function isPendingTask(status: ServiceUpdateTaskInfo["status"] | undefined): boolean {
  return status === "queued" || status === "running";
}
