import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientConfigStore } from "../config/client-config-store";
import { authStore } from "../features/auth/store/auth-store";
import { clearProviderCatalogStore } from "../features/conversation/capability/provider-catalog-store";
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
    clearProviderCatalogStore();
  });

  it("只展示 SKILL 管理，并支持导入、上传和重新同步", async () => {
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
    await userEvent.click(await screen.findByRole("button", { name: t("settings.skillManageAction") }));

    const dialog = await screen.findByRole("dialog", { name: t("settings.skillConfigModalTitle") });

    expect(within(dialog).queryByRole("tab")).not.toBeInTheDocument();
    expect(within(dialog).getByText("team-helper")).toBeInTheDocument();
    expect(within(dialog).getByText("sample-helper")).toBeInTheDocument();
    expect(within(dialog).getByText("codingns-assistant")).toBeInTheDocument();
    expect(within(dialog).getByText("codingns-workspace-session")).toBeInTheDocument();
    expect(within(dialog).getByText(t("settings.skillTagWorkspaceSessionOnly"))).toBeInTheDocument();

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

    const teamHelperCard = screen.getByText("team-helper").closest(".settings-skill-entry");
    expect(teamHelperCard).not.toBeNull();

    await userEvent.click(
      within(teamHelperCard as HTMLElement).getByRole("button", { name: t("settings.skillSyncAction") })
    );

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input, requestInit]) =>
        String(input).endsWith("/api/skills/sync")
        && (requestInit?.method ?? "GET").toUpperCase() === "POST"
      )).toBe(true);
    });
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
    await userEvent.click(within(createDialog).getByRole("button", { name: t("settings.skillCreateSubmitAction") }));

    const butlerHelperTitle = await screen.findByText("Butler Inbox Helper");
    const butlerHelperCard = butlerHelperTitle.closest(".settings-skill-entry");

    expect(butlerHelperCard).not.toBeNull();
    expect(
      within(butlerHelperCard as HTMLElement).getByText(t("settings.skillAssistantRuntimeItemDescription"))
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
  });

  it("可以查看工作区会话 MCP 状态", async () => {
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
        return createJsonResponse({ items: createProviderCatalogResponse() });
      }

      if (url.includes("/api/skills/workspace-session-mcp-status") && method === "GET") {
        expect(url).toContain("workspaceId=workspace-1");
        expect(url).toContain("sessionId=session-1");
        return createJsonResponse(createWorkspaceSessionMcpStatusResponse());
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    renderPanel("workspace-1", "session-1");
    await userEvent.click(await screen.findByRole("button", { name: t("settings.skillManageAction") }));

    const workspaceSkillCard = screen.getByText("codingns-workspace-session").closest(".settings-skill-entry");
    expect(workspaceSkillCard).not.toBeNull();

    await userEvent.click(
      within(workspaceSkillCard as HTMLElement).getByRole("button", {
        name: t("settings.skillWorkspaceSessionMcpStatusAction")
      })
    );

    const statusDialog = await screen.findByRole("dialog", {
      name: t("settings.skillWorkspaceSessionMcpModalTitle")
    });

    expect(within(statusDialog).getByText("当前会话 runtime 资产已经落齐。")).toBeInTheDocument();
    expect(within(statusDialog).getByText("Codex 会通过运行时注入方式挂上 workspace office MCP。")).toBeInTheDocument();
    expect(
      within(statusDialog).getAllByText("你机器上有全局 codingns，但版本偏旧，help 里还看不到完整 workspace office 能力。").length
    ).toBeGreaterThan(0);
    expect(within(statusDialog).queryByText(/browser\.opencli_bridge/)).not.toBeInTheDocument();
  });
});

function renderPanel(workspaceId?: string | null, sessionId?: string | null) {
  return render(
    <I18nProvider language={clientConfigStore.getState().language}>
      <SkillManagementPanel workspaceId={workspaceId ?? null} sessionId={sessionId ?? null} />
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
      {
        name: "codingns-workspace-session",
        directoryName: "codingns-workspace-session",
        sourcePath: "/repo/builtin-skills/codingns-workspace-session",
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

function createWorkspaceSessionMcpStatusResponse() {
  return {
    summary: {
      readyCliCount: 1,
      configuredCliCount: 1,
      totalCliCount: 3
    },
    simplified: {
      overallState: "partial",
      overallDetail: "当前链路只完成了一部分，模型可能能用，但稳定性还不够。",
      currentSessionReady: true,
      currentSessionDetail: "当前会话 runtime 资产已经落齐。",
      codexState: "ready",
      codexDetail: "Codex 会通过运行时注入方式挂上 workspace office MCP。",
      globalCodingnsState: "partial",
      globalCodingnsDetail: "你机器上有全局 codingns，但版本偏旧，help 里还看不到完整 workspace office 能力。",
      recommendedPath: null
    }
  };
}
