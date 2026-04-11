import { useEffect, useMemo, useState } from "react";

import { t } from "../../../shared/i18n";
import { WorkbenchModal } from "./WorkbenchModal";
import { SessionButlerActionButton } from "./SessionButlerActionButton";
import {
  buildSessionBranchTreeModel,
  hasSessionBranchRelations,
  SessionBranchTreeExplorer
} from "./SessionBranchTreePanel";

import type { SessionSummaryDto } from "../api/conversation-api";
import type { WorkspaceSessionGroup } from "./WorkbenchLayout";

type MobileSessionActionsTab = "branch" | "ai";

export function MobileConversationSessionActions({
  session,
  navigationGroups,
  workspaceId,
  sessionId,
  onOpenSession
}: {
  session: SessionSummaryDto | null;
  navigationGroups: WorkspaceSessionGroup[];
  workspaceId: string | null;
  sessionId: string;
  onOpenSession: (session: SessionSummaryDto) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<MobileSessionActionsTab>("branch");
  const model = useMemo(
    () => buildSessionBranchTreeModel(navigationGroups, workspaceId, sessionId),
    [navigationGroups, sessionId, workspaceId]
  );
  const hasBranchRelations = hasSessionBranchRelations(model);

  useEffect(() => {
    setModalOpen(false);
    setActiveTab("branch");
  }, [sessionId]);

  if (!session) {
    return null;
  }

  if (!hasBranchRelations || !model) {
    return <SessionButlerActionButton session={session} />;
  }

  return (
    <>
      <button
        type="button"
        className="conversation-header-ai-button conversation-header-overflow-button"
        aria-label={t("conversation.moreSessionActions")}
        title={t("conversation.moreSessionActions")}
        onClick={() => {
          setActiveTab("branch");
          setModalOpen(true);
        }}
      >
        <span className="conversation-header-ai-button-label">...</span>
      </button>

      <WorkbenchModal
        open={modalOpen}
        title={t("conversation.moreSessionActionsTitle")}
        description={t("conversation.moreSessionActionsDescription")}
        className="conversation-mobile-session-actions-modal"
        onClose={() => setModalOpen(false)}
      >
        <div className="conversation-mobile-session-actions">
          <div
            className="conversation-mobile-session-actions-tabs"
            role="tablist"
            aria-label={t("conversation.moreSessionActionsTitle")}
          >
            <button
              type="button"
              className={
                activeTab === "branch"
                  ? "conversation-mobile-session-actions-tab active"
                  : "conversation-mobile-session-actions-tab"
              }
              role="tab"
              aria-selected={activeTab === "branch"}
              onClick={() => setActiveTab("branch")}
            >
              {t("conversation.branchTreeTab")}
            </button>
            <button
              type="button"
              className={
                activeTab === "ai"
                  ? "conversation-mobile-session-actions-tab active"
                  : "conversation-mobile-session-actions-tab"
              }
              role="tab"
              aria-selected={activeTab === "ai"}
              onClick={() => setActiveTab("ai")}
            >
              {t("conversation.aiAssistantTab")}
            </button>
          </div>

          {activeTab === "branch" ? (
            <div className="conversation-mobile-session-actions-panel" role="tabpanel">
              <SessionBranchTreeExplorer
                model={model}
                onOpenSession={(targetSession) => {
                  setModalOpen(false);
                  onOpenSession(targetSession);
                }}
              />
            </div>
          ) : (
            <div className="conversation-mobile-session-actions-ai-panel" role="tabpanel">
              <p>{t("conversation.aiAssistantTabDescription")}</p>
              <SessionButlerActionButton session={session} />
            </div>
          )}
        </div>
      </WorkbenchModal>
    </>
  );
}
