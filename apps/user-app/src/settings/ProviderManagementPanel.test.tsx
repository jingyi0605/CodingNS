import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { authStore } from "../features/auth/store/auth-store";
import { clearProviderCatalogStore } from "../features/conversation/capability/provider-catalog-store";
import { PlatformProvider } from "../platform/platform-provider";
import { I18nProvider, t } from "../shared/i18n";
import { ProviderManagementPanel } from "./ProviderManagementPanel";

const originalFetch = global.fetch;
const { clearSessionProviderPickerCapabilityCacheMock } = vi.hoisted(() => ({
  clearSessionProviderPickerCapabilityCacheMock: vi.fn()
}));

vi.mock("../features/conversation/components/SessionProviderPicker", () => ({
  clearSessionProviderPickerCapabilityCache: clearSessionProviderPickerCapabilityCacheMock
}));

describe("ProviderManagementPanel", () => {
  beforeEach(() => {
    clientConfigStore.hydrate({
      platform: "web",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    authStore.hydrate(createAuthSession());
    clearSessionProviderPickerCapabilityCacheMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    authStore.clear();
    clearProviderCatalogStore();
  });

  it("设置页先显示入口按钮，打开后再展示能力矩阵", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/providers/catalog") && method === "GET") {
        return createJsonResponse({
          items: createProviderCatalogResponse()
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    renderPanel();

    expect(screen.getByRole("button", { name: t("settings.providerManagementManageAction") })).toBeInTheDocument();
    expect(screen.queryByText("Codex")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("settings.providerManagementManageAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.providerManagementModalTitle") });
    await waitFor(() => {
      expect(within(dialog).getByText("Codex")).toBeInTheDocument();
    });

    const summaryGrid = within(dialog).getByLabelText(t("settings.providerManagementSummaryTitle"));
    expect(summaryGrid).toBeInTheDocument();
    expect(within(dialog).queryByText(t("settings.providerManagementModalDescription"))).not.toBeInTheDocument();
    expect(within(summaryGrid).getByText(t("settings.providerManagementSummaryEnabled"))).toBeInTheDocument();
    expect(within(summaryGrid).getByText(t("settings.providerManagementSummaryDisabled"))).toBeInTheDocument();
    expect(within(summaryGrid).getByText(t("settings.providerManagementSummaryTotal"))).toBeInTheDocument();
    expect(within(summaryGrid).getByText("2")).toBeInTheDocument();
    expect(within(summaryGrid).getByText("1")).toBeInTheDocument();
    expect(within(summaryGrid).getByText("3")).toBeInTheDocument();
    expect(within(dialog).getByText("Claude Code")).toBeInTheDocument();
    expect(within(dialog).getByText("OpenCode")).toBeInTheDocument();
    expect(within(dialog).getByText("1.8.0")).toBeInTheDocument();
    expect(within(dialog).getByText("1.7.5")).toBeInTheDocument();
    expect(within(dialog).getByText("1.4.2")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("columnheader", {
        name: t("settings.providerManagementCapabilityStreaming")
      })
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("columnheader", {
        name: t("settings.providerManagementTableStatus")
      })
    ).toBeInTheDocument();
    expect(dialog.querySelector(".settings-provider-matrix-provider-note")).toBeNull();
    expect(dialog.querySelector(".settings-provider-matrix-status-text")).toBeNull();

    const opencodeRow = within(dialog).getByText("OpenCode").closest("tr");
    expect(opencodeRow).not.toBeNull();
    expect(
      (opencodeRow as HTMLTableRowElement).querySelectorAll(".settings-provider-matrix-capability").length
    ).toBe(4);
  });

  it("切换 provider 启用态会调用更新接口并清理 capability 缓存", async () => {
    let latestPayload: unknown = null;

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/providers/catalog") && method === "GET") {
        return createJsonResponse({
          items: createProviderCatalogResponse()
        });
      }

      if (url.endsWith("/api/providers/catalog/claude-code") && method === "PUT") {
        latestPayload = JSON.parse(String(init?.body));
        return createJsonResponse({
          item: createProviderCatalogEntry("claude-code", false)
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: t("settings.providerManagementManageAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.providerManagementModalTitle") });
    await waitFor(() => {
      expect(within(dialog).getByText("Claude Code")).toBeInTheDocument();
    });
    const toggle = within(dialog).getByRole("checkbox", {
      name: t("settings.providerManagementToggleLabel", { provider: "Claude Code" })
    });
    expect(toggle).toBeChecked();

    await userEvent.click(toggle);

    await waitFor(() => {
      expect(latestPayload).toEqual({ enabled: false });
    });
    expect(clearSessionProviderPickerCapabilityCacheMock).toHaveBeenCalledTimes(1);
    expect(
      within(dialog).getByText(t("settings.providerManagementDisableSuccess", { provider: "Claude Code" }))
    ).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
  });

  it("刷新列表会调用显式刷新接口，而不是普通 catalog 读取", async () => {
    const requests: Array<{ method: string; url: string }> = [];

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      requests.push({ method, url });

      if (url.endsWith("/api/providers/catalog") && method === "GET") {
        return createJsonResponse({
          items: createProviderCatalogResponse()
        });
      }

      if (url.endsWith("/api/providers/catalog/refresh") && method === "POST") {
        return createJsonResponse({
          items: createProviderCatalogResponse()
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: t("settings.providerManagementManageAction") }));
    const dialog = await screen.findByRole("dialog", { name: t("settings.providerManagementModalTitle") });

    await userEvent.click(within(dialog).getAllByRole("button", { name: t("settings.providerManagementRefresh") })[0]!);

    await waitFor(() => {
      expect(
        requests.some((request) =>
          request.method === "POST" && request.url.endsWith("/api/providers/catalog/refresh")
        )
      ).toBe(true);
    });
  });
});

function renderPanel() {
  return render(
    <PlatformProvider>
      <I18nProvider language={clientConfigStore.getState().language}>
        <ProviderManagementPanel />
      </I18nProvider>
    </PlatformProvider>
  );
}

function createAuthSession() {
  return {
    accessToken: "token-1",
    refreshToken: "refresh-1",
    expiresIn: 3600,
    user: {
      userId: "user-1",
      username: "tester",
      role: "admin" as const
    }
  };
}

function createJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function createProviderCatalogResponse() {
  return [
    createProviderCatalogEntry("codex", true),
    createProviderCatalogEntry("claude-code", true),
    createProviderCatalogEntry("opencode", false)
  ];
}

function createProviderCatalogEntry(
  provider: "codex" | "claude-code" | "opencode",
  enabled: boolean
) {
  const displayName = provider === "claude-code"
    ? "Claude Code"
    : provider === "opencode"
      ? "OpenCode"
      : "Codex";

  return {
    provider,
    displayName,
    enabled,
    installState: "ready" as const,
    disableImpact: {
      hidesSessions: true,
      blocksSessionStart: true,
      blocksFork: true,
      blocksAssistant: provider !== "opencode",
      blocksSkillTargets: true
    },
    capabilities: {
      provider,
      canStartSession: enabled,
      canResumeSession: enabled,
      canSendMessage: enabled,
      supportsStructuredToolCalls: true,
      supportsPermissionPrompt: true,
      supportsCheckpoint: false,
      supportsSubagents: provider === "codex",
      limitations: []
    },
    productCapabilities: {
      streamingOutput: true,
      toolCalls: true,
      assistantService: provider !== "opencode" && enabled,
      sessionFork: true,
      skillUsage: true
    },
    version: provider === "claude-code" ? "1.7.5" : provider === "opencode" ? "1.4.2" : "1.8.0"
  };
}
