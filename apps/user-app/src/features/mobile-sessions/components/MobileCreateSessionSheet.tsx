import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

import { t } from "../../../shared/i18n";
import type { ProviderId, WorkspaceDto } from "../../conversation/api/conversation-api";
import { SessionProviderPicker } from "../../conversation/components/SessionProviderPicker";

interface MobileCreateSessionSheetProps {
  readonly open: boolean;
  readonly workspaces: readonly WorkspaceDto[];
  readonly initialWorkspaceId: string | null;
  readonly onClose: () => void;
  readonly onSelect: (workspaceId: string, provider: ProviderId) => void;
}

export function MobileCreateSessionSheet({
  open,
  workspaces,
  initialWorkspaceId,
  onClose,
  onSelect
}: MobileCreateSessionSheetProps) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSelectedWorkspaceId(resolveInitialWorkspaceId(workspaces, initialWorkspaceId));
    setWorkspacePickerOpen(false);
  }, [initialWorkspaceId, open, workspaces]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ??
    workspaces[0] ??
    null;

  return createPortal(
    <div className="ios-action-sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="mobile-workspace-home-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("shell.createSessionModalTitle")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mobile-workspace-home-sheet-card">
          <div className="mobile-workspace-home-sheet-header">
            <strong>{t("shell.createSessionModalTitle")}</strong>
          </div>
          <div className="mobile-feature-form mobile-workspace-home-form mobile-create-session-form">
            <p className="mobile-create-session-description">{t("shell.createSessionModalDescription")}</p>
            <div className="mobile-feature-field">
              <span>{t("shell.createSessionWorkspaceLabel")}</span>
              <button
                type="button"
                className="mobile-create-session-workspace-trigger"
                aria-label={`${t("shell.createSessionWorkspaceLabel")} ${selectedWorkspace?.name ?? ""}`.trim()}
                aria-expanded={workspacePickerOpen ? "true" : "false"}
                disabled={workspaces.length === 0}
                onClick={() => setWorkspacePickerOpen((current) => !current)}
              >
                <span className="mobile-create-session-workspace-copy">
                  <strong>{selectedWorkspace?.name ?? t("common.unknown")}</strong>
                  <span>{selectedWorkspace?.path ?? t("common.unknown")}</span>
                </span>
                <ChevronDownIcon expanded={workspacePickerOpen} />
              </button>
              {workspacePickerOpen ? (
                <div className="mobile-workspace-home-group mobile-create-session-workspace-list" role="list">
                  {workspaces.map((workspace) => (
                    <button
                      key={workspace.id}
                      type="button"
                      className="mobile-workspace-home-row mobile-create-session-workspace-row"
                      onClick={() => {
                        setSelectedWorkspaceId(workspace.id);
                        setWorkspacePickerOpen(false);
                      }}
                    >
                      <span className="mobile-create-session-workspace-option-copy">
                        <strong>{workspace.name}</strong>
                        <span>{workspace.path}</span>
                      </span>
                      <span className="mobile-workspace-home-row-trailing">
                        {workspace.id === selectedWorkspaceId ? <CheckIcon /> : <ChevronRightIcon />}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="mobile-create-session-provider-block">
              <div className="mobile-create-session-provider-header">
                <span className="mobile-create-session-provider-label">{t("shell.createSessionProviderLabel")}</span>
                <span className="mobile-create-session-provider-hint">{t("shell.providerOptionHint")}</span>
              </div>
              <SessionProviderPicker
                disabled={!selectedWorkspaceId}
                onSelect={(provider) => {
                  if (!selectedWorkspaceId) {
                    return;
                  }

                  onSelect(selectedWorkspaceId, provider);
                }}
              />
            </div>
          </div>
        </div>
        <button type="button" className="ios-action-sheet-cancel" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </div>,
    document.body
  );
}

function resolveInitialWorkspaceId(workspaces: readonly WorkspaceDto[], initialWorkspaceId: string | null) {
  if (initialWorkspaceId && workspaces.some((workspace) => workspace.id === initialWorkspaceId)) {
    return initialWorkspaceId;
  }

  return workspaces[0]?.id ?? "";
}

function ChevronDownIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="mobile-create-session-workspace-chevron"
      data-expanded={expanded ? "true" : "false"}
    >
      <path
        d="M4 6.5L8 10l4-3.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6 3.5L10.5 8 6 12.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 8.5L6.5 11.5L12.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
