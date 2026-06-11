import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { useWorkbenchShell } from "../conversation/components/WorkbenchLayout";
import {
  AffairsLightweightConversationDraftState,
  AffairsLightweightConversationLiveState,
  AffairsWorkbenchProvider,
  buildAffairsConversationDraftNodeId,
  buildAffairsConversationSessionNodeId
} from "../workbench/components/AffairsWorkbenchView";
import { buildWorkspaceChatPath } from "../workbench/utils/workbench-navigation";
import { createDefaultAffairsViewState } from "../workbench/utils/workbench-mode";
import type { AffairsViewState } from "../workbench/types/workbench-mode";

const DEFAULT_LIGHTWEIGHT_PROVIDER = "codex" as const;

function resolveLightweightProviderFromSearch(search: string): "codex" | "claude-code" {
  const provider = new URLSearchParams(search).get("provider")?.trim();
  return provider === "claude-code" ? "claude-code" : DEFAULT_LIGHTWEIGHT_PROVIDER;
}

function resolveLightweightChatSessionId(nodeId: string | null | undefined): string | null {
  const normalizedNodeId = nodeId?.trim() ?? "";
  const prefix = "conversation:lightweight:session:";

  if (!normalizedNodeId.startsWith(prefix)) {
    return null;
  }

  return normalizedNodeId.slice(prefix.length).trim() || null;
}

export function PureConversationPage() {
  const params = useParams<{ workspaceId?: string; chatId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    navigationGroups,
    currentWorkspaceRef,
    currentWorkspaceId,
    refreshNavigation
  } = useWorkbenchShell();
  const workspaceId = params.workspaceId?.trim() || currentWorkspaceId;
  const routeChatId = params.chatId?.trim() ?? null;
  const isNewChat = !routeChatId || routeChatId === "new";
  const workspaceName = useMemo(
    () => navigationGroups.find((group) => group.workspace.id === workspaceId)?.workspace.name ?? null,
    [navigationGroups, workspaceId]
  );
  const lightweightProvider = useMemo(
    () => resolveLightweightProviderFromSearch(location.search),
    [location.search]
  );
  const lightweightDraft = useMemo(
    () => ({ kind: "lightweight" as const, provider: lightweightProvider }),
    [lightweightProvider]
  );
  const selectedNodeId = isNewChat
    ? buildAffairsConversationDraftNodeId(lightweightDraft)
    : buildAffairsConversationSessionNodeId("lightweight", routeChatId);
  const state = useMemo<AffairsViewState | null>(() => {
    if (!workspaceId) {
      return null;
    }

    return {
      ...createDefaultAffairsViewState(workspaceId),
      primarySection: "conversation",
      selectedNodeId,
      selectedObjectId: null,
      selectedDocumentId: null,
      pendingLibraryPreview: null
    };
  }, [selectedNodeId, workspaceId]);
  const handleStateChange = useCallback((nextState: AffairsViewState) => {
    const nextSessionId = resolveLightweightChatSessionId(nextState.selectedNodeId);

    if (workspaceId && nextSessionId && nextSessionId !== routeChatId) {
      navigate(buildWorkspaceChatPath(workspaceId, nextSessionId, currentWorkspaceRef), { replace: true });
      return;
    }

  }, [currentWorkspaceRef, navigate, routeChatId, workspaceId]);

  if (!workspaceId || !state) {
    return null;
  }

  return (
    <AffairsWorkbenchProvider
      workspaceId={workspaceId}
      workspaceName={workspaceName}
      navigationGroups={navigationGroups}
      state={state}
      onStateChange={handleStateChange}
      onRefreshNavigation={refreshNavigation}
      forceRoute={false}
    >
      {isNewChat ? (
        <AffairsLightweightConversationDraftState workspaceId={workspaceId} draft={lightweightDraft} />
      ) : (
        <AffairsLightweightConversationLiveState sessionId={routeChatId} runtimeSeed={null} />
      )}
    </AffairsWorkbenchProvider>
  );
}
