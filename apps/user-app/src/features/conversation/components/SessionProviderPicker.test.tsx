import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderCapabilitiesDto, ProviderId } from "../api/conversation-api";
import { clearProviderCatalogStore } from "../capability/provider-catalog-store";
import {
  clearSessionProviderPickerCapabilityCache,
  SessionProviderPicker
} from "./SessionProviderPicker";

const mockListProviderCapabilities = vi.fn();
const mockListProviderCatalog = vi.fn();

vi.mock("../api/conversation-api", async () => {
  const actual = await vi.importActual("../api/conversation-api");
  return {
    ...actual,
    listProviderCatalog: (...args: unknown[]) => mockListProviderCatalog(...args),
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
    clearProviderCatalogStore();
    mockListProviderCatalog.mockReset();
    mockListProviderCapabilities.mockReset();
    mockListProviderCatalog.mockResolvedValue([
      {
        provider: "gemini",
        enabled: true
      }
    ]);
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

    expect(screen.getByText(/检查中|Checking/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(mockListProviderCapabilities).toHaveBeenCalledTimes(1);
    });

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

    await waitFor(() => {
      expect(screen.getByText("未检测到 Gemini CLI")).toBeInTheDocument();
    });
    expect(screen.queryByText(/检查中|Checking/i)).not.toBeInTheDocument();
    expect(mockListProviderCapabilities).not.toHaveBeenCalled();
  });


  it("PeerHOST 下 provider catalog 和能力请求都会带 targetHostId", async () => {
    mockListProviderCapabilities.mockResolvedValue({
      gemini: createUnavailableCapabilities("gemini", "远端未检测到 Gemini CLI")
    });

    render(
      <SessionProviderPicker
        workspaceId="remote-workspace-1"
        targetHostId="peer-host-1"
        providers={["gemini"]}
        onSelect={() => undefined}
      />
    );

    await waitFor(() => {
      expect(mockListProviderCatalog).toHaveBeenCalledWith({
        targetHostId: "peer-host-1"
      });
    });
    await waitFor(() => {
      expect(mockListProviderCapabilities).toHaveBeenCalledWith(
        ["gemini"],
        "remote-workspace-1",
        { targetHostId: "peer-host-1" }
      );
    });
  });

  it("清掉 provider picker 缓存后会重新请求能力", async () => {
    mockListProviderCapabilities.mockResolvedValue({
      gemini: createUnavailableCapabilities("gemini", "未检测到 Gemini CLI")
    });

    const firstRender = render(
      <SessionProviderPicker
        workspaceId="workspace-picker-cache-reset"
        providers={["gemini"]}
        onSelect={() => undefined}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("未检测到 Gemini CLI")).toBeInTheDocument();
    });

    firstRender.unmount();
    clearSessionProviderPickerCapabilityCache();
    mockListProviderCapabilities.mockClear();

    render(
      <SessionProviderPicker
        workspaceId="workspace-picker-cache-reset"
        providers={["gemini"]}
        onSelect={() => undefined}
      />
    );

    expect(screen.getByText(/检查中|Checking/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(mockListProviderCapabilities).toHaveBeenCalledTimes(1);
    });
  });

  it("不同 targetHostId 不会复用同一份 provider 能力缓存", async () => {
    mockListProviderCapabilities
      .mockResolvedValueOnce({
        gemini: createUnavailableCapabilities("gemini", "主 HOST 不可用")
      })
      .mockResolvedValueOnce({
        gemini: createUnavailableCapabilities("gemini", "Peer HOST 不可用")
      });

    const firstRender = render(
      <SessionProviderPicker
        workspaceId="workspace-picker-host-split"
        targetHostId={null}
        providers={["gemini"]}
        onSelect={() => undefined}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("主 HOST 不可用")).toBeInTheDocument();
    });

    firstRender.unmount();

    render(
      <SessionProviderPicker
        workspaceId="workspace-picker-host-split"
        targetHostId="peer-host-1"
        providers={["gemini"]}
        onSelect={() => undefined}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Peer HOST 不可用")).toBeInTheDocument();
    });
    expect(mockListProviderCapabilities).toHaveBeenCalledTimes(2);
    expect(mockListProviderCapabilities).toHaveBeenNthCalledWith(
      1,
      ["gemini"],
      "workspace-picker-host-split",
      { targetHostId: null }
    );
    expect(mockListProviderCapabilities).toHaveBeenNthCalledWith(
      2,
      ["gemini"],
      "workspace-picker-host-split",
      { targetHostId: "peer-host-1" }
    );
  });

  it("会把 catalog 中已禁用的 provider 从创建入口里隐藏", async () => {
    mockListProviderCatalog.mockResolvedValueOnce([
      { provider: "codex", enabled: true },
      { provider: "gemini", enabled: false }
    ]);
    mockListProviderCapabilities.mockResolvedValue({});

    render(
      <SessionProviderPicker
        workspaceId="workspace-picker-catalog"
        providers={["codex", "gemini"]}
        onSelect={() => undefined}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Codex" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Gemini" })).not.toBeInTheDocument();
  });

  it("catalog 还没返回前不会先把全部 provider 渲染出来", () => {
    let resolveCatalog: ((value: Array<{ provider: string; enabled: boolean }>) => void) | null = null;
    mockListProviderCatalog.mockReturnValue(
      new Promise((resolve) => {
        resolveCatalog = resolve;
      })
    );
    mockListProviderCapabilities.mockResolvedValue({});

    render(
      <SessionProviderPicker
        workspaceId="workspace-picker-pending-catalog"
        providers={["codex", "gemini"]}
        onSelect={() => undefined}
      />
    );

    expect(screen.queryByRole("button", { name: "Codex" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gemini" })).not.toBeInTheDocument();
    expect(screen.getByText(/检查中|Checking/i)).toBeInTheDocument();

    resolveCatalog?.([
      { provider: "codex", enabled: true },
      { provider: "gemini", enabled: false }
    ]);
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
