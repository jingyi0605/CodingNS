import { useEffect, useState } from "react";

import { DesktopModal } from "../components/DesktopModal";
import { MobileSheet } from "../components/MobileSheet";
import { ModalActions, ModalSection } from "../components/ModalAtoms";
import type {
  ManagedServicePackageInfo,
  ServiceUpdateSnapshot,
  ServiceUpdateTaskInfo
} from "../config/client-config-types";
import { createPlatformAdapter } from "../platform/platform-adapter";
import {
  checkForServiceUpdate,
  fetchCurrentHostVersion,
  getServiceUpdateTask,
  installServiceUpdate
} from "../platform/server/service-update-manager";
import { t } from "../shared/i18n";
import { UpdateNotesModal } from "./UpdateNotesModal";
import { servicePackageToUpdateNotes } from "./update-notes-helpers";

const SERVICE_UPDATE_POLL_INTERVAL_MS = 1500;
const SERVICE_RESTART_RECOVERY_POLL_INTERVAL_MS = 2000;
const SERVICE_RESTART_RECOVERY_FALLBACK_DELAY_MS = 2500;

export function ServiceUpdatePanel() {
  const platform = createPlatformAdapter();
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [currentHostVersion, setCurrentHostVersion] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ServiceUpdateSnapshot | null>(null);
  const [task, setTask] = useState<ServiceUpdateTaskInfo | null>(null);
  const packageInfo = snapshot?.packages[0] ?? null;
  const isRestarting = recovering || Boolean(task?.status === "succeeded" && task.restartScheduled);

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

          if (nextTask.status === "succeeded" && nextTask.restartScheduled) {
            setRecovering(true);
            void platform.bridge.showNotification(
              t("settings.serverRestarting"),
              t("settings.serverInstallWarning")
            );
            return;
          }

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

  useEffect(() => {
    if (!recovering || !task || task.status !== "succeeded" || !task.restartScheduled) {
      return;
    }

    let cancelled = false;
    let timer = 0;

    const pollSnapshot = async () => {
      try {
        const nextSnapshot = await checkForServiceUpdate();

        if (cancelled) {
          return;
        }

        const nextPackage = nextSnapshot.packages[0] ?? null;

        if (!hasServiceRestartRecovered(task, nextPackage)) {
          timer = window.setTimeout(pollSnapshot, SERVICE_RESTART_RECOVERY_POLL_INTERVAL_MS);
          return;
        }

        setRecovering(false);
        setSnapshot(nextSnapshot);
        setTask(nextPackage?.installTask ?? null);
        setStatusText(resolveServiceStatus(nextPackage, nextPackage?.installTask ?? null));
      } catch {
        if (cancelled) {
          return;
        }

        setStatusText(t("settings.serverRestarting"));
        timer = window.setTimeout(pollSnapshot, SERVICE_RESTART_RECOVERY_POLL_INTERVAL_MS);
      }
    };

    setStatusText(t("settings.serverRestarting"));
    timer = window.setTimeout(
      pollSnapshot,
      Math.max(task.restartDelayMs ?? 0, SERVICE_RESTART_RECOVERY_FALLBACK_DELAY_MS)
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [recovering, task]);

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

    setConfirmOpen(false);
    setRecovering(false);
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
    && !isRestarting
  );

  return (
    <>
      <div className="settings-update-card">
        <div className="settings-update-summary">
          <div className="settings-update-field">
            <span className="settings-update-label">{t("settings.serverCurrentVersion")}</span>
            <strong className="settings-update-value">{packageInfo?.currentVersion ?? currentHostVersion ?? "-"}</strong>
          </div>
          <div className="settings-update-field">
            <span className="settings-update-label">{t("settings.serverTargetVersion")}</span>
            <strong className="settings-update-value">{packageInfo?.latestVersion ?? "-"}</strong>
          </div>
        </div>
        {packageInfo?.hasUpdate && !isRestarting ? (
          <p className="settings-update-note" data-tone="warning">
            {t("settings.serverInstallWarning")}
          </p>
        ) : null}
        {isPendingTask(task?.status) || isRestarting ? (
          <ServiceUpdateProgress task={task} restarting={isRestarting} />
        ) : null}
        {statusText ? (
          <p
            className="settings-update-status"
            data-tone={resolveServiceTone(packageInfo, task, isRestarting)}
          >
            {statusText}
          </p>
        ) : null}
        <div className="settings-update-actions">
          {packageInfo?.latestNotes ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => setReleaseNotesOpen(true)}
            >
              {t("settings.releaseNotesView")}
            </button>
          ) : null}
          <button
            className="secondary-button"
            type="button"
            disabled={loading || installing || isRestarting}
            onClick={handleCheckUpdate}
          >
            {loading ? t("common.loading") : t("settings.serverCheckNow")}
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!canInstall || loading || installing || isRestarting}
            onClick={() => setConfirmOpen(true)}
          >
            {installing ? t("common.loading") : t("settings.serverInstallNow")}
          </button>
        </div>
      </div>

      <ServiceUpdateInstallConfirmDialog
        open={confirmOpen}
        busy={installing}
        mobile={platform.isMobile}
        targetVersion={packageInfo?.latestVersion ?? null}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          void handleInstallUpdate();
        }}
      />
      <UpdateNotesModal
        open={releaseNotesOpen}
        mobile={platform.isMobile}
        summary={packageInfo ? servicePackageToUpdateNotes(packageInfo) : null}
        onClose={() => setReleaseNotesOpen(false)}
      />
    </>
  );
}

function ServiceUpdateProgress({
  task,
  restarting
}: {
  task: ServiceUpdateTaskInfo | null;
  restarting: boolean;
}) {
  const stage = resolveServiceProgressStage(task, restarting);

  return (
    <div className="settings-update-progress" role="status" aria-label={t("settings.serverProgressLabel")}>
      <div className="settings-update-progress-track">
        <span className="settings-update-progress-bar" style={{ width: `${stage.percent}%` }} />
      </div>
      <span className="settings-update-progress-text">
        {t("settings.serverProgressCurrentStage", { stage: stage.label })}
      </span>
      <span className="settings-update-progress-hint">{t("settings.serverProgressHint")}</span>
    </div>
  );
}

function resolveServiceProgressStage(
  task: ServiceUpdateTaskInfo | null,
  restarting: boolean
): { label: string; percent: number } {
  if (restarting) {
    return { label: t("settings.serverProgressRestarting"), percent: 90 };
  }

  if (task?.status === "queued") {
    return { label: t("settings.serverProgressQueued"), percent: 20 };
  }

  if (task?.status === "running") {
    return { label: t("settings.serverProgressInstalling"), percent: 65 };
  }

  return { label: t("settings.serverProgressPreparing"), percent: 10 };
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
      if (task.restartScheduled) {
        return t("settings.serverRestarting");
      }

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
  task: ServiceUpdateTaskInfo | null,
  restarting: boolean
): "neutral" | "success" | "warning" | "danger" {
  if (restarting) {
    return "warning";
  }

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

function hasServiceRestartRecovered(
  task: Pick<ServiceUpdateTaskInfo, "targetVersion">,
  packageInfo: ManagedServicePackageInfo | null
): boolean {
  if (!packageInfo) {
    return false;
  }

  if (!task.targetVersion) {
    return !packageInfo.hasUpdate;
  }

  return normalizeVersion(packageInfo.currentVersion) === normalizeVersion(task.targetVersion);
}

function normalizeVersion(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^v/i, "");
}

function ServiceUpdateInstallConfirmDialog({
  open,
  busy,
  mobile,
  targetVersion,
  onClose,
  onConfirm
}: {
  open: boolean;
  busy: boolean;
  mobile: boolean;
  targetVersion: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const footer = (
    <ModalActions>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={onClose}
      >
        {t("common.cancel")}
      </button>
      <button
        type="button"
        className="primary-button"
        disabled={busy}
        onClick={onConfirm}
      >
        {busy ? t("common.loading") : t("settings.serverInstallConfirmAction")}
      </button>
    </ModalActions>
  );

  const body = (
    <ModalSection className="settings-update-confirm-section">
      <p className="settings-update-confirm-warning">
        {t("settings.serverInstallWarning")}
      </p>
      <div className="settings-update-confirm-meta">
        <span className="settings-update-label">{t("settings.serverTargetVersion")}</span>
        <strong className="settings-update-value">{targetVersion ?? "-"}</strong>
      </div>
    </ModalSection>
  );

  if (mobile) {
    return (
      <MobileSheet
        open={open}
        title={t("settings.serverInstallConfirmTitle")}
        description={t("settings.serverInstallConfirmDescription")}
        height="auto"
        kind="form"
        dismissible={!busy}
        footer={footer}
        onClose={onClose}
      >
        {body}
      </MobileSheet>
    );
  }

  return (
    <DesktopModal
      open={open}
      title={t("settings.serverInstallConfirmTitle")}
      description={t("settings.serverInstallConfirmDescription")}
      size="compact"
      layout="confirm"
      bodyClassName="settings-update-confirm-body"
      dismissible={!busy}
      footer={footer}
      onClose={onClose}
    >
      {body}
    </DesktopModal>
  );
}
