import { useState } from "react";

import { DesktopModal } from "../components/DesktopModal";
import { ModalActions, ModalSection } from "../components/ModalAtoms";
import { useClientConfigSelector } from "../config/client-config-store";
import { createPlatformAdapter } from "../platform/platform-adapter";
import { t } from "../shared/i18n";
import {
  downloadDesktopUpdate,
  markDesktopRestartRequired,
  refreshDesktopUpdateState,
  installDesktopUpdate,
  restartDesktopApplication
} from "../platform/desktop/release-manager";
import { useDesktopUpdateSelector } from "../platform/desktop/desktop-update-store";
import { ReleaseInstallReadyModal } from "./ReleaseInstallReadyModal";
import { UpdateNotesModal } from "./UpdateNotesModal";
import { releaseManifestToUpdateNotes } from "./update-notes-helpers";

export function ReleasePanel() {
  const platform = createPlatformAdapter();
  const supportsClientPackageUpdate = platform.isDesktop;
  const autoDownloadUpdate = useClientConfigSelector((state) => state.autoDownloadUpdate);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [openingPage, setOpeningPage] = useState(false);
  const [downloadedVersion, setDownloadedVersion] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [dismissedRestartVersion, setDismissedRestartVersion] = useState<string | null>(null);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const latestState = useDesktopUpdateSelector((state) => state.latestState);
  const pendingRestartVersion = useDesktopUpdateSelector((state) => state.pendingRestartVersion);
  const checkedVersion = latestState?.currentVersion ?? null;
  const manifest = latestState?.manifest ?? null;
  const hasUpdate = latestState?.hasUpdate ?? false;
  const restartPending = Boolean(pendingRestartVersion);
  const restartModalOpen = restartPending && dismissedRestartVersion !== pendingRestartVersion;
  const installPromptOpen = Boolean(
    downloadedVersion && !restartPending && downloadedVersion === manifest?.version
  );

  async function handleCheckUpdate() {
    if (restartPending) {
      return;
    }

    setLoading(true);
    setDownloadedVersion(null);
    setStatusText(null);

    try {
      const state = await refreshDesktopUpdateState({ notify: "always" });
      setStatusText(resolveReleaseStatus(state.hasUpdate));

      if (autoDownloadUpdate && state.hasUpdate && state.manifest) {
        await downloadUpdatePackage(state.manifest.version);
      }
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.releaseCheckFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function downloadUpdatePackage(targetVersion: string): Promise<void> {
    setDownloading(true);
    setStatusText(t("settings.releaseDownloading"));

    try {
      const result = await downloadDesktopUpdate();

      if (!result.ok) {
        setStatusText(result.detail ?? t("settings.releaseDownloadFailed"));
        return;
      }

      setDownloadedVersion(result.version ?? targetVersion);
      setStatusText(resolveDownloadStatus(result.progress?.percent ?? null));
    } finally {
      setDownloading(false);
    }
  }

  async function handleInstallUpdate() {
    if (!manifest || !hasUpdate || restartPending) {
      return;
    }

    setInstalling(true);
    setStatusText(null);

    try {
      const result = await installDesktopUpdate();

      if (!result.ok) {
        setStatusText(result.detail ?? t("settings.releaseInstallFailed"));
        return;
      }

      markDesktopRestartRequired(manifest.version);
      setDownloadedVersion(null);
      setDismissedRestartVersion(null);
      setStatusText(t("settings.releaseRestartRequired"));
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.releaseInstallFailed"));
    } finally {
      setInstalling(false);
    }
  }

  async function handleOpenReleasePage() {
    if (!manifest?.htmlUrl) {
      return;
    }

    setOpeningPage(true);

    try {
      const result = await platform.bridge.openExternal(manifest.htmlUrl);

      if (!result.ok) {
        setStatusText(result.detail ?? t("settings.releasePageOpenFailed"));
      }
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.releasePageOpenFailed"));
    } finally {
      setOpeningPage(false);
    }
  }

  const busy = loading || downloading || installing;
  const canInstall = Boolean(supportsClientPackageUpdate && manifest && hasUpdate && !restartPending);
  const effectiveStatusText =
    statusText ??
    (!supportsClientPackageUpdate
      ? t("settings.clientUpdateUnsupported")
      : restartPending
        ? t("settings.releaseRestartRequired")
      : latestState
        ? resolveReleaseStatus(latestState.hasUpdate)
        : null);

  return (
    <>
      <div className="settings-update-card">
        <div className="settings-update-summary">
          <div className="settings-update-field">
            <span className="settings-update-label">{t("settings.releaseCurrentVersion")}</span>
            <strong className="settings-update-value">
              {checkedVersion ?? t("settings.releaseUnknownVersion")}
            </strong>
          </div>
          <div className="settings-update-field">
            <span className="settings-update-label">{t("settings.releaseTargetVersion")}</span>
            <strong className="settings-update-value">{manifest?.version ?? pendingRestartVersion ?? "-"}</strong>
          </div>
        </div>
        {effectiveStatusText ? (
          <p
            className="settings-update-status"
            data-tone={resolveReleaseTone(hasUpdate, effectiveStatusText, restartPending)}
          >
            {effectiveStatusText}
          </p>
        ) : null}
        <div className="settings-update-actions">
          {manifest?.notes ? (
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
            disabled={!supportsClientPackageUpdate || busy || restartPending}
            onClick={handleCheckUpdate}
          >
            {loading ? t("settings.updateChecking") : t("settings.updateCheckAll")}
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!canInstall || busy}
            onClick={handleInstallUpdate}
          >
            {installing ? t("common.loading") : t("settings.releaseInstallNow")}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={!manifest?.htmlUrl || busy || openingPage}
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
          void handleInstallUpdate();
        }}
      />
      <ReleaseRestartModal
        open={restartModalOpen}
        version={pendingRestartVersion}
        onClose={() => setDismissedRestartVersion(pendingRestartVersion)}
      />
      <UpdateNotesModal
        open={releaseNotesOpen}
        mobile={false}
        summary={manifest ? releaseManifestToUpdateNotes(manifest) : null}
        onClose={() => setReleaseNotesOpen(false)}
      />
    </>
  );
}

function resolveReleaseStatus(hasUpdate: boolean): string {
  if (!hasUpdate) {
    return t("settings.releaseUpToDate");
  }

  return t("settings.releaseUpdateReady");
}

function resolveDownloadStatus(percent: number | null): string {
  if (percent === null) {
    return t("settings.releaseDownloadedReady");
  }

  return t("settings.releaseDownloadedReadyWithProgress", {
    percent: String(percent)
  });
}

function resolveReleaseTone(
  hasUpdate: boolean,
  statusText: string,
  restartPending: boolean
): "neutral" | "success" | "warning" | "danger" {
  if (statusText === t("settings.clientUpdateUnsupported")) {
    return "neutral";
  }

  if (
    statusText === t("settings.releaseCheckFailed") ||
    statusText === t("settings.releaseInstallFailed") ||
    statusText === t("settings.releaseDownloadFailed")
  ) {
    return "danger";
  }

  if (restartPending || hasUpdate) {
    return "warning";
  }

  return "success";
}

interface ReleaseRestartModalProps {
  readonly open: boolean;
  readonly version: string | null;
  readonly onClose: () => void;
}

function ReleaseRestartModal({ open, version, onClose }: ReleaseRestartModalProps) {
  const [restarting, setRestarting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  async function handleRestart() {
    setRestarting(true);
    setErrorText(null);

    try {
      await restartDesktopApplication();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("settings.releaseRestartFailed"));
      setRestarting(false);
    }
  }

  return (
    <DesktopModal
      open={open}
      title={t("settings.releaseRestartDialogTitle")}
      description={t("settings.releaseRestartDialogDescription", {
        version: version ?? "-"
      })}
      size="compact"
      layout="confirm"
      dismissible={!restarting}
      footer={
        <ModalActions>
          <button
            className="secondary-button"
            type="button"
            disabled={restarting}
            onClick={onClose}
          >
            {t("settings.releaseRestartLater")}
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={restarting}
            onClick={handleRestart}
          >
            {restarting ? t("common.loading") : t("settings.releaseRestartConfirm")}
          </button>
        </ModalActions>
      }
      onClose={() => {
        if (restarting) {
          return;
        }

        onClose();
      }}
    >
      <ModalSection className="settings-update-confirm-section">
        {errorText ? (
          <p className="settings-update-status" data-tone="danger">
            {errorText}
          </p>
        ) : null}
      </ModalSection>
    </DesktopModal>
  );
}
