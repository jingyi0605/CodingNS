import { render, screen, waitFor } from "@testing-library/react";
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/skills/overview") && method === "GET") {
        return createJsonResponse(createSkillOverviewResponse({ imported }));
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

    expect(await screen.findByRole("dialog", { name: t("settings.skillConfigModalTitle") })).toBeInTheDocument();
    expect(screen.getByText("team-helper")).toBeInTheDocument();
    expect(screen.getByText("sample-helper")).toBeInTheDocument();
    expect(screen.getByText("codingns-assistant")).toBeInTheDocument();
    expect(screen.getByText(t("settings.skillAssistantRuntimeListTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.skillAssistantRuntimeListDescription"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.skillConflictedEmpty"))).toBeInTheDocument();
    expect(screen.getByText(t("settings.skillDiagnosticsEmpty"))).toBeInTheDocument();
    expect(screen.getAllByText(t("settings.skillTagAssistantOnly")).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: t("settings.skillImportAction") }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: t("settings.skillImportAction") })).not.toBeInTheDocument();
    });
    expect(screen.getByText(t("settings.skillImportSuccess", {
      name: "sample-helper",
      target: t("settings.skillTargetClaudeCode")
    }))).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("settings.skillSyncAction") }));

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

function createSkillOverviewResponse({ imported }: { imported: boolean }) {
  return {
    summary: {
      managedSkillCount: 1,
      managedEntryCount: 1,
      unmanagedEntryCount: imported ? 0 : 1,
      conflictedEntryCount: 0,
      diagnosticCount: 0
    },
    managedSkills: [
      {
        skill: {
          id: "skill-1",
          name: "team-helper",
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
      }
    ],
    assistantRuntimeSkills: [
      {
        name: "codingns-assistant",
        directoryName: "codingns-assistant",
        sourcePath: "/repo/builtin-skills/codingns-assistant",
        usedByTargetCli: ["codex", "claude-code"]
      }
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
