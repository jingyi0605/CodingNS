import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../../shared/toast";
import { authStore } from "../../auth/store/auth-store";
import type { WorkspaceSessionGroup } from "../../conversation/components/WorkbenchLayout";
import type {
  TerminalDto,
  TerminalTemplateDto,
  TerminalTemplateRuntimeStatusDto
} from "../../terminal/api/terminal-api";
import { TerminalManagerPanel } from "./TerminalManagerPanel";

interface MockTerminalManagerSnapshot {
  workspaceId: string;
  terminals: TerminalDto[];
  templates: TerminalTemplateDto[];
  templateStatuses: TerminalTemplateRuntimeStatusDto[];
}

let terminalManagerSnapshotListener: ((snapshot: MockTerminalManagerSnapshot) => void) | null = null;
let buildMockSnapshot = (): MockTerminalManagerSnapshot => ({
  workspaceId: "workspace-1",
  terminals: [],
  templates: [],
  templateStatuses: []
});

vi.mock("../../conversation/components/WorkbenchLayout", async () => {
  const actual = await vi.importActual("../../conversation/components/WorkbenchLayout");

  return {
    ...actual,
    useWorkbenchShell: () => ({
      navigationGroups,
      navigationLoading: false,
      navigationError: null,
      refreshNavigation: async () => undefined,
      requestNavigationRefresh: () => undefined,
      subscribeFileTree: () => undefined,
      requestFileTreeRefresh: () => undefined,
      addFileTreeSnapshotListener: () => () => undefined,
      subscribeGitSnapshot: () => undefined,
      requestGitRefresh: () => undefined,
      addGitSnapshotListener: () => () => undefined,
      subscribeTerminalManagerSnapshot: () => undefined,
      requestTerminalManagerRefresh: () => {
        terminalManagerSnapshotListener?.(buildMockSnapshot());
      },
      addTerminalManagerSnapshotListener: (listener: (snapshot: MockTerminalManagerSnapshot) => void) => {
        terminalManagerSnapshotListener = listener;
        return () => {
          if (terminalManagerSnapshotListener === listener) {
            terminalManagerSnapshotListener = null;
          }
        };
      },
      setSessionWorkspace: () => undefined,
      upsertNavigationSession: () => undefined,
      markNavigationSessionSeen: () => undefined
    })
  };
});

const originalFetch = global.fetch;

const navigationGroups: WorkspaceSessionGroup[] = [
  {
    workspace: {
      id: "workspace-1",
      name: "Demo Workspace",
      path: "C:/Code/demo",
      repoRoot: "C:/Code/demo"
    },
    sessions: []
  }
];

function renderPanel(currentWorkspaceId: string | null = "workspace-1") {
  return render(
    <ToastProvider>
      <TerminalManagerPanel currentWorkspaceId={currentWorkspaceId} navigationGroups={navigationGroups} />
    </ToastProvider>
  );
}

describe("TerminalManagerPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    authStore.clear();
    terminalManagerSnapshotListener = null;
    buildMockSnapshot = () => ({
      workspaceId: "workspace-1",
      terminals: [],
      templates: [],
      templateStatuses: []
    });
    authStore.hydrate({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("主面板不再显示工作区和 shell 下拉，改为用模态框创建快捷启动项", async () => {
    let savedTemplateBody: Record<string, unknown> | null = null;
    let stopRequested = false;
    let runtimeOccupied = true;
    buildMockSnapshot = () => ({
      workspaceId: "workspace-1",
      terminals: [],
      templates: [
        {
          id: "template-1",
          workspaceId: "workspace-1",
          name: "启动前端",
          cwd: "C:/Code/demo",
          command: "pnpm",
          args: ["dev"],
          env: {},
          port: 5173,
          createdAt: "2026-03-24T00:00:00.000Z",
          updatedAt: "2026-03-24T00:10:00.000Z"
        }
      ],
      templateStatuses: runtimeOccupied
        ? [
            {
              templateId: "template-1",
              port: 5173,
              occupied: true,
              processId: 3250,
              processName: "node",
              processCommandLine: "node node_modules/vite/bin/vite.js --port 5173"
            }
          ]
        : [
            {
              templateId: "template-1",
              port: 5173,
              occupied: false,
              processId: null,
              processName: null,
              processCommandLine: null
            }
          ]
    });

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/api/terminals/shells")) {
        return createJsonResponse({
          items: [
            {
              id: "powershell",
              label: "PowerShell",
              shell: "powershell.exe",
              available: true,
              unavailableReason: null
            }
          ]
        });
      }

      if (url.endsWith("/api/terminals/templates") && init?.method === "POST") {
        savedTemplateBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return createJsonResponse({
          id: "template-2",
          workspaceId: "workspace-1",
          name: savedTemplateBody.name,
          cwd: savedTemplateBody.cwd ?? "C:/Code/demo",
          command: savedTemplateBody.command,
          args: savedTemplateBody.args ?? [],
          env: {},
          port: savedTemplateBody.port ?? null,
          createdAt: "2026-03-24T00:20:00.000Z",
          updatedAt: "2026-03-24T00:20:00.000Z"
        });
      }

      if (url.endsWith("/api/terminals/templates/template-1/stop") && init?.method === "POST") {
        stopRequested = true;
        runtimeOccupied = false;
        return createJsonResponse({
          success: true,
          processId: 3250,
          alreadyStopped: false
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    renderPanel();

    expect(screen.queryByText("当前工作区")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("例如：npm")).not.toBeInTheDocument();

    expect(await screen.findByRole("heading", { level: 2, name: "启动项" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "刷新列表" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "添加快捷启动项" })).toBeInTheDocument();
    expect(await screen.findByText("进程已启动")).toBeInTheDocument();
    expect(screen.queryByText("node node_modules/vite/bin/vite.js --port 5173")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "显示详细信息" }));

    expect(await screen.findByText("node node_modules/vite/bin/vite.js --port 5173")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "隐藏详细信息" }));

    await waitFor(() => {
      expect(screen.queryByText("node node_modules/vite/bin/vite.js --port 5173")).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "结束进程" }));

    await waitFor(() => {
      expect(stopRequested).toBe(true);
    });
    expect(await screen.findByText("端口暂未被占用")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "添加快捷启动项" }));

    expect(await screen.findByRole("dialog", { name: "添加快捷启动项" })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "脚本" }));
    await userEvent.type(
      screen.getByPlaceholderText("例如：scripts/dev.ps1 或 scripts/dev.sh"),
      "scripts/dev.ps1"
    );
    await userEvent.type(
      screen.getByPlaceholderText("留空时默认使用工作区根目录"),
      "apps/user-app"
    );
    await userEvent.type(
      screen.getByPlaceholderText("例如：run dev 或 --watch"),
      "-Port 5173"
    );
    await userEvent.type(screen.getByPlaceholderText("例如：3000"), "5173");

    await userEvent.click(screen.getByRole("button", { name: "保存为快速启动" }));

    await waitFor(() => {
      expect(savedTemplateBody).toEqual({
        workspaceId: "workspace-1",
        name: "scripts/dev.ps1 -Port 5173",
        cwd: "apps/user-app",
        command: "scripts/dev.ps1",
        args: ["-Port", "5173"],
        port: 5173
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "添加快捷启动项" })).not.toBeInTheDocument();
    });
  });

  it("没有当前会话工作区时显示空状态", async () => {
    renderPanel(null);

    expect(
      await screen.findByText("先选中一条会话，进程管理才能绑定对应的工作区。")
    ).toBeInTheDocument();
  });
});

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
