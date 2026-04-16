import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";

vi.mock("../../../shared/toast", () => ({
  useToast: vi.fn()
}));

vi.mock("../../conversation/components/WorkbenchLayout", () => ({
  useWorkbenchShell: vi.fn()
}));

vi.mock("../../terminal/api/terminal-api", () => ({
  listWorkspaceTemplates: vi.fn(),
  listWorkspaceTemplateRuntimeStatuses: vi.fn(),
  runTerminalTemplate: vi.fn()
}));

vi.mock("../../conversation/api/conversation-api", () => ({
  analyzeDebugTarget: vi.fn(),
  getFrameworkCompatibilityMatrix: vi.fn(),
  createDebugLaunchPlan: vi.fn()
}));

import { useToast } from "../../../shared/toast";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import {
  analyzeDebugTarget,
  createDebugLaunchPlan,
  getFrameworkCompatibilityMatrix
} from "../../conversation/api/conversation-api";
import {
  listWorkspaceTemplates,
  listWorkspaceTemplateRuntimeStatuses,
  runTerminalTemplate
} from "../../terminal/api/terminal-api";
import { WorkspaceDebugDetailPage } from "./WorkspaceDebugDetailPage";

const mockedUseToast = vi.mocked(useToast);
const mockedUseWorkbenchShell = vi.mocked(useWorkbenchShell);
const mockedAnalyzeDebugTarget = vi.mocked(analyzeDebugTarget);
const mockedCreateDebugLaunchPlan = vi.mocked(createDebugLaunchPlan);
const mockedGetFrameworkCompatibilityMatrix = vi.mocked(getFrameworkCompatibilityMatrix);
const mockedListWorkspaceTemplates = vi.mocked(listWorkspaceTemplates);
const mockedListWorkspaceTemplateRuntimeStatuses = vi.mocked(listWorkspaceTemplateRuntimeStatuses);
const mockedRunTerminalTemplate = vi.mocked(runTerminalTemplate);

describe("WorkspaceDebugDetailPage", () => {
  const showToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseToast.mockReturnValue({
      showToast,
      dismissToast: vi.fn()
    } as never);
    mockedUseWorkbenchShell.mockReturnValue({
      navigationGroups: [
        {
          workspace: {
            id: "workspace-1",
            name: "项目一",
            path: "/repo/project-one"
          },
          sessions: [],
          childWorktrees: []
        }
      ],
      selectWorkspace: vi.fn()
    } as never);
    mockedAnalyzeDebugTarget.mockResolvedValue({
      target: {
        id: "debug-target-1",
        workspaceId: "workspace-1",
        rootPath: "/repo/project-one",
        displayName: "project-one",
        sourceType: "repo",
        createdAt: "2026-04-16T08:00:00.000Z",
        updatedAt: "2026-04-16T08:00:00.000Z"
      },
      services: [
        {
          id: "service-1",
          targetId: "debug-target-1",
          role: "frontend",
          name: "web",
          cwd: "/repo/project-one/apps/web",
          command: "pnpm",
          args: ["dev"],
          env: {},
          defaultPortHint: 5173,
          protocol: "http",
          healthPath: null,
          adapterKind: "cli",
          frameworkAnalysisId: "analysis-1",
          createdAt: "2026-04-16T08:00:00.000Z",
          updatedAt: "2026-04-16T08:00:00.000Z"
        }
      ],
      analyses: [
        {
          id: "analysis-1",
          targetId: "debug-target-1",
          serviceId: "service-1",
          primaryFramework: "vite",
          confidence: "high",
          compatibilityLevel: "supported",
          recommendedInjectionMode: "cli",
          requiresServiceDiscoveryHandling: true,
          requiresHmrHandling: true,
          requiresCallbackHandling: false,
          aiFallbackPolicy: "conditional",
          reasons: ["检测到 vite.config.ts"],
          detectedFiles: ["package.json", "vite.config.ts"],
          createdAt: "2026-04-16T08:00:00.000Z"
        }
      ],
      autoInjectionEligible: true
    });
    mockedGetFrameworkCompatibilityMatrix.mockResolvedValue({
      version: "2026-04-16",
      items: [
        {
          framework: "vite",
          compatibilityLevel: "supported",
          recommendedInjectionMode: "cli",
          requiresServiceDiscoveryHandling: true,
          requiresHmrHandling: true,
          requiresCallbackHandling: false,
          aiFallbackPolicy: "conditional",
          notes: "Vite 端口入口清楚，第一阶段默认支持"
        }
      ]
    });
    mockedCreateDebugLaunchPlan.mockResolvedValue({
      runtimeSession: {
        id: "preview-runtime-1",
        targetId: "debug-target-1",
        status: "PREPARING",
        failureStage: null,
        startedAt: null,
        stoppedAt: null,
        createdAt: "2026-04-16T08:01:00.000Z",
        updatedAt: "2026-04-16T08:01:00.000Z"
      },
      targetId: "debug-target-1",
      autoStartAllowed: false,
      services: [
        {
          serviceId: "template-web",
          role: "frontend",
          frameworkAnalysisId: "analysis-1",
          primaryFramework: "vite",
          compatibilityLevel: "supported",
          adapterKind: "cli",
          injectionMode: "cli",
          command: "pnpm",
          args: ["dev", "--port", "43010"],
          envPatch: {
            VITE_API_BASE_URL: "http://127.0.0.1:44010"
          },
          expectedPort: 43000,
          leasedPort: 43010,
          artifactRef: null,
          runtimeBindingId: "binding-1",
          portLeaseId: null,
          requiresServiceDiscoveryHandling: true,
          requiresHmrHandling: true,
          requiresCallbackHandling: false,
          failureStage: null,
          adapterAttempts: [],
          aiFallback: null,
          missingRequirements: [],
          autoStartAllowed: true
        },
        {
          serviceId: "template-host",
          role: "backend",
          frameworkAnalysisId: "analysis-1",
          primaryFramework: "express",
          compatibilityLevel: "conditional",
          adapterKind: "env",
          injectionMode: "env",
          command: "pnpm",
          args: ["dev"],
          envPatch: {
            PORT: "44010"
          },
          expectedPort: 44000,
          leasedPort: 44010,
          artifactRef: null,
          runtimeBindingId: "binding-2",
          portLeaseId: null,
          requiresServiceDiscoveryHandling: false,
          requiresHmrHandling: false,
          requiresCallbackHandling: false,
          failureStage: null,
          adapterAttempts: [],
          aiFallback: null,
          missingRequirements: [],
          autoStartAllowed: true
        },
        {
          serviceId: "template-desktop",
          role: "custom",
          frameworkAnalysisId: null,
          primaryFramework: null,
          compatibilityLevel: "unknown",
          adapterKind: null,
          injectionMode: null,
          command: "pnpm",
          args: ["tauri", "dev"],
          envPatch: {},
          expectedPort: null,
          leasedPort: null,
          artifactRef: null,
          runtimeBindingId: "binding-3",
          portLeaseId: null,
          requiresServiceDiscoveryHandling: false,
          requiresHmrHandling: false,
          requiresCallbackHandling: false,
          failureStage: "framework_analysis_missing",
          adapterAttempts: [],
          aiFallback: null,
          missingRequirements: ["analysis"],
          autoStartAllowed: false
        }
      ]
    });
    mockedListWorkspaceTemplates.mockResolvedValue({
      items: [
        {
          id: "template-web",
          workspaceId: "workspace-1",
          name: "web",
          cwd: "/repo/project-one/apps/web",
          command: "pnpm",
          args: ["dev"],
          env: {},
          port: 43000,
          proxyEnabled: true,
          proxySlug: "web",
          runtimeType: "node",
          createdAt: "2026-04-16T08:00:00.000Z",
          updatedAt: "2026-04-16T08:00:00.000Z"
        },
        {
          id: "template-host",
          workspaceId: "workspace-1",
          name: "host",
          cwd: "/repo/project-one/apps/host",
          command: "pnpm",
          args: ["dev"],
          env: {},
          port: 44000,
          proxyEnabled: false,
          proxySlug: null,
          runtimeType: "node",
          createdAt: "2026-04-16T08:00:00.000Z",
          updatedAt: "2026-04-16T08:00:00.000Z"
        },
        {
          id: "template-desktop",
          workspaceId: "workspace-1",
          name: "desktop",
          cwd: "/repo/project-one/apps/desktop",
          command: "pnpm",
          args: ["tauri", "dev"],
          env: {},
          port: null,
          proxyEnabled: false,
          proxySlug: null,
          runtimeType: "node",
          createdAt: "2026-04-16T08:00:00.000Z",
          updatedAt: "2026-04-16T08:00:00.000Z"
        }
      ]
    });
    mockedListWorkspaceTemplateRuntimeStatuses.mockResolvedValue({
      items: [
        {
          templateId: "template-web",
          port: 43000,
          occupied: false,
          processId: null,
          processName: null,
          processCommandLine: null
        },
        {
          templateId: "template-host",
          port: 44000,
          occupied: true,
          processId: 2048,
          processName: "node",
          processCommandLine: "node host-dev.js"
        }
      ]
    });
    mockedRunTerminalTemplate.mockResolvedValue({
      terminalId: "terminal-1",
      templateId: "template-web",
      createdTerminal: true
    });

    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn()
    });
  });

  it("检查启动方案后会把方案区显示在已注册启动项之前", async () => {
    const user = userEvent.setup();

    renderPage();

    expect((await screen.findAllByText("apps/web")).length).toBeGreaterThan(0);
    expect(
      await screen.findByRole("heading", {
        name: t("shell.workspaceDetailRegisteredDebugAnalysisTitle")
      })
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t("shell.workspaceDetailDebugActionPlan") }));

    const launchPlanHeading = await screen.findByRole("heading", {
      name: t("shell.workspaceDetailDebugLaunchPlanTitle")
    });
    const templatesHeading = screen.getByRole("heading", {
      name: t("shell.workspaceDetailRegisteredDebugTemplatesTitle")
    });

    expect(
      Boolean(launchPlanHeading.compareDocumentPosition(templatesHeading) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);
    expect(screen.getAllByText("web").length).toBeGreaterThan(0);
    expect(screen.getAllByText("host").length).toBeGreaterThan(0);
    expect(screen.getAllByText("desktop").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        t("shell.workspaceDetailRegisteredDebugOverallSummary", { runnable: 0, orchestrated: 2, blocked: 1 })
      )
    ).toBeInTheDocument();
    expect(screen.getAllByText(t("shell.workspaceDetailRegisteredDebugSummaryOrchestratedCountLabel")).length).toBeGreaterThan(0);
  });

  it("启动已注册项时只会启动可直接运行的模板", async () => {
    const user = userEvent.setup();

    renderPage();

    expect((await screen.findAllByText("apps/web")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: t("shell.workspaceDetailRegisteredDebugActionRunRegistered") }));

    await waitFor(() => {
      expect(mockedRunTerminalTemplate).toHaveBeenCalledTimes(2);
    });
    expect(mockedRunTerminalTemplate).toHaveBeenCalledWith("template-web", {
      runtimeType: "node",
      argsOverride: ["dev", "--port", "43010"],
      envPatch: {
        VITE_API_BASE_URL: "http://127.0.0.1:44010"
      },
      portOverride: 43010
    });
    expect(mockedRunTerminalTemplate).toHaveBeenCalledWith("template-host", {
      runtimeType: "node",
      argsOverride: ["dev"],
      envPatch: {
        PORT: "44010"
      },
      portOverride: 44010
    });
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: t("shell.workspaceDetailRegisteredDebugActionRunRegisteredSuccess"),
        tone: "success"
      })
    );
  });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/workspaces/workspace-1/debug"]}>
      <Routes>
        <Route path="/workspaces/:workspaceId/debug" element={<WorkspaceDebugDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}
