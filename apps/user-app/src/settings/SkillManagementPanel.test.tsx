import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { authStore } from "../features/auth/store/auth-store";
import { I18nProvider, t } from "../shared/i18n";
import { SkillManagementPanel } from "./SkillManagementPanel";

const originalFetch = global.fetch;

describe("SkillManagementPanel", () => {
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

  it("可以加载 Skill 概况，并支持导入未纳管项与重新同步", async () => {
    let imported = false;
    let uploaded = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/skills/overview") && method === "GET") {
        return createJsonResponse(createSkillOverviewResponse({ imported, uploaded, assistantUploaded: false }));
      }

      if (url.endsWith("/api/providers/catalog") && method === "GET") {
        return createJsonResponse({ items: createProviderCatalogResponse() });
      }

      if (url.endsWith("/api/opencli/catalog") && method === "GET") {
        return createJsonResponse(createOpenCliCatalogResponse());
      }

      if (url.endsWith("/api/skills") && method === "POST") {
        uploaded = true;
        expect(JSON.parse(String(init?.body))).toEqual({
          markdownContent: "这是一个通过前端上传的 skill。",
          scope: "workspace",
          fileName: "uploaded-skill.md",
          directoryName: "uploaded-skill",
          targetCli: ["codex"]
        });
        return createJsonResponse({});
      }

      if (url.endsWith("/api/skills/import") && method === "POST") {
        imported = true;
        expect(JSON.parse(String(init?.body))).toEqual({
          targetCli: "claude-code",
          directoryPath: "/tmp/claude/skills/sample-helper",
          expectedContentHash: "hash-2"
        });
        return createJsonResponse({});
      }

      if (url.endsWith("/api/skills/sync") && method === "POST") {
        expect(JSON.parse(String(init?.body))).toEqual({
          skillId: "skill-1",
          targetCli: ["codex"]
        });
        return createJsonResponse({});
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    renderPanel();

    expect(await screen.findByText(t("settings.skillManageAction"))).toBeInTheDocument();
    expect(screen.queryByText("codingns-assistant")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("settings.skillManageAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.skillConfigModalTitle") });

    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: t("settings.skillConfigTabSkills") })).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByRole("tab", { name: t("settings.skillConfigTabOpenCli") })).toHaveAttribute("aria-selected", "false");
    expect(
      within(dialog).queryByRole("heading", { level: 3, name: t("settings.opencliSectionTitle") })
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText(t("settings.skillSummaryUnmanagedEntries"))).not.toBeInTheDocument();
    expect(within(dialog).queryByText(t("settings.skillSummaryAssistantRuntimeEntries"))).not.toBeInTheDocument();
    expect(within(dialog).getByText("team-helper")).toBeInTheDocument();
    expect(within(dialog).getByText("sample-helper")).toBeInTheDocument();
    expect(within(dialog).getByText("codingns-assistant")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", {
        level: 3,
        name: t("settings.skillAssistantRuntimeListTitle")
      })
    ).toBeInTheDocument();
    expect(within(dialog).getByText(t("settings.skillAssistantRuntimeListDescription"))).toBeInTheDocument();
    expect(within(dialog).getByText(t("settings.skillConflictedEmpty"))).toBeInTheDocument();
    expect(within(dialog).getByText(t("settings.skillDiagnosticsEmpty"))).toBeInTheDocument();
    expect(within(dialog).getAllByText(t("settings.skillTagAssistantOnly")).length).toBeGreaterThan(0);

    await userEvent.click(within(dialog).getByRole("tab", { name: t("settings.skillConfigTabOpenCli") }));
    expect(
      await within(dialog).findByRole("checkbox", { name: t("settings.opencliProviderToggleLabel") })
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("settings.opencliRefreshAction") })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("settings.opencliDetailAction") })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t("settings.opencliSaveAction") })).toBeInTheDocument();
    expect(within(dialog).queryByText("team-helper")).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("tab", { name: t("settings.skillConfigTabSkills") }));
    expect(await within(dialog).findByText("team-helper")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: t("settings.skillCreateAction") }));

    const createDialog = await screen.findByRole("dialog", { name: t("settings.skillCreateModalTitle") });
    const uploadInput = createDialog.querySelector('input[type="file"]');
    expect(uploadInput).not.toBeNull();

    await userEvent.upload(
      uploadInput as HTMLInputElement,
      new File(["这是一个通过前端上传的 skill。"], "uploaded-skill.md", {
        type: "text/markdown"
      })
    );

    expect(await within(createDialog).findByText("Uploaded Skill")).toBeInTheDocument();
    await userEvent.click(within(createDialog).getByRole("button", { name: t("settings.skillCreateSubmitAction") }));

    await waitFor(() => {
      expect(
        screen.getByText(
          t("settings.skillUploadSuccess", {
            name: "uploaded-skill"
          })
        )
      ).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: t("settings.skillImportAction") }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: t("settings.skillImportAction") })).not.toBeInTheDocument();
    });
    expect(screen.getByText(t("settings.skillImportSuccess", {
      name: "sample-helper",
      target: t("settings.skillTargetClaudeCode")
    }))).toBeInTheDocument();

    const teamHelperTitle = screen.getByText("team-helper");
    const teamHelperCard = teamHelperTitle.closest(".settings-skill-entry");

    expect(teamHelperCard).not.toBeNull();

    await userEvent.click(
      within(teamHelperCard as HTMLElement).getByRole("button", { name: t("settings.skillSyncAction") })
    );

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input, init]) => {
        return (
          String(input).endsWith("/api/skills/sync") &&
          (init?.method ?? "GET").toUpperCase() === "POST"
        );
      })).toBe(true);
    });
    expect(
      screen.getByText(
        t("settings.skillSyncSuccess", {
          name: "team-helper"
        })
      )
    ).toBeInTheDocument();
  });

  it("可以通过粘贴文本把 SKILL 纳管到助手专用作用域", async () => {
    let assistantUploaded = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/skills/overview") && method === "GET") {
        return createJsonResponse(
          createSkillOverviewResponse({ imported: false, uploaded: false, assistantUploaded })
        );
      }

      if (url.endsWith("/api/providers/catalog") && method === "GET") {
        return createJsonResponse({ items: createProviderCatalogResponse({ codexEnabled: false }) });
      }

      if (url.endsWith("/api/opencli/catalog") && method === "GET") {
        return createJsonResponse(createOpenCliCatalogResponse());
      }

      if (url.endsWith("/api/skills") && method === "POST") {
        assistantUploaded = true;
        expect(JSON.parse(String(init?.body))).toEqual({
          markdownContent: "# Butler Inbox Helper\n\n这是一个助手专用 skill。",
          scope: "assistant",
          fileName: "butler-inbox-helper.md",
          directoryName: "butler-inbox-helper",
          targetCli: ["claude-code"]
        });
        return createJsonResponse({});
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: t("settings.skillManageAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.skillConfigModalTitle") });
    await userEvent.click(within(dialog).getByRole("button", { name: t("settings.skillCreateAction") }));

    const createDialog = await screen.findByRole("dialog", { name: t("settings.skillCreateModalTitle") });
    await userEvent.click(within(createDialog).getByRole("tab", { name: t("settings.skillCreateSourcePaste") }));
    await userEvent.click(within(createDialog).getByRole("radio", { name: t("settings.skillUploadScopeAssistant") }));
    await userEvent.type(
      within(createDialog).getByLabelText(t("settings.skillPasteLabel")),
      "# Butler Inbox Helper\n\n这是一个助手专用 skill。"
    );
    expect(within(createDialog).queryByText(t("settings.skillUploadDirectoryLabel"))).not.toBeInTheDocument();
    await userEvent.click(within(createDialog).getByRole("button", { name: t("settings.skillCreateSubmitAction") }));

    const butlerHelperTitle = await screen.findByText("Butler Inbox Helper");
    const butlerHelperCard = butlerHelperTitle.closest(".settings-skill-entry");

    expect(butlerHelperCard).not.toBeNull();
    expect(
      within(butlerHelperCard as HTMLElement).getByText(t("settings.skillAssistantRuntimeItemDescription"))
    ).toBeInTheDocument();
    expect(
      within(butlerHelperCard as HTMLElement).getByText(
        `${t("settings.skillAssistantRuntimeUsedBy")}: ${t("settings.skillTargetCodex")}`
      )
    ).toBeInTheDocument();
  });

  it("禁用的 provider 不会再作为 Skill 新目标或重新同步目标", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/skills/overview") && method === "GET") {
        return createJsonResponse(createSkillOverviewResponse({
          imported: false,
          uploaded: false,
          assistantUploaded: false
        }));
      }

      if (url.endsWith("/api/providers/catalog") && method === "GET") {
        return createJsonResponse({ items: createProviderCatalogResponse({ codexEnabled: false }) });
      }

      if (url.endsWith("/api/opencli/catalog") && method === "GET") {
        return createJsonResponse(createOpenCliCatalogResponse());
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: t("settings.skillManageAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.skillConfigModalTitle") });
    const teamHelperCard = screen.getByText("team-helper").closest(".settings-skill-entry");

    expect(teamHelperCard).not.toBeNull();
    expect(within(teamHelperCard as HTMLElement).getByText(`${t("settings.skillTargetCodex")} · ${t("settings.skillTargetDisabledTag")}`)).toBeInTheDocument();
    expect(within(teamHelperCard as HTMLElement).getByRole("button", { name: t("settings.skillSyncAction") })).toBeDisabled();

    await userEvent.click(within(dialog).getByRole("button", { name: t("settings.skillCreateAction") }));

    const createDialog = await screen.findByRole("dialog", { name: t("settings.skillCreateModalTitle") });
    expect(within(createDialog).getByRole("checkbox", { name: `${t("settings.skillTargetCodex")} · ${t("settings.skillTargetDisabledTag")}` })).toBeDisabled();
    expect(within(createDialog).getByRole("checkbox", { name: t("settings.skillTargetClaudeCode") })).toBeChecked();

    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/skills/sync"))).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/skills"))).toBe(false);
  });
});

function renderPanel() {
  return render(
    <I18nProvider language={clientConfigStore.getState().language}>
      <SkillManagementPanel />
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

function createSkillOverviewResponse(
  {
    imported,
    uploaded,
    assistantUploaded
  }: {
    imported: boolean;
    uploaded: boolean;
    assistantUploaded: boolean;
  }
) {
  return {
    summary: {
      managedSkillCount: uploaded ? 2 : 1,
      managedEntryCount: uploaded ? 2 : 1,
      unmanagedEntryCount: imported ? 0 : 1,
      conflictedEntryCount: 0,
      diagnosticCount: 0
    },
    managedSkills: [
      {
        skill: {
          id: "skill-1",
          name: "team-helper",
          scope: "workspace",
          directoryName: "team-helper",
          sourceType: "local-import",
          sourcePath: "/tmp/skills/team-helper",
          contentHash: "hash-1",
          managedState: "active",
          createdAt: "2026-04-14T10:00:00.000Z",
          updatedAt: "2026-04-14T10:00:00.000Z"
        },
        bindings: [
          {
            skillId: "skill-1",
            targetCli: "codex",
            enabled: true,
            syncStatus: "synced",
            lastSyncedAt: "2026-04-14T10:05:00.000Z",
            lastErrorCode: null,
            lastErrorDetail: null
          }
        ],
        ssotPath: "/tmp/managed-skills/codingns-assistant"
      },
      ...(uploaded
        ? [
            {
              skill: {
                id: "skill-2",
                name: "Uploaded Skill",
                scope: "workspace",
                directoryName: "uploaded-skill",
                sourceType: "local-import",
                sourcePath: null,
                contentHash: "hash-uploaded",
                managedState: "active",
                createdAt: "2026-04-14T10:20:00.000Z",
                updatedAt: "2026-04-14T10:20:00.000Z"
              },
              bindings: [
                {
                  skillId: "skill-2",
                  targetCli: "codex",
                  enabled: true,
                  syncStatus: "synced",
                  lastSyncedAt: "2026-04-14T10:20:00.000Z",
                  lastErrorCode: null,
                  lastErrorDetail: null
                }
              ],
              ssotPath: "/tmp/managed-skills/uploaded-skill"
            }
          ]
        : [])
    ],
    assistantRuntimeSkills: [
      {
        name: "codingns-assistant",
        directoryName: "codingns-assistant",
        sourcePath: "/repo/builtin-skills/codingns-assistant",
        usedByTargetCli: ["codex", "claude-code"]
      },
      ...(assistantUploaded
        ? [
            {
              name: "Butler Inbox Helper",
              directoryName: "butler-inbox-helper",
              sourcePath: "/tmp/managed-skills/.assistant-runtime/butler-inbox-helper",
              usedByTargetCli: ["codex"]
            }
          ]
        : [])
    ],
    managedEntries: [
      {
        targetCli: "codex",
        directoryPath: "/tmp/skills/team-helper",
        directoryName: "team-helper",
        name: "team-helper",
        contentHash: "hash-1",
        managementState: "managed",
        managedSkillId: "skill-1"
      }
    ],
    unmanagedEntries: imported
      ? []
      : [
          {
            targetCli: "claude-code",
            directoryPath: "/tmp/claude/skills/sample-helper",
            directoryName: "sample-helper",
            name: "sample-helper",
            contentHash: "hash-2",
            managementState: "unmanaged",
            managedSkillId: null
          }
        ],
    conflictedEntries: [],
    diagnostics: [],
    scannedAt: "2026-04-14T10:10:00.000Z"
  };
}

function createOpenCliCatalogResponse() {
  return {
    provider: {
      providerId: "opencli",
      enabled: false,
      installState: "installed",
      healthState: "bridge_missing",
      version: "1.7.7",
      installPath: "/opt/homebrew/lib/node_modules/@jackwener/opencli",
      lastCheckedAt: "2026-04-26T10:00:00.000Z",
      activeRuntimeId: null,
      lastErrorCode: null,
      lastErrorDetail: null,
      catalogRefreshedAt: "2026-04-26T10:00:00.000Z",
      catalogSource: "manifest"
    },
    summary: {
      catalogCount: 2,
      enabledCount: 2,
      browserDependentCount: 1,
      installState: "installed",
      healthState: "bridge_missing"
    },
    effectiveCatalogSource: "manifest",
    activeRuntimeProfile: null,
    entries: [
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
        enabled: true,
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
        enabled: true,
        sortOrder: 1
      }
    ],
    siteGroups: [
      {
        site: "hackernews",
        totalCount: 1,
        enabledCount: 1,
        browserDependentCount: 0,
        commands: [
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
            enabled: true,
            sortOrder: 0
          }
        ]
      },
      {
        site: "twitter",
        totalCount: 1,
        enabledCount: 1,
        browserDependentCount: 1,
        commands: [
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
            enabled: true,
            sortOrder: 1
          }
        ]
      }
    ]
  };
}

function createProviderCatalogResponse(
  overrides: {
    codexEnabled?: boolean;
    claudeEnabled?: boolean;
    geminiEnabled?: boolean;
    opencodeEnabled?: boolean;
  } = {}
) {
  return [
    createProviderCatalogEntry("codex", overrides.codexEnabled ?? true),
    createProviderCatalogEntry("claude-code", overrides.claudeEnabled ?? true),
    createProviderCatalogEntry("gemini", overrides.geminiEnabled ?? true),
    createProviderCatalogEntry("opencode", overrides.opencodeEnabled ?? true)
  ];
}

function createProviderCatalogEntry(provider: "codex" | "claude-code" | "gemini" | "opencode", enabled: boolean) {
  return {
    provider,
    displayName:
      provider === "claude-code"
        ? "Claude Code"
        : provider === "opencode"
          ? "OpenCode"
          : provider === "gemini"
            ? "Gemini"
            : "Codex",
    enabled,
    installState: "ready",
    disableImpact: {
      hidesSessions: true,
      blocksSessionStart: true,
      blocksFork: true,
      blocksAssistant: provider === "codex" || provider === "claude-code",
      blocksSkillTargets: true
    },
    capabilities: {
      provider,
      canStartSession: enabled,
      canResumeSession: enabled,
      canSendMessage: enabled,
      inRunInputMode: "none",
      supportsSubagents: false,
      supportsInterrupt: false,
      supportsStructuredToolCalls: false,
      supportsTokenUsage: false,
      supportsAttachments: false,
      supportsPermissionPrompt: false,
      supportsCheckpoint: false,
      limitations: []
    },
    productCapabilities: {
      streamingOutput: enabled,
      toolCalls: false,
      assistantService: enabled && (provider === "codex" || provider === "claude-code"),
      sessionFork: true,
      skillUsage: enabled
    }
  };
}
