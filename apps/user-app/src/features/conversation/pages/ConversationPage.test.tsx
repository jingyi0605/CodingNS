import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationPage } from "./ConversationPage";

const mockGetProviderCapabilities = vi.fn();
const mockUseWorkbenchShell = vi.fn();

vi.mock("../api/conversation-api", async () => {
  const actual = await vi.importActual<typeof import("../api/conversation-api")>(
    "../api/conversation-api"
  );

  return {
    ...actual,
    getProviderCapabilities: (...args: unknown[]) => mockGetProviderCapabilities(...args)
  };
});

vi.mock("../components/WorkbenchLayout", () => ({
  useWorkbenchShell: () => mockUseWorkbenchShell()
}));

vi.mock("../components/ConnectionBanner", () => ({
  ConnectionBanner: () => null
}));

vi.mock("../components/MessageTimeline", () => ({
  MessageTimeline: () => null
}));

vi.mock("../components/SessionHeader", () => ({
  SessionHeader: () => null
}));

vi.mock("../components/ComposerPanel", () => ({
  ComposerPanel: ({ capabilities }: { capabilities: { modelOptions?: Array<{ id: string }> } | null }) => (
    <div data-testid="composer-model-options">
      {capabilities?.modelOptions?.map((item) => item.id).join(",") ?? ""}
    </div>
  )
}));

describe("ConversationPage", () => {
  beforeEach(() => {
    mockGetProviderCapabilities.mockReset();
    mockUseWorkbenchShell.mockReset();
    mockUseWorkbenchShell.mockReturnValue({
      shellMode: "desktop",
      navigationGroups: [],
      requestNavigationRefresh: vi.fn(),
      setSessionWorkspace: vi.fn(),
      upsertNavigationSession: vi.fn(),
      favoriteSessions: []
    });
  });

  it("草稿会话会按 provider 和 workspace 拉取真实能力，并替换默认模型列表", async () => {
    mockGetProviderCapabilities.mockResolvedValue({
      provider: "codex",
      canStartSession: true,
      canResumeSession: true,
      canSendMessage: true,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: true,
      supportsStructuredToolCalls: true,
      supportsTokenUsage: true,
      supportsAttachments: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      modelOptions: [
        {
          id: "provider-default",
          name: "跟随 CLI 默认模型",
          usesProviderDefault: true
        },
        {
          id: "gpt-5.4",
          name: "gpt-5.4"
        }
      ],
      limitations: []
    });

    render(
      <MemoryRouter
        initialEntries={["/workspaces/workspace-1/sessions/draft-codex-1?provider=codex&workspaceId=workspace-1"]}
      >
        <Routes>
          <Route
            path="/workspaces/:workspaceId/sessions/:sessionId"
            element={<ConversationPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    // 首屏先用草稿兜底能力，避免界面空白。
    expect(screen.getByTestId("composer-model-options")).toHaveTextContent("provider-default");

    await waitFor(() => {
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith("codex", "workspace-1");
    });

    await waitFor(() => {
      expect(screen.getByTestId("composer-model-options")).toHaveTextContent(
        "provider-default,gpt-5.4"
      );
    });
  });
});
