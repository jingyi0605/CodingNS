import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformProvider } from "../../../platform/platform-provider";
import { I18nProvider, t } from "../../../shared/i18n";
import { ThemeProvider } from "../../../shared/theme";
import { ToastProvider } from "../../../shared/toast";
import { PluginDetailPage } from "./PluginDetailPage";

vi.mock("../api/plugins-api", async () => {
  const actual = await vi.importActual<typeof import("../api/plugins-api")>("../api/plugins-api");

  return {
    ...actual,
    getPlugin: vi.fn(async () => ({
      definition: {
        id: "demo.plugin",
        version: "1.0.0",
        name: "演示插件",
        installRoot: "/plugins/demo",
        manifestJson: "{}",
        hasFrontend: true,
        hasBackend: true,
        createdAt: "2026-05-21T00:00:00.000Z",
        updatedAt: "2026-05-21T00:00:00.000Z"
      },
      manifest: {
        id: "demo.plugin",
        name: "演示插件",
        version: "1.0.0",
        frontend: {
          entry: "index.html",
          mode: "static_html"
        },
        backend: {
          runtime: "node",
          mode: "on_demand",
          actions: [
            {
              id: "run-report",
              title: "运行报表",
              entry: "action.js",
              timeoutMs: 3000
            }
          ]
        },
        permissions: {
          workspaceRead: true,
          workspaceWrite: true,
          network: false,
          desktop: ["open_file"]
        }
      },
      enablement: {
        pluginId: "demo.plugin",
        enabled: true,
        enabledByUserId: "user-1",
        enabledAt: "2026-05-21T00:00:00.000Z",
        disabledByUserId: null,
        disabledAt: null,
        reason: null,
        updatedAt: "2026-05-21T00:00:00.000Z"
      },
      auditEvents: [
        {
          id: "audit-1",
          pluginId: "demo.plugin",
          workspaceId: "workspace-1",
          eventType: "plugin.permission_granted",
          actorUserId: "user-1",
          payloadJson: JSON.stringify({
            permissionKey: "workspace.write_file",
            scopeType: "directory",
            scopePath: "reports",
            grantMode: "persistent"
          }),
          createdAt: "2026-05-21T00:00:00.000Z"
        }
      ],
      frontend: {
        basePath: "/preview/plugins/demo.plugin/frontend",
        entryUrl: "/preview/plugins/demo.plugin/frontend/index.html"
      }
    })),
    listPluginRuns: vi.fn(async () => ({
      items: [
        {
          id: "run-1",
          pluginId: "demo.plugin",
          workspaceId: "workspace-1",
          runtimeSessionId: "runtime-1",
          triggerKind: "frontend",
          actionId: "run-report",
          status: "succeeded",
          inputSummaryJson: null,
          outputSummaryJson: null,
          errorCode: null,
          errorMessage: null,
          startedAt: "2026-05-21T00:00:00.000Z",
          finishedAt: "2026-05-21T00:00:01.000Z",
          createdAt: "2026-05-21T00:00:00.000Z"
        }
      ]
    })),
    listPluginPermissionGrants: vi.fn(async () => ({
      items: [
        {
          id: "grant-1",
          pluginId: "demo.plugin",
          workspaceId: "workspace-1",
          permissionKey: "workspace.write_file",
          scopeType: "directory",
          scopePath: "reports",
          grantMode: "persistent",
          grantedByUserId: "user-1",
          runtimeSessionId: null,
          createdAt: "2026-05-21T00:00:00.000Z",
          expiresAt: null,
          revokedAt: null
        }
      ]
    })),
    revokePluginPermissionGrant: vi.fn(async () => ({
      id: "grant-1",
      pluginId: "demo.plugin",
      workspaceId: "workspace-1",
      permissionKey: "workspace.write_file",
      scopeType: "directory",
      scopePath: "reports",
      grantMode: "persistent",
      grantedByUserId: "user-1",
      runtimeSessionId: null,
      createdAt: "2026-05-21T00:00:00.000Z",
      expiresAt: null,
      revokedAt: "2026-05-21T00:05:00.000Z"
    })),
    enablePlugin: vi.fn(),
    disablePlugin: vi.fn()
  };
});

describe("PluginDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("会展示当前工作区授权摘要，并支持撤销授权", async () => {
    render(
      <PlatformProvider>
        <I18nProvider language="zh-CN">
          <ThemeProvider>
            <ToastProvider>
              <MemoryRouter initialEntries={["/workspaces/workspace-1/plugins/demo.plugin"]}>
                <Routes>
                  <Route path="/workspaces/:workspaceId/plugins/:pluginId" element={<PluginDetailPage />} />
                </Routes>
              </MemoryRouter>
            </ToastProvider>
          </ThemeProvider>
        </I18nProvider>
      </PlatformProvider>
    );

    expect(await screen.findByText(/Permissions already allowed in this workspace|当前工作区已授权内容/)).toBeInTheDocument();
    expect(screen.getByText(/Recent permission activity|最近授权相关记录/)).toBeInTheDocument();
    expect(screen.getAllByText(/Write files|写入文件/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Directory: reports · Keep it long term|目录：reports · 长期保留/).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: /Revoke|撤销授权/ }));

    expect(await screen.findByText(/The plugin permission was revoked\.|插件授权已撤销。/)).toBeInTheDocument();
  });
});
