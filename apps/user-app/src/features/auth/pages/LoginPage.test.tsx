import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../../../config/client-config-store";
import { DEFAULT_HOST_PROFILE_ID, getActiveHostBaseUrl } from "../../../config/client-config-types";
import { serverConfigStore } from "../../../config/server-config";
import { authStore } from "../store/auth-store";
import { PlatformProvider } from "../../../platform/platform-provider";
import { userPreferenceStore } from "../../../preferences/user-preference-store";
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
    authStore.clear();
    document.head.innerHTML = `
      <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    `;
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
    authStore.clear();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    document.head.innerHTML = "";

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
    const viewportMeta = document.querySelector('meta[name="viewport"]');

    expect(passwordInput.value).toBe("");
    expect(screen.queryByRole("checkbox", { name: t("auth.rememberPassword") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: new RegExp(t("auth.serverSettings")) })).not.toBeInTheDocument();
    expect(screen.getByText(`v${__APP_VERSION__}`)).toBeInTheDocument();
    expect(viewportMeta?.getAttribute("content")).toBe(
      "width=device-width, initial-scale=1.0, viewport-fit=cover"
    );
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
        [DEFAULT_HOST_PROFILE_ID]: {
          hostId: DEFAULT_HOST_PROFILE_ID,
          username: "saved-admin",
          password: "Saved123!",
          savedAt: 1
        }
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

    expect(getActiveHostBaseUrl(clientConfigStore.getState())).toBe("http://127.0.0.1:3002");

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
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute("content")).toBe(
      "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
    );
  });

  it("登录页修改服务器后，不会再被当前 HOST 的记住密码配置回滚", async () => {
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
        [DEFAULT_HOST_PROFILE_ID]: {
          hostId: DEFAULT_HOST_PROFILE_ID,
          username: "saved-admin",
          password: "Saved123!",
          savedAt: 1
        }
      })
    );

    renderLoginPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("auth.serverSettings")) }));

    const addressInput = await screen.findByRole("textbox", { name: t("auth.serverAddress") });
    const saveButton = screen.getByRole("button", { name: t("auth.saveServerSettings") });

    await userEvent.clear(addressInput);
    await userEvent.type(addressInput, "10.10.1.9:4200");
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(getActiveHostBaseUrl(clientConfigStore.getState())).toBe("http://10.10.1.9:4200");
    });

    await waitFor(() => {
      expect(
        JSON.parse(window.localStorage.getItem("codingns.auth.remembered-login") ?? "null")
      ).toMatchObject({
        [DEFAULT_HOST_PROFILE_ID]: {
          hostId: DEFAULT_HOST_PROFILE_ID,
          username: "saved-admin",
          password: "Saved123!"
        }
      });
    });
  });

  it("服务器配置弹窗会展示自动发现 HOST，并标注自动发现标签", async () => {
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
    clientConfigStore.updateRuntime({
      discoveredHosts: [
        {
          id: "local-discovered:http://127.0.0.1:4100:/tmp/demo",
          discoveryKey: "local-discovered:http://127.0.0.1:4100:/tmp/demo",
          name: "127.0.0.1:4100",
          baseUrl: "http://127.0.0.1:4100",
          kind: "local",
          createdAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z",
          lastConnectedAt: null,
          lastUserId: null,
          lastUsername: null,
          source: "desktop-process-scan",
          pid: 1001,
          executable: "/opt/homebrew/bin/node",
          dataDir: "/tmp/demo",
          discoveredAt: "2026-04-16T00:00:00.000Z",
          lastReachableAt: "2026-04-16T00:00:00.000Z"
        }
      ]
    });

    renderLoginPage();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(t("auth.serverSettings")) }));

    const presetSelect = await screen.findByRole("combobox", { name: t("auth.serverPreset") });

    expect(screen.getByRole("option", { name: /http:\/\/127\.0\.0\.1:4100.*自动发现/ })).toBeInTheDocument();

    await userEvent.selectOptions(presetSelect, "http://127.0.0.1:4100");

    expect(screen.getByText(t("auth.serverDiscoveredTag"))).toBeInTheDocument();
    expect(screen.getByLabelText(t("auth.serverAddress"))).toHaveValue("http://127.0.0.1:4100");
  });

  it("第三次失败后会显示验证码，并在验证码正确后继续登录", async () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      platform: "MacIntel"
    });
    delete window.__TAURI_INTERNALS__;

    const loginRequests: Array<Record<string, unknown>> = [];
    vi.spyOn(userPreferenceStore, "refreshForAuthenticatedUser").mockResolvedValue(
      userPreferenceStore.getState()
    );
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/api/public/bootstrap-status")) {
        return createJsonResponse({ initialized: true });
      }

      if (url.endsWith("/api/auth/login")) {
        const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        loginRequests.push(payload);

        switch (loginRequests.length) {
          case 1:
          case 2:
            return createJsonResponse(
              {
                detail: "用户名或密码错误",
                error_code: "INVALID_CREDENTIALS"
              },
              401
            );
          case 3:
            return createJsonResponse(
              {
                detail: "用户名或密码错误，请完成图形验证码后重试",
                error_code: "INVALID_CREDENTIALS",
                data: {
                  captcha: {
                    captchaId: "captcha-3",
                    imageDataUrl: "data:image/svg+xml;base64,Y2FwdGNoYS0z"
                  }
                }
              },
              401
            );
          case 4:
            return createJsonResponse(
              {
                detail: "请先完成图形验证码",
                error_code: "CAPTCHA_REQUIRED",
                data: {
                  captcha: {
                    captchaId: "captcha-4",
                    imageDataUrl: "data:image/svg+xml;base64,Y2FwdGNoYS00"
                  }
                }
              },
              400
            );
          case 5:
            return createJsonResponse(
              {
                detail: "图形验证码错误，请重试",
                error_code: "CAPTCHA_INVALID",
                data: {
                  captcha: {
                    captchaId: "captcha-5",
                    imageDataUrl: "data:image/svg+xml;base64,Y2FwdGNoYS01"
                  }
                }
              },
              400
            );
          default:
            return createJsonResponse({
              accessToken: "access-token",
              refreshToken: "refresh-token",
              expiresIn: 3600,
              user: {
                userId: "user-1",
                username: "admin",
                role: "admin"
              }
            });
        }
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderLoginPage();

    const passwordInput = (await screen.findByLabelText(t("auth.password"))) as HTMLInputElement;
    const submitButton = screen.getByRole("button", { name: new RegExp(t("auth.submitLogin")) });

    await userEvent.type(passwordInput, "wrong-password");
    await userEvent.click(submitButton);
    await userEvent.click(submitButton);
    await userEvent.click(submitButton);

    const captchaInput = (await screen.findByLabelText(t("auth.captcha"))) as HTMLInputElement;
    expect(screen.getByRole("img", { name: t("auth.captchaImageAlt") })).toBeInTheDocument();

    await userEvent.clear(passwordInput);
    await userEvent.type(passwordInput, "admin1234");
    await userEvent.click(submitButton);

    await userEvent.type(captchaInput, "WRNG");
    await userEvent.click(submitButton);

    await userEvent.clear(captchaInput);
    await userEvent.type(captchaInput, "ABCD");
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("HOME")).toBeInTheDocument();
    });

    expect(loginRequests).toEqual([
      {
        username: "admin",
        password: "wrong-password"
      },
      {
        username: "admin",
        password: "wrong-password"
      },
      {
        username: "admin",
        password: "wrong-password"
      },
      {
        username: "admin",
        password: "admin1234",
        captchaId: "captcha-3",
        captchaCode: ""
      },
      {
        username: "admin",
        password: "admin1234",
        captchaId: "captcha-4",
        captchaCode: "WRNG"
      },
      {
        username: "admin",
        password: "admin1234",
        captchaId: "captcha-5",
        captchaCode: "ABCD"
      }
    ]);
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
                <Route path="/" element={<div>HOME</div>} />
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
