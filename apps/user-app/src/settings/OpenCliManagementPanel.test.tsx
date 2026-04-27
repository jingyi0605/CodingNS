import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { authStore } from "../features/auth/store/auth-store";
import { I18nProvider, t } from "../shared/i18n";
import { OpenCliManagementPanel } from "./OpenCliManagementPanel";

const originalFetch = global.fetch;

describe("OpenCliManagementPanel", () => {
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

  it("可以加载目录、按命令保存启用结果，并触发刷新", async () => {
    let refreshCount = 0;
    let latestSavedPayload: unknown = null;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/opencli/config") && method === "POST") {
        latestSavedPayload = JSON.parse(String(init?.body));
        return createJsonResponse(createOpenCliUpdateResponse({
          providerEnabled: true,
          enabledCommandIds: ["hackernews/top"],
          runtimeStatus: "ready"
        }));
      }

      if (url.endsWith("/api/opencli/check") && method === "POST") {
        refreshCount += 1;
        return createJsonResponse(createOpenCliCheckResponse({
          refreshState: "fresh",
          runtimeAvailability: refreshCount === 1 ? "disabled" : "ready",
          providerEnabled: refreshCount !== 1,
          enabledCommandIds: refreshCount === 1
            ? ["hackernews/top", "twitter/trending"]
            : ["hackernews/top"],
          healthState: "ready",
          lastCheckedAt: "2026-04-27T10:00:00.000Z"
        }));
      }

      if (url.endsWith("/api/opencli/catalog") && method === "GET") {
        return createJsonResponse(createOpenCliCatalogResponse());
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    renderPanel();

    expect(await screen.findByRole("checkbox", { name: t("settings.opencliProviderToggleLabel") })).toBeInTheDocument();
    expect(screen.getAllByText(t("settings.opencliInstallInstalled")).length).toBeGreaterThan(0);
    expect(screen.queryByText(t("settings.opencliSectionDescription"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("settings.opencliProviderHint"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("settings.opencliCatalogGridDescription"))).not.toBeInTheDocument();
    expect(screen.getByText("hackernews")).toBeInTheDocument();
    expect(screen.getByText("twitter")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t("settings.opencliDetailAction") }));
    const detailDialog = await screen.findByRole("dialog", {
      name: t("settings.opencliDetailTitle")
    });
    expect(within(detailDialog).getByText("/opt/homebrew/lib/node_modules/@jackwener/opencli")).toBeInTheDocument();
    expect(within(detailDialog).getByText(t("settings.opencliHealthReady"))).toBeInTheDocument();
    expect(within(detailDialog).queryByText(t("settings.opencliHealthBridgeMissing"))).not.toBeInTheDocument();
    await userEvent.click(within(detailDialog).getByRole("button", { name: t("common.close") }));

    const twitterCard = screen.getByText("twitter").closest(".settings-opencli-site-card");
    expect(twitterCard).not.toBeNull();
    expect((twitterCard as HTMLElement).querySelector(".settings-opencli-site-card-description")).not.toBeNull();
    expect((twitterCard as HTMLElement).querySelectorAll(".settings-opencli-site-card-tag-row")).toHaveLength(1);
    expect(within(twitterCard as HTMLElement).getByRole("button", { name: t("settings.opencliSiteViewAction") })).toBeInTheDocument();
    expect(within(twitterCard as HTMLElement).getByText(t("settings.opencliSiteEnableAction"))).toBeInTheDocument();
    expect(within(twitterCard as HTMLElement).queryByText(
      t("settings.opencliSiteSummaryCompact", { enabled: 1, total: 2 })
    )).not.toBeInTheDocument();
    expect(within(twitterCard as HTMLElement).queryByText(
      t("settings.opencliSiteBrowserCompact", { count: 1 })
    )).not.toBeInTheDocument();
    expect((twitterCard as HTMLElement).querySelector('[data-strategy="intercept"]')).not.toBeNull();

    await userEvent.click(
      within(twitterCard as HTMLElement).getByRole("button", { name: t("settings.opencliSiteViewAction") })
    );

    const twitterDialog = await screen.findByRole("dialog", {
      name: t("settings.opencliSiteDetailTitle", { site: "twitter" })
    });
    expect(within(twitterDialog).getByText(t("settings.opencliSiteDescriptionHeading"))).toBeInTheDocument();
    const twitterSummary = twitterDialog.querySelector(".settings-opencli-site-detail-copy");
    expect(twitterSummary).not.toBeNull();
    expect(within(twitterSummary as HTMLElement).getByText("读取 Twitter 热门趋势")).toBeInTheDocument();
    expect(within(twitterSummary as HTMLElement).getByText("读取 Twitter 用户资料")).toBeInTheDocument();
    const twitterSearchInput = within(twitterDialog).getByRole("searchbox", {
      name: t("settings.opencliCommandSearchLabel")
    });
    const providerToggle = screen.getByRole("checkbox", {
      name: t("settings.opencliProviderToggleLabel")
    });
    expect(within(twitterDialog).getByRole("checkbox", {
      name: t("settings.opencliCommandToggleLabel", { commandId: "twitter/trending" })
    })).toBeChecked();
    expect(
      within(twitterDialog)
        .getAllByText(/^twitter\//)
        .map((element) => element.textContent)
    ).toEqual(["twitter/trending", "twitter/profile"]);

    await userEvent.type(twitterSearchInput, "profile");
    expect(within(twitterDialog).getByText("twitter/profile")).toBeInTheDocument();
    expect(within(twitterDialog).queryByText("twitter/trending")).not.toBeInTheDocument();
    await userEvent.clear(twitterSearchInput);

    await userEvent.click(within(twitterDialog).getByRole("tab", {
      name: t("settings.opencliCommandSortName")
    }));
    expect(
      within(twitterDialog)
        .getAllByText(/^twitter\//)
        .map((element) => element.textContent)
    ).toEqual(["twitter/profile", "twitter/trending"]);

    await userEvent.click(providerToggle);
    await userEvent.click(within(twitterDialog).getByRole("checkbox", {
      name: t("settings.opencliCommandToggleLabel", { commandId: "twitter/trending" })
    }));
    await waitFor(() => {
      expect(within(twitterDialog).getByRole("checkbox", {
        name: t("settings.opencliCommandToggleLabel", { commandId: "twitter/trending" })
      })).not.toBeChecked();
    });
    await userEvent.click(screen.getByRole("button", { name: t("settings.opencliSaveAction") }));

    await waitFor(() => {
      expect(latestSavedPayload).toEqual({
        enabled: true,
        enabledCommandIds: ["hackernews/top"]
      });
    });
    expect(screen.getByText(t("settings.opencliSaveReady"))).toBeInTheDocument();
    await userEvent.click(within(twitterDialog).getByRole("button", { name: t("common.close") }));

    await userEvent.click(screen.getByRole("button", { name: t("settings.opencliRefreshAction") }));

    await waitFor(() => {
      expect(refreshCount).toBe(2);
    });
    expect(screen.getByText(t("settings.opencliRefreshReady"))).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: t("settings.opencliFilterBrowser") }));
    expect(screen.queryByText("hackernews")).not.toBeInTheDocument();
    expect(screen.getByText("twitter")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: t("settings.opencliFilterAll") }));

    const siteCard = screen.getByText("hackernews").closest(".settings-opencli-site-card");
    expect(siteCard).not.toBeNull();
    expect(within(siteCard as HTMLElement).queryByText(
      t("settings.opencliSiteSummaryCompact", { enabled: 1, total: 1 })
    )).not.toBeInTheDocument();
    expect((siteCard as HTMLElement).querySelector('[data-strategy="public"]')).not.toBeNull();
  });
});

function renderPanel() {
  return render(
    <I18nProvider language={clientConfigStore.getState().language}>
      <OpenCliManagementPanel />
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

function createOpenCliCatalogResponse({
  providerEnabled = false,
  enabledCommandIds = ["hackernews/top", "twitter/trending"],
  runtimeStatus = null,
  healthState = "bridge_missing" as const,
  lastCheckedAt = "2026-04-26T10:00:00.000Z"
}: {
  providerEnabled?: boolean;
  enabledCommandIds?: string[];
  runtimeStatus?: "pending" | "ready" | "failed" | "stale" | null;
  healthState?: "unknown" | "binary_ready" | "bridge_missing" | "ready" | "runtime_build_failed";
  lastCheckedAt?: string;
} = {}) {
  const entries = [
    {
      providerId: "opencli",
      commandId: "hackernews/top",
      site: "hackernews",
      name: "top",
      description: "读取 Hacker News 热门内容",
      strategy: "public",
      browser: false,
      modulePath: "./clis/hackernews/top.js",
      sourceFile: "clis/hackernews/top.js",
      enabled: enabledCommandIds.includes("hackernews/top"),
      sortOrder: 0
    },
    {
      providerId: "opencli",
      commandId: "twitter/trending",
      site: "twitter",
      name: "trending",
      description: "读取 Twitter 热门趋势",
      strategy: "intercept",
      browser: true,
      modulePath: "./clis/twitter/trending.js",
      sourceFile: "clis/twitter/trending.js",
      enabled: enabledCommandIds.includes("twitter/trending"),
      sortOrder: 1
    },
    {
      providerId: "opencli",
      commandId: "twitter/profile",
      site: "twitter",
      name: "profile",
      description: "读取 Twitter 用户资料",
      strategy: "public",
      browser: false,
      modulePath: "./clis/twitter/profile.js",
      sourceFile: "clis/twitter/profile.js",
      enabled: enabledCommandIds.includes("twitter/profile"),
      sortOrder: 2
    }
  ];

  return {
    provider: {
      providerId: "opencli",
      enabled: providerEnabled,
      installState: "installed",
      healthState,
      version: "1.7.7",
      installPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
      lastCheckedAt,
      activeRuntimeId: runtimeStatus ? "opencli-runtime-1" : null,
      lastErrorCode: null,
      lastErrorDetail: null,
      catalogRefreshedAt: "2026-04-26T10:00:00.000Z",
      catalogSource: "manifest"
    },
    summary: {
      catalogCount: entries.length,
      enabledCount: enabledCommandIds.length,
      browserDependentCount: 1,
      installState: "installed",
      healthState
    },
    effectiveCatalogSource: "manifest",
    activeRuntimeProfile: runtimeStatus
      ? {
          id: "opencli-runtime-1",
          version: "1.7.7",
          sourceInstallPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
          runtimeRootPath: "/tmp/codingns/opencli-runtime-1",
          status: runtimeStatus,
          contentHash: "hash-1",
          enabledCommandIds,
          createdAt: "2026-04-26T10:00:00.000Z",
          updatedAt: "2026-04-26T10:00:00.000Z",
          lastErrorCode: null,
          lastErrorDetail: null
        }
      : null,
    entries,
    siteGroups: [
      {
        site: "hackernews",
        totalCount: 1,
        enabledCount: enabledCommandIds.includes("hackernews/top") ? 1 : 0,
        browserDependentCount: 0,
        commands: [entries[0]]
      },
      {
        site: "twitter",
        totalCount: 2,
        enabledCount: entries.slice(1).filter((entry) => enabledCommandIds.includes(entry.commandId)).length,
        browserDependentCount: 1,
        commands: entries.slice(1)
      }
    ]
  };
}

function createOpenCliCheckResponse({
  refreshState,
  runtimeAvailability,
  providerEnabled = true,
  enabledCommandIds,
  healthState = "bridge_missing",
  lastCheckedAt = "2026-04-26T10:00:00.000Z"
}: {
  refreshState: "fresh" | "cache_retained" | "unavailable";
  runtimeAvailability: "disabled" | "ready" | "unavailable";
  providerEnabled?: boolean;
  enabledCommandIds: string[];
  healthState?: "unknown" | "binary_ready" | "bridge_missing" | "ready" | "runtime_build_failed";
  lastCheckedAt?: string;
}) {
  return {
    ...createOpenCliCatalogResponse({
      providerEnabled,
      enabledCommandIds,
      runtimeStatus: runtimeAvailability === "ready" ? "ready" : null,
      healthState,
      lastCheckedAt
    }),
    refreshState,
    errorCode: null,
    errorDetail: null,
    runtimeAvailability
  };
}

function createOpenCliUpdateResponse({
  providerEnabled,
  enabledCommandIds,
  runtimeStatus
}: {
  providerEnabled: boolean;
  enabledCommandIds: string[];
  runtimeStatus: "pending" | "ready" | "failed" | "stale" | null;
}) {
  return {
    ...createOpenCliCatalogResponse({
      providerEnabled,
      enabledCommandIds,
      runtimeStatus
    }),
    runtimeAvailability: runtimeStatus === "ready" ? "ready" : "unavailable",
    runtimeErrorCode: null,
    runtimeErrorDetail: null
  };
}
