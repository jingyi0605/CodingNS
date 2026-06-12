import { DesktopModal } from "../components/DesktopModal";
import { MobileSheet } from "../components/MobileSheet";
import { ModalSection } from "../components/ModalAtoms";
import type { UpdateNotesSummary } from "../config/client-config-types";
import { t } from "../shared/i18n";

interface UpdateNotesModalProps {
  readonly open: boolean;
  readonly mobile: boolean;
  readonly summary: UpdateNotesSummary | null;
  readonly onClose: () => void;
}

function channelLabel(channel: UpdateNotesSummary["channel"]): string {
  return channel === "beta" ? t("settings.releaseChannelBeta") : t("settings.releaseChannelStable");
}

export function UpdateNotesModal({ open, mobile, summary, onClose }: UpdateNotesModalProps) {
  const content = summary ? (
    <UpdateNotesContent summary={summary} />
  ) : (
    <ModalSection>
      <p className="settings-update-notes-empty">{t("settings.releaseNotesEmpty")}</p>
    </ModalSection>
  );

  if (mobile) {
    return (
      <MobileSheet
        open={open}
        title={t("settings.releaseNotes")}
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
      title={t("settings.releaseNotes")}
      size="regular"
      layout="viewer"
      onClose={onClose}
    >
      {content}
    </DesktopModal>
  );
}

function UpdateNotesContent({ summary }: { summary: UpdateNotesSummary }) {
  return (
    <>
      <ModalSection>
        <div className="settings-update-notes-header">
          {summary.title ? (
            <strong className="settings-update-notes-title">{summary.title}</strong>
          ) : null}
          <div className="settings-update-notes-meta">
            <span className="settings-update-notes-version">v{summary.version}</span>
            <span className="settings-update-notes-separator">·</span>
            <span className="settings-update-notes-channel">{channelLabel(summary.channel)}</span>
          </div>
          {summary.publishedAt ? (
            <span className="settings-update-notes-published">
              {t("settings.releaseNotesPublishedAt")}：{summary.publishedAt}
            </span>
          ) : null}
        </div>
      </ModalSection>
      <ModalSection>
        <div className="settings-update-notes-body">
          {summary.content ? (
            <p className="settings-update-notes-content">{summary.content}</p>
          ) : (
            <p className="settings-update-notes-empty">{t("settings.releaseNotesEmpty")}</p>
          )}
        </div>
      </ModalSection>
    </>
  );
}
