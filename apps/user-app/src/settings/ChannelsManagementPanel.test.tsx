import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { authStore } from "../features/auth/store/auth-store";
import { PlatformProvider } from "../platform/platform-provider";
import { I18nProvider, t } from "../shared/i18n";
import { ChannelsManagementPanel } from "./ChannelsManagementPanel";

const originalFetch = global.fetch;

describe("ChannelsManagementPanel", () => {
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    authStore.clear();
  });

  it("打开后会显示账号列表，并且能查看已有 Telegram 账号的最近记录", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/channels/platforms") && method === "GET") {
        return createJsonResponse(createPlatformsResponse());
      }

      if (url.endsWith("/api/channels/accounts") && method === "GET") {
        return createJsonResponse([createAccountResponse()]);
      }

      if (url.includes("/api/channels/accounts/account-1/threads") && method === "GET") {
        return createJsonResponse([
          {
            id: "thread-1",
            channelAccountId: "account-1",
            externalConversationKey: "telegram:chat-1",
            externalUserId: "user-1",
            externalThreadKey: null,
            controlSessionId: "control-1",
            sessionId: "session-1",
            title: "项目群",
            status: "active",
            lastInboundAt: "2026-04-27T09:00:00.000Z",
            lastOutboundAt: "2026-04-27T09:01:00.000Z",
            lastTransportContext: {},
            createdAt: "2026-04-27T08:00:00.000Z",
            updatedAt: "2026-04-27T09:01:00.000Z"
          }
        ]);
      }

      if (url.includes("/api/channels/accounts/account-1/events") && method === "GET") {
        return createJsonResponse([
          {
            id: "event-1",
            channelAccountId: "account-1",
            externalEventId: "update-1",
            externalConversationKey: "telegram:chat-1",
            externalUserId: "user-1",
            controlSessionId: "control-1",
            sessionId: "session-1",
            textContent: "请帮我看一下今天的回归结果",
            payload: {},
            status: "replied",
            errorMessage: null,
            receivedAt: "2026-04-27T09:00:00.000Z",
            processedAt: "2026-04-27T09:00:30.000Z"
          }
        ]);
      }

      if (url.includes("/api/channels/accounts/account-1/deliveries") && method === "GET") {
        return createJsonResponse([
          {
            id: "delivery-1",
            channelAccountId: "account-1",
            threadId: "thread-1",
            inboundEventId: "event-1",
            controlSessionId: "control-1",
            sessionId: "session-1",
            textContent: "回归结果已经整理好了。",
            providerMessageRef: "message-1",
            status: "sent",
            errorMessage: null,
            createdAt: "2026-04-27T09:01:00.000Z",
            updatedAt: "2026-04-27T09:01:01.000Z"
          }
        ]);
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: t("settings.channelsManageAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.channelsModalTitle") });
    const accountsSection = within(dialog).getByText(t("settings.channelsAccountsTitle")).closest("section");

    expect(accountsSection).not.toBeNull();
    expect(within(accountsSection as HTMLElement).getByText("测试机器人")).toBeInTheDocument();

    await userEvent.click(within(accountsSection as HTMLElement).getByRole("button", { name: /测试机器人/ }));

    expect(await within(dialog).findByText("项目群")).toBeInTheDocument();
    expect(within(dialog).getByText("请帮我看一下今天的回归结果")).toBeInTheDocument();
    expect(within(dialog).getByText("回归结果已经整理好了。")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("settings.channelsPollAction") })).toBeEnabled();
  });

  it("Telegram 向导会要求 bot token，并能成功创建账号", async () => {
    let latestPayload: unknown = null;

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/channels/platforms") && method === "GET") {
        return createJsonResponse(createPlatformsResponse());
      }

      if (url.endsWith("/api/channels/accounts") && method === "GET") {
        return createJsonResponse([]);
      }

      if (url.endsWith("/api/channels/accounts") && method === "POST") {
        latestPayload = JSON.parse(String(init?.body));
        return createJsonResponse(
          createAccountResponse({
            id: "account-created",
            displayName: "Telegram 值班号",
            platformCode: "telegram",
            config: {
              botToken: "tg-token-1"
            }
          }),
          201
        );
      }

      if (url.includes("/api/channels/accounts/account-created/threads") && method === "GET") {
        return createJsonResponse([]);
      }

      if (url.includes("/api/channels/accounts/account-created/events") && method === "GET") {
        return createJsonResponse([]);
      }

      if (url.includes("/api/channels/accounts/account-created/deliveries") && method === "GET") {
        return createJsonResponse([]);
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: t("settings.channelsManageAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.channelsModalTitle") });
    await clickPrimaryAddAccountAction(dialog);
    const createDialog = await screen.findByRole("dialog", { name: t("settings.channelsAddAccountAction") });

    await userEvent.click(within(createDialog).getByRole("button", { name: /Telegram/ }));
    await userEvent.click(within(createDialog).getByRole("button", { name: t("settings.channelsWizardNextToBinding") }));

    expect(
      within(createDialog).getByText(
        t("settings.channelsValidationRequiredField", {
          field: t("settings.channelsConfigFieldTelegramBotToken")
        })
      )
    ).toBeInTheDocument();

    await userEvent.type(
      within(createDialog).getByLabelText(t("settings.channelsConfigFieldTelegramBotToken")),
      "tg-token-1"
    );
    await userEvent.click(within(createDialog).getByRole("button", { name: t("settings.channelsWizardNextToBinding") }));
    await userEvent.type(
      within(createDialog).getByLabelText(t("settings.channelsFieldDisplayName")),
      "Telegram 值班号"
    );
    await userEvent.click(within(createDialog).getByRole("button", { name: t("settings.channelsCreateAction") }));

    await waitFor(() => {
      expect(latestPayload).toEqual({
        displayName: "Telegram 值班号",
        platformCode: "telegram",
        providerId: "codex",
        connectionMode: "polling",
        status: "active",
        config: {
          botToken: "tg-token-1"
        }
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: t("settings.channelsAddAccountAction") })).not.toBeInTheDocument();
    });
    expect(within(dialog).getByText("Telegram 值班号")).toBeInTheDocument();
  });

  it("个人微信（claw）现在只创建账号位，不再显示其他平台配置项", async () => {
    let latestPayload: unknown = null;

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/channels/platforms") && method === "GET") {
        return createJsonResponse(createPlatformsResponse());
      }

      if (url.endsWith("/api/channels/accounts") && method === "GET") {
        return createJsonResponse([]);
      }

      if (url.endsWith("/api/channels/accounts") && method === "POST") {
        latestPayload = JSON.parse(String(init?.body));
        return createJsonResponse(
          createAccountResponse({
            id: "wechat-account-1",
            displayName: "值班微信",
            platformCode: "wechat-claw",
            config: {}
          }),
          201
        );
      }

      if (url.includes("/api/channels/accounts/wechat-account-1/threads") && method === "GET") {
        return createJsonResponse([]);
      }

      if (url.includes("/api/channels/accounts/wechat-account-1/events") && method === "GET") {
        return createJsonResponse([]);
      }

      if (url.includes("/api/channels/accounts/wechat-account-1/deliveries") && method === "GET") {
        return createJsonResponse([]);
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: t("settings.channelsManageAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.channelsModalTitle") });
    await clickPrimaryAddAccountAction(dialog);
    const createDialog = await screen.findByRole("dialog", { name: t("settings.channelsAddAccountAction") });

    await userEvent.click(within(createDialog).getByRole("button", { name: /个人微信/ }));

    expect(within(createDialog).getByLabelText(t("settings.channelsFieldDisplayName"))).toBeInTheDocument();
    expect(within(createDialog).queryByLabelText(t("settings.channelsConfigFieldTelegramBotToken"))).not.toBeInTheDocument();

    await userEvent.type(within(createDialog).getByLabelText(t("settings.channelsFieldDisplayName")), "值班微信");
    await userEvent.click(within(createDialog).getByRole("button", { name: t("settings.channelsCreateAction") }));

    await waitFor(() => {
      expect(latestPayload).toEqual({
        displayName: "值班微信",
        platformCode: "wechat-claw",
        providerId: "codex",
        connectionMode: "polling",
        status: "active",
        config: {}
      });
    });

    expect(await within(dialog).findByText(t("settings.channelsWechatRuntimeRequiredTitle"))).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: t("settings.channelsPollAction") })).not.toBeInTheDocument();
  });

  it("个人微信（claw）详情页会明确提示官方 runtime 尚未接入", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/channels/platforms") && method === "GET") {
        return createJsonResponse(createPlatformsResponse());
      }

      if (url.endsWith("/api/channels/accounts") && method === "GET") {
        return createJsonResponse([
          createAccountResponse({
            id: "wechat-account-2",
            displayName: "个人微信值班号",
            platformCode: "wechat-claw",
            capability: {
              code: "wechat-claw",
              displayName: "个人微信（claw）",
              supportedConnectionModes: ["polling"],
              multiSessionSupportLevel: "limited",
              stageOneLimitations: ["当前需要接入 openclaw-weixin 官方运行时"]
            }
          })
        ]);
      }

      if (url.includes("/api/channels/accounts/wechat-account-2/threads") && method === "GET") {
        return createJsonResponse([]);
      }

      if (url.includes("/api/channels/accounts/wechat-account-2/events") && method === "GET") {
        return createJsonResponse([]);
      }

      if (url.includes("/api/channels/accounts/wechat-account-2/deliveries") && method === "GET") {
        return createJsonResponse([]);
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: t("settings.channelsManageAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.channelsModalTitle") });
    const accountsSection = within(dialog).getByText(t("settings.channelsAccountsTitle")).closest("section");

    expect(accountsSection).not.toBeNull();
    await userEvent.click(within(accountsSection as HTMLElement).getByRole("button", { name: /个人微信值班号/ }));

    expect(await within(dialog).findByText(t("settings.channelsWechatRuntimeRequiredTitle"))).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: t("settings.channelsProbeAction") })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: t("settings.channelsPollAction") })).not.toBeInTheDocument();
  });
});

function renderPanel() {
  return render(
    <PlatformProvider>
      <I18nProvider language={clientConfigStore.getState().language}>
        <ChannelsManagementPanel />
      </I18nProvider>
    </PlatformProvider>
  );
}

async function clickPrimaryAddAccountAction(dialog: HTMLElement): Promise<void> {
  const buttons = within(dialog).getAllByRole("button", { name: t("settings.channelsAddAccountAction") });
  await userEvent.click(buttons[0] as HTMLButtonElement);
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

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function createPlatformsResponse() {
  return [
    {
      code: "wechat-claw" as const,
      displayName: "个人微信（claw）",
      supportedConnectionModes: ["polling"],
      multiSessionSupportLevel: "limited" as const,
      stageOneLimitations: ["当前需要接入 openclaw-weixin 官方运行时"]
    },
    {
      code: "telegram" as const,
      displayName: "Telegram",
      supportedConnectionModes: ["polling"],
      multiSessionSupportLevel: "supported" as const,
      stageOneLimitations: ["第一阶段只处理文本消息"]
    }
  ];
}

function createAccountResponse(
  overrides: Partial<{
    id: string;
    displayName: string;
    platformCode: "telegram" | "wechat-claw";
    config: Record<string, unknown>;
    runtimeState: Record<string, unknown>;
    capability: {
      code: "telegram" | "wechat-claw";
      displayName: string;
      supportedConnectionModes: ["polling"];
      multiSessionSupportLevel: "supported" | "limited";
      stageOneLimitations: string[];
    };
  }> = {}
) {
  const platformCode = overrides.platformCode ?? "telegram";
  const displayName = overrides.displayName ?? "测试机器人";
  const capability = overrides.capability ?? {
    code: platformCode,
    displayName: platformCode === "telegram" ? "Telegram" : "个人微信（claw）",
    supportedConnectionModes: ["polling"],
    multiSessionSupportLevel: platformCode === "telegram" ? "supported" : "limited",
    stageOneLimitations: platformCode === "telegram"
      ? ["第一阶段只处理文本消息"]
      : ["当前需要接入 openclaw-weixin 官方运行时"]
  };

  return {
    id: overrides.id ?? "account-1",
    userId: "user-1",
    platformCode,
    displayName,
    providerId: "codex" as const,
    connectionMode: "polling" as const,
    status: "active" as const,
    config: overrides.config ?? {},
    runtimeState: overrides.runtimeState ?? {},
    lastInboundAt: "2026-04-27T09:00:00.000Z",
    lastOutboundAt: "2026-04-27T09:01:00.000Z",
    lastError: null,
    createdAt: "2026-04-27T08:00:00.000Z",
    updatedAt: "2026-04-27T09:01:00.000Z",
    capability,
    threadCount: 1,
    inboundEventCount: 1,
    deliveryCount: 1
  };
}
