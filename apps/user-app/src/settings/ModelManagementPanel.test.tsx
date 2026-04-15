import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { authStore } from "../features/auth/store/auth-store";
import { I18nProvider, t } from "../shared/i18n";
import { ModelManagementPanel } from "./ModelManagementPanel";

const originalFetch = global.fetch;
const { clearSessionProviderPickerCapabilityCacheMock } = vi.hoisted(() => ({
  clearSessionProviderPickerCapabilityCacheMock: vi.fn()
}));

vi.mock("../features/conversation/components/SessionProviderPicker", () => ({
  clearSessionProviderPickerCapabilityCache: clearSessionProviderPickerCapabilityCacheMock
}));

describe("ModelManagementPanel", () => {
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
  });

  it("设置页只显示当前配置，并在模态框里切换到新预设", async () => {
    let currentPresetId = "preset-codex-1";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/system/model-switch") && method === "GET") {
        return createJsonResponse(createModelSnapshotResponse(currentPresetId));
      }

      if (url.endsWith("/api/system/model-switch") && method === "POST") {
        expect(JSON.parse(String(init?.body))).toEqual({
          app: "codex",
          presetId: "preset-codex-2"
        });
        currentPresetId = "preset-codex-2";
        return createJsonResponse(createCodexSnapshot(currentPresetId));
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    renderPanel();

    expect(await screen.findByText("Codex")).toBeInTheDocument();
    const codexCard = screen.getByText("Codex").closest(".settings-model-card");
    expect(codexCard).not.toBeNull();

    const card = codexCard as HTMLElement;
    expect(screen.queryByText(t("settings.modelManagementTitle"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("settings.modelManagementDescription"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("settings.modelManagementScannedAt"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("settings.modelManagementRefresh") })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: t("settings.modelManagementOpenSwitcher") })).toHaveLength(1);
    expect(within(card).queryByRole("button", { name: t("settings.modelManagementOpenSwitcher") })).not.toBeInTheDocument();
    expect(within(card).getByText("生产预设")).toBeInTheDocument();
    expect(within(card).getByText("GPT-5")).toBeInTheDocument();
    expect(within(card).queryByText("当前配置文件")).not.toBeInTheDocument();
    expect(within(card).queryByText("当前模型")).not.toBeInTheDocument();
    expect(within(card).queryByText("实验预设")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("settings.modelManagementOpenSwitcher") }));

    const dialog = await screen.findByRole("dialog", {
      name: t("settings.modelManagementModalTitle")
    });
    expect(within(dialog).getByRole("tab", { name: "Codex" })).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByText("实验预设")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("settings.modelManagementRefresh") })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: t("settings.modelManagementSwitchAction") }));

    await waitFor(() => {
      expect(within(card).getByText("GPT-5.1")).toBeInTheDocument();
    });
    expect(within(card).getByText("实验预设")).toBeInTheDocument();
    expect(screen.getByText("Codex 已切换到 实验预设。")).toBeInTheDocument();
    expect(clearSessionProviderPickerCapabilityCacheMock).toHaveBeenCalledTimes(1);
  });
});

function renderPanel() {
  return render(
    <I18nProvider language={clientConfigStore.getState().language}>
      <ModelManagementPanel />
    </I18nProvider>
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

function createModelSnapshotResponse(currentPresetId: string) {
  return {
    items: [
      createCodexSnapshot(currentPresetId),
      {
        app: "claude-code",
        displayName: "Claude Code",
        cliAvailable: true,
        status: "unconfigured",
        statusText: "当前还没有可切换的预设",
        currentPresetId: null,
        currentPresetName: null,
        currentModel: null,
        options: []
      },
      {
        app: "gemini",
        displayName: "Gemini",
        cliAvailable: false,
        status: "unavailable",
        statusText: "当前机器未找到 cc-switch 命令",
        currentPresetId: null,
        currentPresetName: null,
        currentModel: null,
        options: []
      },
      {
        app: "opencode",
        displayName: "OpenCode",
        cliAvailable: true,
        status: "error",
        statusText: "数据库读取失败",
        currentPresetId: null,
        currentPresetName: null,
        currentModel: null,
        options: []
      }
    ],
    scannedAt: "2026-04-15T10:00:00.000Z"
  };
}

function createCodexSnapshot(currentPresetId: string) {
  return {
    app: "codex",
    displayName: "Codex",
    cliAvailable: true,
    status: "ready",
    statusText: null,
    currentPresetId,
    currentPresetName: currentPresetId === "preset-codex-2" ? "实验预设" : "生产预设",
    currentModel: currentPresetId === "preset-codex-2" ? "GPT-5.1" : "GPT-5",
    options: [
      {
        id: "preset-codex-1",
        name: "生产预设",
        model: "GPT-5",
        summary: "稳定编码模型",
        isCurrent: currentPresetId === "preset-codex-1"
      },
      {
        id: "preset-codex-2",
        name: "实验预设",
        model: "GPT-5.1",
        summary: "新模型验证",
        isCurrent: currentPresetId === "preset-codex-2"
      }
    ]
  };
}
