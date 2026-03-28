import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ReleaseManifest } from "../config/client-config-types";
import { createPlatformAdapter } from "../platform/platform-adapter";
import { t } from "../shared/i18n";
import {
  checkForDesktopUpdate,
  installDesktopUpdate,
  rollbackDesktopUpdate
} from "../platform/desktop/release-manager";

export function ReleasePanel() {
  const platform = createPlatformAdapter();
  const supportsClientPackageUpdate = platform.isDesktop;
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [openingPage, setOpeningPage] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [checkedVersion, setCheckedVersion] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ReleaseManifest | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);

  async function handleCheckUpdate() {
    setLoading(true);
    setStatusText(null);

    try {
      const state = await checkForDesktopUpdate();
      setManifest(state.manifest);
      setCheckedVersion(state.currentVersion);
      setHasUpdate(state.hasUpdate);
      setStatusText(resolveReleaseStatus(state.manifest, state.hasUpdate));

      if (state.hasUpdate) {
        await platform.bridge.showNotification(
          t("settings.releaseUpdateReady"),
          state.manifest?.tagName ?? state.manifest?.version ?? "-"
        );
      }
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.releaseCheckFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleInstallUpdate() {
    if (!manifest?.packageUrl || !manifest.signature) {
      return;
    }

    setInstalling(true);
    setStatusText(null);

    try {
      const result = await installDesktopUpdate(manifest);

      if (!result.ok) {
        setStatusText(result.detail ?? t("settings.releaseInstallFailed"));
        return;
      }

      setStatusText(t("settings.releaseInstallStarted"));
      await platform.bridge.showNotification(
        t("settings.releaseInstallStarted"),
        manifest.version
      );
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.releaseInstallFailed"));
    } finally {
      setInstalling(false);
    }
  }

  async function handleRollback() {
    setInstalling(true);
    setStatusText(null);

    try {
      const result = await rollbackDesktopUpdate();
      setStatusText(result.ok ? t("settings.releaseRollbackStarted") : (result.detail ?? t("settings.releaseRollbackFailed")));

      if (result.ok) {
        await platform.bridge.showNotification(
          t("settings.releaseRollbackStarted"),
          checkedVersion ?? t("settings.releaseUnknownVersion")
        );
      }
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : t("settings.releaseRollbackFailed"));
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

  const canInstall = Boolean(
    supportsClientPackageUpdate && manifest?.packageUrl && manifest.signature && hasUpdate
  );
  const effectiveStatusText =
    statusText ?? (!supportsClientPackageUpdate ? t("settings.clientUpdateUnsupported") : null);

  return (
    <div className="settings-release-card">
      <div className="settings-release-meta">
        <span>{t("settings.releaseCurrentVersion")}: {checkedVersion ?? t("settings.releaseUnknownVersion")}</span>
        <span>{t("settings.releaseTargetVersion")}: {manifest?.version ?? "-"}</span>
        <span>{t("settings.releaseTargetTag")}: {manifest?.tagName ?? "-"}</span>
        <span>{t("settings.releasePublishedAt")}: {formatReleaseDateTime(manifest?.publishedAt)}</span>
      </div>
      {manifest ? (
        <div className="settings-release-notes">
          <strong>{t("settings.releaseNotes")}</strong>
          {manifest.title && manifest.title !== manifest.tagName ? (
            <p className="settings-release-title">{manifest.title}</p>
          ) : null}
          {manifest.notes ? (
            <div className="settings-release-markdown">
              <Markdown remarkPlugins={[remarkGfm]}>{manifest.notes}</Markdown>
            </div>
          ) : (
            <p>{t("settings.releaseNotesEmpty")}</p>
          )}
        </div>
      ) : null}
      {effectiveStatusText ? <p className="settings-release-status">{effectiveStatusText}</p> : null}
      <div className="settings-release-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={!supportsClientPackageUpdate || loading || installing}
          onClick={handleCheckUpdate}
        >
          {loading ? t("common.loading") : t("settings.releaseCheckNow")}
        </button>
        <button className="primary-button" type="button" disabled={!canInstall || installing} onClick={handleInstallUpdate}>
          {installing ? t("common.loading") : t("settings.releaseInstallNow")}
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!manifest?.htmlUrl || loading || installing || openingPage}
          onClick={handleOpenReleasePage}
        >
          {openingPage ? t("common.loading") : t("settings.releaseOpenPage")}
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!supportsClientPackageUpdate || installing}
          onClick={handleRollback}
        >
          {t("settings.releaseRollback")}
        </button>
      </div>
    </div>
  );
}

function resolveReleaseStatus(manifest: ReleaseManifest | null, hasUpdate: boolean): string {
  if (!hasUpdate) {
    return t("settings.releaseUpToDate");
  }

  if (!manifest?.packageUrl) {
    return t("settings.releaseInstallerMissing");
  }

  if (!manifest.signature) {
    return t("settings.releaseSignatureMissing");
  }

  return t("settings.releaseUpdateReady");
}

function formatReleaseDateTime(value?: string | null): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}
