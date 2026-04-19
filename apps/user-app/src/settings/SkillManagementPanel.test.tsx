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

      if (url.endsWith("/api/skills") && method === "POST") {
        assistantUploaded = true;
        expect(JSON.parse(String(init?.body))).toEqual({
          markdownContent: "# Butler Inbox Helper\n\n这是一个助手专用 skill。",
          scope: "assistant",
          fileName: "butler-inbox-helper.md",
          directoryName: "butler-inbox-helper",
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

    expect(await screen.findByText("Butler Inbox Helper")).toBeInTheDocument();
    expect(screen.getByText("/tmp/managed-skills/.assistant-runtime/butler-inbox-helper")).toBeInTheDocument();
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
