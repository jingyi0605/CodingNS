import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderCapabilitiesDto, ProviderId } from "../api/conversation-api";
import { SessionProviderPicker } from "./SessionProviderPicker";

const mockListProviderCapabilities = vi.fn();

vi.mock("../api/conversation-api", async () => {
  const actual = await vi.importActual("../api/conversation-api");
  return {
    ...actual,
    listProviderCapabilities: (...args: unknown[]) => mockListProviderCapabilities(...args)
  };
});

vi.mock("../../../shared/haptics", () => ({
  useHaptics: () => ({
    trigger: vi.fn().mockResolvedValue(undefined)
  })
}));

describe("SessionProviderPicker", () => {
  beforeEach(() => {
    mockListProviderCapabilities.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("同一工作区重复挂载时会复用能力缓存，不再重复显示检查中", async () => {
    mockListProviderCapabilities.mockResolvedValue({
      gemini: createUnavailableCapabilities("gemini", "未检测到 Gemini CLI")
    });

    const firstRender = render(
      <SessionProviderPicker
        workspaceId="workspace-picker-cache"
        providers={["gemini"]}
        onSelect={() => undefined}
      />
    );

    expect(screen.getByText("检查中...")).toBeInTheDocument();
    expect(mockListProviderCapabilities).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByText("未检测到 Gemini CLI")).toBeInTheDocument();
    });

    firstRender.unmount();
    mockListProviderCapabilities.mockClear();

    render(
      <SessionProviderPicker
        workspaceId="workspace-picker-cache"
        providers={["gemini"]}
        onSelect={() => undefined}
      />
    );

    expect(screen.getByText("未检测到 Gemini CLI")).toBeInTheDocument();
    expect(screen.queryByText("检查中...")).not.toBeInTheDocument();
    expect(mockListProviderCapabilities).not.toHaveBeenCalled();
  });
});

function createUnavailableCapabilities(
  provider: ProviderId,
  limitation: string
): ProviderCapabilitiesDto {
  return {
    provider,
    canStartSession: false,
    canResumeSession: false,
    canSendMessage: false,
    inRunInputMode: "none",
    supportsSubagents: false,
    supportsInterrupt: false,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: true,
    supportsAttachments: false,
    supportsPermissionPrompt: false,
    supportsCheckpoint: false,
    limitations: [limitation]
  };
}
