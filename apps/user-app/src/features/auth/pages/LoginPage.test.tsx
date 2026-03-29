import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import { serverConfigStore } from "../../../config/server-config";
import { PlatformProvider } from "../../../platform/platform-provider";
import { I18nProvider, t } from "../../../shared/i18n";
import { ThemeProvider } from "../../../shared/theme";
import { AppVersionProvider } from "../../../shared/version/app-version";
import { LoginPage } from "./LoginPage";

const originalFetch = global.fetch;
const originalTauriInternals = window.__TAURI_INTERNALS__;
const userAgentDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
const platformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "platform");
const maxTouchPointsDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "maxTouchPoints");

function mockNavigator({
  userAgent,
  platform,
  maxTouchPoints = 0
}: {
  userAgent: string;
  platform: string;
  maxTouchPoints?: number;
}) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: userAgent
  });
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: platform
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: maxTouchPoints
  });
}

describe("LoginPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clientConfigStore.hydrate({
      platform: "web",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    serverConfigStore.reset();
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/api/public/bootstrap-status")) {
        return createJsonResponse({ initialized: true });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();

    if (userAgentDescriptor) {
      Object.defineProperty(window.navigator, "userAgent", userAgentDescriptor);
    }

    if (platformDescriptor) {
      Object.defineProperty(window.navigator, "platform", platformDescriptor);
    }

    if (maxTouchPointsDescriptor) {
      Object.defineProperty(window.navigator, "maxTouchPoints", maxTouchPointsDescriptor);
    }

    if (originalTauriInternals) {
      window.__TAURI_INTERNALS__ = originalTauriInternals;
      return;
    }

    delete window.__TAURI_INTERNALS__;
  });

  it("Web 登录页不显示保存密码选项，密码默认为空", async () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      platform: "MacIntel"
    });
    delete window.__TAURI_INTERNALS__;

    renderLoginPage();

    await screen.findByText(t("auth.loginTitle"));

    const passwordInput = screen.getByLabelText(t("auth.password")) as HTMLInputElement;

    expect(passwordInput.value).toBe("");
    expect(screen.queryByRole("checkbox", { name: t("auth.rememberPassword") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: new RegExp(t("auth.serverSettings")) })).not.toBeInTheDocument();
    expect(screen.getByText(`v${__APP_VERSION__}`)).toBeInTheDocument();
  });

  it("Windows 客户端会显示保存密码并回填已保存凭据", async () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      platform: "Win32"
    });
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    window.localStorage.setItem(
      "codingns.auth.remembered-login",
      JSON.stringify({
        username: "saved-admin",
        password: "Saved123!",
        serverBaseUrl: "http://10.10.1.8:4100"
      })
    );

    renderLoginPage();

    const checkbox = (await screen.findByRole("checkbox", {
      name: t("auth.rememberPassword")
    })) as HTMLInputElement;
    const usernameInput = screen.getByLabelText(t("auth.username")) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(t("auth.password")) as HTMLInputElement;

    expect(checkbox.checked).toBe(true);
    expect(usernameInput.value).toBe("saved-admin");
    expect(passwordInput.value).toBe("Saved123!");

    await waitFor(() => {
      expect(clientConfigStore.getState().hostBaseUrl).toBe("http://10.10.1.8:4100");
    });

    expect(screen.getByRole("button", { name: new RegExp(t("auth.serverSettings")) })).toBeInTheDocument();
  });

  it("iOS 客户端登录页也允许打开服务器设置", async () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone"
    });
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };
    clientConfigStore.hydrate({
      platform: "ios",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: false,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });

    renderLoginPage();

    expect(
      await screen.findByRole("button", { name: new RegExp(t("auth.serverSettings")) })
    ).toBeInTheDocument();
  });

  it("登录页修改服务器后，不会再被记住密码里的旧服务器地址回滚", async () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      platform: "Win32"
    });
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn()
    };
    clientConfigStore.hydrate({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      language: "zh-CN",
      defaultPermissionMode: "default"
    });
    window.localStorage.setItem(
      "codingns.auth.remembered-login",
      JSON.stringify({
        username: "saved-admin",
        password: "Saved123!",
        serverBaseUrl: "http://10.10.1.8:4100"
      })
    );

    renderLoginPage();

    await waitFor(() => {
      expect(clientConfigStore.getState().hostBaseUrl).toBe("http://10.10.1.8:4100");
    });

    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("auth.serverSettings")) }));

    const addressInput = await screen.findByRole("textbox", { name: t("auth.serverAddress") });
    const saveButton = screen.getByRole("button", { name: t("auth.saveServerSettings") });

    await userEvent.clear(addressInput);
    await userEvent.type(addressInput, "10.10.1.9:4200");
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(clientConfigStore.getState().hostBaseUrl).toBe("http://10.10.1.9:4200");
    });

    await waitFor(() => {
      expect(
        JSON.parse(window.localStorage.getItem("codingns.auth.remembered-login") ?? "null")
      ).toMatchObject({
        serverBaseUrl: "http://10.10.1.9:4200"
      });
    });
  });
});

function renderLoginPage() {
  return render(
    <PlatformProvider>
      <AppVersionProvider>
        <I18nProvider language={clientConfigStore.getState().language}>
          <ThemeProvider>
            <MemoryRouter initialEntries={["/login"]}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
              </Routes>
            </MemoryRouter>
          </ThemeProvider>
        </I18nProvider>
      </AppVersionProvider>
    </PlatformProvider>
  );
}

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
