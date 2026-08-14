import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderCapabilitiesDto, ProviderId } from "../api/conversation-api";
import { clearProviderCatalogStore } from "../capability/provider-catalog-store";
import {
  clearSessionProviderPickerCapabilityCache,
  SessionProviderPicker
} from "./SessionProviderPicker";

const mockGetProviderCapabilities = vi.fn();
const mockListProviderCatalog = vi.fn();

vi.mock("../api/conversation-api", async () => {
  const actual = await vi.importActual("../api/conversation-api");
  return {
    ...actual,
    listProviderCatalog: (...args: unknown[]) => mockListProviderCatalog(...args),
    getProviderCapabilities: (...args: unknown[]) => mockGetProviderCapabilities(...args)
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
    mockGetProviderCapabilities.mockReset();
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
    mockGetProviderCapabilities.mockResolvedValue(
      createUnavailableCapabilities("gemini", "未检测到 Gemini CLI")
    );

    const firstRender = render(
      <SessionProviderPicker
        workspaceId="workspace-picker-cache"
        providers={["gemini"]}
        onSelect={() => undefined}
      />
    );

    expect(screen.getByText(/检查中|Checking/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(mockGetProviderCapabilities).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByText("未检测到 Gemini CLI")).toBeInTheDocument();
    });

    firstRender.unmount();
    mockGetProviderCapabilities.mockClear();

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
    expect(mockGetProviderCapabilities).not.toHaveBeenCalled();
  });


  it("PeerHOST 下 provider catalog 和能力请求都会带 targetHostId", async () => {
    mockGetProviderCapabilities.mockResolvedValue(
      createUnavailableCapabilities("gemini", "远端未检测到 Gemini CLI")
    );

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
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith(
        "gemini",
        "remote-workspace-1",
        undefined,
        { targetHostId: "peer-host-1" }
      );
    });
  });

  it("targetHostId 是 current 时会归一化成主 HOST 请求，不会把 current 当成真实 hostId", async () => {
    mockGetProviderCapabilities.mockResolvedValue(
      createUnavailableCapabilities("gemini", "主 HOST 未检测到 Gemini CLI")
    );

    render(
      <SessionProviderPicker
        workspaceId="workspace-picker-current-host"
        targetHostId="current"
        providers={["gemini"]}
        onSelect={() => undefined}
      />
    );

    await waitFor(() => {
      expect(mockListProviderCatalog).toHaveBeenCalledWith({
        targetHostId: null
      });
    });
    await waitFor(() => {
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith(
        "gemini",
        "workspace-picker-current-host",
        undefined,
        { targetHostId: null }
      );
    });
  });

  it("targetHostId 为空白时也会归一化成主 HOST 请求", async () => {
    mockGetProviderCapabilities.mockResolvedValue(
      createUnavailableCapabilities("gemini", "主 HOST 未检测到 Gemini CLI")
    );

    render(
      <SessionProviderPicker
        workspaceId="workspace-picker-empty-host"
        targetHostId="   "
        providers={["gemini"]}
        onSelect={() => undefined}
      />
    );

    await waitFor(() => {
      expect(mockListProviderCatalog).toHaveBeenCalledWith({
        targetHostId: null
      });
    });
    await waitFor(() => {
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith(
        "gemini",
        "workspace-picker-empty-host",
        undefined,
        { targetHostId: null }
      );
    });
  });

  it("清掉 provider picker 缓存后会重新请求能力", async () => {
    mockGetProviderCapabilities.mockResolvedValue(
      createUnavailableCapabilities("gemini", "未检测到 Gemini CLI")
    );

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
    mockGetProviderCapabilities.mockClear();

    render(
      <SessionProviderPicker
        workspaceId="workspace-picker-cache-reset"
        providers={["gemini"]}
        onSelect={() => undefined}
      />
    );

    expect(screen.getByText(/检查中|Checking/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(mockGetProviderCapabilities).toHaveBeenCalledTimes(1);
    });
  });

  it("供应商能力请求失败时，不再永远显示检查中，而是用 fallback 让卡片可操作", async () => {
    // 模拟供应商的能力请求失败
    mockGetProviderCapabilities.mockRejectedValue(new Error("network error"));

    render(
      <SessionProviderPicker
        workspaceId="workspace-picker-all-failed"
        providers={["gemini"]}
        onSelect={() => undefined}
      />
    );

    // 初始阶段应该显示检查中
    expect(screen.getByText(/检查中|Checking/i)).toBeInTheDocument();

    // 等待请求完成后，检查中应该消失，卡片应该可点击（fallback 的 canStartSession = true）
    await waitFor(() => {
      expect(screen.queryByText(/检查中|Checking/i)).not.toBeInTheDocument();
    });

    const card = screen.getByRole("button", { name: "Gemini" });
    expect(card).toBeEnabled();
  });

  it("逐个完成：每个供应商能力请求完成后立即刷新对应卡片", async () => {
    mockListProviderCatalog.mockResolvedValueOnce([
      { provider: "gemini", enabled: true },
      { provider: "codex", enabled: true }
    ]);

    // gemini 快速返回，codex 慢返回
    let resolveCodex: ((value: ProviderCapabilitiesDto) => void) | null = null;
    mockGetProviderCapabilities.mockImplementation((provider: string) => {
      if (provider === "gemini") {
        return Promise.resolve(createUnavailableCapabilities("gemini", "未检测到 Gemini CLI"));
      }
      return new Promise((resolve) => { resolveCodex = resolve; });
    });

    render(
      <SessionProviderPicker
        workspaceId="workspace-picker-streaming"
        providers={["gemini", "codex"]}
        onSelect={() => undefined}
      />
    );

    // gemini 先完成，codex 还在检查中
    await waitFor(() => {
      expect(screen.getByText("未检测到 Gemini CLI")).toBeInTheDocument();
    });
    const codexCard = screen.getByRole("button", { name: "Codex" });
    // codex 还没有能力数据，应该显示检查中
    expect(codexCard).toHaveAttribute("data-pending", "false");

    // codex 完成
    resolveCodex?.(createUnavailableCapabilities("codex", "未检测到 Codex CLI"));

    await waitFor(() => {
      expect(screen.getByText("未检测到 Codex CLI")).toBeInTheDocument();
    });
    // 所有供应商都完成了，不再有任何检查中
    expect(screen.queryByText(/检查中|Checking/i)).not.toBeInTheDocument();
  });

  it("部分供应商能力请求失败时，失败的供应商不会永远显示检查中", async () => {
    mockListProviderCatalog.mockResolvedValueOnce([
      { provider: "gemini", enabled: true },
      { provider: "codex", enabled: true }
    ]);
    // 按 provider 名称匹配，不受调用顺序影响
    mockGetProviderCapabilities.mockImplementation((provider: string) => {
      if (provider === "gemini") {
        return Promise.reject(new Error("gemini timeout"));
      }
      return Promise.resolve(createUnavailableCapabilities("codex", "未检测到 Codex CLI"));
    });

    render(
      <SessionProviderPicker
        workspaceId="workspace-picker-partial-failed"
        providers={["gemini", "codex"]}
        onSelect={() => undefined}
      />
    );

    // 等待请求完成后，两个供应商都不应该显示检查中
    await waitFor(() => {
      expect(screen.queryByText(/检查中|Checking/i)).not.toBeInTheDocument();
    });

    // codex 成功获取到了能力，显示禁用原因
    expect(screen.getByText("未检测到 Codex CLI")).toBeInTheDocument();
    // gemini 请求失败用了 fallback（canStartSession = true），卡片可操作
    const geminiCard = screen.getByRole("button", { name: "Gemini" });
    expect(geminiCard).toBeEnabled();
  });

  it("不同 targetHostId 不会复用同一份 provider 能力缓存", async () => {
    mockGetProviderCapabilities
      .mockResolvedValueOnce(
        createUnavailableCapabilities("gemini", "主 HOST 不可用")
      )
      .mockResolvedValueOnce(
        createUnavailableCapabilities("gemini", "Peer HOST 不可用")
      );

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
    expect(mockGetProviderCapabilities).toHaveBeenCalledTimes(2);
    expect(mockGetProviderCapabilities).toHaveBeenNthCalledWith(
      1,
      "gemini",
      "workspace-picker-host-split",
      undefined,
      { targetHostId: null }
    );
    expect(mockGetProviderCapabilities).toHaveBeenNthCalledWith(
      2,
      "gemini",
      "workspace-picker-host-split",
      undefined,
      { targetHostId: "peer-host-1" }
    );
  });

  it("会把 catalog 中已禁用的 provider 从创建入口里隐藏", async () => {
    mockListProviderCatalog.mockResolvedValueOnce([
      { provider: "codex", enabled: true },
      { provider: "gemini", enabled: false }
    ]);
    mockGetProviderCapabilities.mockResolvedValue(
      createUnavailableCapabilities("codex", "未检测到 Codex CLI")
    );

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

  it("会显示 catalog 中启用的 DeepSeek Harness，并请求对应能力", async () => {
    mockListProviderCatalog.mockResolvedValueOnce([
      { provider: "deepseek-harness", enabled: true }
    ]);
    mockGetProviderCapabilities.mockResolvedValue(
      createUnavailableCapabilities("deepseek-harness", "未检测到 DeepSeek Harness sidecar")
    );

    render(
      <SessionProviderPicker
        workspaceId="workspace-picker-deepseek"
        onSelect={() => undefined}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "DeepSeek Harness" })).toBeInTheDocument();
    });
    expect(mockGetProviderCapabilities).toHaveBeenCalledWith(
      "deepseek-harness",
      "workspace-picker-deepseek",
      undefined,
      { targetHostId: null }
    );
  });

  it("catalog 还没返回前不会先把全部 provider 渲染出来", () => {
    let resolveCatalog: ((value: Array<{ provider: string; enabled: boolean }>) => void) | null = null;
    mockListProviderCatalog.mockReturnValue(
      new Promise((resolve) => {
        resolveCatalog = resolve;
      })
    );
    mockGetProviderCapabilities.mockResolvedValue({});

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
