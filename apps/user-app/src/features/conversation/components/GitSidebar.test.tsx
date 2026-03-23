import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore } from "../../auth/store/auth-store";
import type { GitHistoryItemDto, GitStatusDto } from "../api/git-api";
import { GitSidebar } from "./GitSidebar";

const originalFetch = global.fetch;

describe("GitSidebar", () => {
  beforeEach(() => {
    window.localStorage.clear();
    authStore.clear();
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

  it("在会话侧栏里展示 Git 状态、差异并支持暂存切换", async () => {
    const status: GitStatusDto = {
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/repo",
        branch: "main",
        ahead: 1,
        behind: 0,
        hasRemote: true,
        isDirty: true,
        lastFetchedAt: null
      },
      changes: [
        {
          path: "README.md",
          status: "M",
          staged: false,
          oldPath: null,
          binary: false,
          stagedStatus: null,
          worktreeStatus: "M"
        }
      ]
    };

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/git/status?")) {
        return createJsonResponse(status);
      }

      if (url.includes("/api/git/rules?")) {
        return createJsonResponse({
          id: "rule-1",
          workspaceId: "workspace-1",
          name: "默认规则",
          subjectPattern: "^(?<type>[a-z]+)(\\([^)]+\\))?:\\s(?<subject>.+)$",
          maxSubjectLength: 72,
          language: "zh",
          requireBody: false,
          requireIssue: false,
          issuePattern: "#\\d+",
          updatedAt: "2026-03-23T00:00:00.000Z"
        });
      }

      if (url.includes("/api/git/history?")) {
        return createJsonResponse({
          items: [],
          cursor: "0",
          nextCursor: null
        });
      }

      if (url.includes("/api/git/branches?")) {
        return createJsonResponse({
          currentBranch: "main",
          local: [{ name: "main", current: true, upstream: "origin/main", remote: false }],
          remote: [{ name: "origin/main", current: false, upstream: null, remote: true }]
        });
      }

      if (url.includes("/api/git/diff?")) {
        return createJsonResponse({
          workspaceId: "workspace-1",
          path: "README.md",
          staged: false,
          binary: false,
          truncated: false,
          content: "@@ -1,3 +1,4 @@\n+第二行改动"
        });
      }

      if (url.endsWith("/api/git/stage") && init?.method === "POST") {
        status.changes[0] = {
          ...status.changes[0],
          staged: true,
          stagedStatus: "M"
        };
        return createJsonResponse(status);
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    render(<GitSidebar workspaceId="workspace-1" />);

    expect(await screen.findByText("Git 上下文")).toBeInTheDocument();
    expect(await screen.findByText("README.md")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /README\.md/ }));
    await waitFor(() => {
      expect(document.querySelector(".git-diff-preview")).toHaveTextContent("@@ -1,3 +1,4 @@");
      expect(document.querySelector(".git-diff-preview")).toHaveTextContent("+第二行改动");
    });

    await userEvent.click(screen.getByRole("button", { name: "暂存" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "取消暂存" })).toBeInTheDocument();
    });
  });

  it("在侧栏里执行草稿生成、规则校验和提交", async () => {
    const status: GitStatusDto = {
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/repo",
        branch: "main",
        ahead: 0,
        behind: 0,
        hasRemote: true,
        isDirty: true,
        lastFetchedAt: null
      },
      changes: [
        {
          path: "README.md",
          status: "M",
          staged: true,
          oldPath: null,
          binary: false,
          stagedStatus: "M",
          worktreeStatus: null
        }
      ]
    };
    const history: GitHistoryItemDto[] = [
      {
        commitHash: "1111111111111111111111111111111111111111",
        authorName: "CodingNS Test",
        authoredAt: "2026-03-23T00:00:00.000Z",
        subject: "chore(init): 初始化仓库",
        body: "- 初始提交"
      }
    ];

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/git/status?")) {
        return createJsonResponse(status);
      }

      if (url.includes("/api/git/rules?")) {
        return createJsonResponse({
          id: "rule-1",
          workspaceId: "workspace-1",
          name: "严格中文规则",
          subjectPattern: "^(?<type>[a-z]+)(\\([^)]+\\))?:\\s(?<subject>.+)$",
          maxSubjectLength: 72,
          language: "zh",
          requireBody: true,
          requireIssue: true,
          issuePattern: "#\\d+",
          updatedAt: "2026-03-23T00:00:00.000Z"
        });
      }

      if (url.includes("/api/git/history?")) {
        return createJsonResponse({
          items: history,
          cursor: "0",
          nextCursor: null
        });
      }

      if (url.includes("/api/git/branches?")) {
        return createJsonResponse({
          currentBranch: "main",
          local: [{ name: "main", current: true, upstream: "origin/main", remote: false }],
          remote: [{ name: "origin/main", current: false, upstream: null, remote: true }]
        });
      }

      if (url.endsWith("/api/git/commit/draft") && init?.method === "POST") {
        return createJsonResponse({
          ruleProfile: {
            id: "rule-1",
            workspaceId: "workspace-1",
            name: "严格中文规则",
            subjectPattern: "^(?<type>[a-z]+)(\\([^)]+\\))?:\\s(?<subject>.+)$",
            maxSubjectLength: 72,
            language: "zh",
            requireBody: true,
            requireIssue: true,
            issuePattern: "#\\d+",
            updatedAt: "2026-03-23T00:00:00.000Z"
          },
          draft: {
            subject: "chore(readme): update README",
            body: "",
            footer: "",
            source: "ai"
          },
          validation: {
            passed: false,
            errors: [
              {
                code: "LANGUAGE_MISMATCH",
                field: "subject",
                detail: "当前仓库要求提交标题使用中文"
              }
            ],
            warnings: [],
            normalizedDraft: {
              subject: "chore(readme): update README",
              body: null,
              footer: null,
              source: "ai"
            }
          }
        });
      }

      if (url.endsWith("/api/git/commit/validate") && init?.method === "POST") {
        return createJsonResponse({
          ruleProfile: {
            id: "rule-1",
            workspaceId: "workspace-1",
            name: "严格中文规则",
            subjectPattern: "^(?<type>[a-z]+)(\\([^)]+\\))?:\\s(?<subject>.+)$",
            maxSubjectLength: 72,
            language: "zh",
            requireBody: true,
            requireIssue: true,
            issuePattern: "#\\d+",
            updatedAt: "2026-03-23T00:00:00.000Z"
          },
          validation: {
            passed: true,
            errors: [],
            warnings: [],
            normalizedDraft: {
              subject: "chore(readme): 更新 README",
              body: "- 调整 README.md",
              footer: "Refs: #123",
              source: "manual"
            }
          }
        });
      }

      if (url.endsWith("/api/git/commit") && init?.method === "POST") {
        status.snapshot.isDirty = false;
        status.changes = [];
        history.unshift({
          commitHash: "2222222222222222222222222222222222222222",
          authorName: "CodingNS Test",
          authoredAt: "2026-03-23T01:00:00.000Z",
          subject: "chore(readme): 更新 README",
          body: "- 调整 README.md"
        });

        return createJsonResponse({
          commitHash: "2222222222222222222222222222222222222222",
          ruleProfile: {
            id: "rule-1",
            workspaceId: "workspace-1",
            name: "严格中文规则",
            subjectPattern: "^(?<type>[a-z]+)(\\([^)]+\\))?:\\s(?<subject>.+)$",
            maxSubjectLength: 72,
            language: "zh",
            requireBody: true,
            requireIssue: true,
            issuePattern: "#\\d+",
            updatedAt: "2026-03-23T00:00:00.000Z"
          },
          validation: {
            passed: true,
            errors: [],
            warnings: [],
            normalizedDraft: {
              subject: "chore(readme): 更新 README",
              body: "- 调整 README.md",
              footer: "Refs: #123",
              source: "manual"
            }
          }
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    render(<GitSidebar workspaceId="workspace-1" />);

    expect(await screen.findByText("提交草稿")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "AI 起草" }));
    expect(await screen.findByDisplayValue("chore(readme): update README")).toBeInTheDocument();
    expect(await screen.findByText("当前仓库要求提交标题使用中文")).toBeInTheDocument();

    const subjectInput = screen.getByDisplayValue("chore(readme): update README");
    await userEvent.clear(subjectInput);
    await userEvent.type(subjectInput, "chore(readme): 更新 README");

    const bodyField = screen.getByPlaceholderText("把这次改动说清楚，别写空话。");
    await userEvent.type(bodyField, "- 调整 README.md");

    const footerInput = screen.getByPlaceholderText("例如：Refs: #123");
    await userEvent.type(footerInput, "Refs: #123");

    await userEvent.click(screen.getByRole("button", { name: "校验草稿" }));
    expect(await screen.findByText("规则校验通过，可以继续提交。")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "执行提交" }));
    expect(await screen.findByText("提交已经写入当前仓库。")).toBeInTheDocument();
    expect(await screen.findByText("chore(readme): 更新 README")).toBeInTheDocument();
  });

  it("在远程同步失败时展示明确错误提示", async () => {
    const status: GitStatusDto = {
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/repo",
        branch: "main",
        ahead: 0,
        behind: 0,
        hasRemote: true,
        isDirty: false,
        lastFetchedAt: null
      },
      changes: []
    };

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/git/status?")) {
        return createJsonResponse(status);
      }

      if (url.includes("/api/git/rules?")) {
        return createJsonResponse({
          id: "rule-1",
          workspaceId: "workspace-1",
          name: "默认规则",
          subjectPattern: "^(?<type>[a-z]+)(\\([^)]+\\))?:\\s(?<subject>.+)$",
          maxSubjectLength: 72,
          language: "zh",
          requireBody: false,
          requireIssue: false,
          issuePattern: "#\\d+",
          updatedAt: "2026-03-23T00:00:00.000Z"
        });
      }

      if (url.includes("/api/git/history?")) {
        return createJsonResponse({
          items: [],
          cursor: "0",
          nextCursor: null
        });
      }

      if (url.includes("/api/git/branches?")) {
        return createJsonResponse({
          currentBranch: "main",
          local: [{ name: "main", current: true, upstream: "origin/main", remote: false }],
          remote: [{ name: "origin/main", current: false, upstream: null, remote: true }]
        });
      }

      if (url.endsWith("/api/git/remote/sync") && init?.method === "POST") {
        return createErrorResponse(401, {
          error_code: "GIT_REMOTE_AUTH_FAILED",
          detail: "远程仓库认证失败"
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    render(<GitSidebar workspaceId="workspace-1" />);

    expect(await screen.findByText("远程同步")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Push" }));

    expect(await screen.findByText("远程仓库认证失败，请先确认当前仓库凭据可用。")).toBeInTheDocument();
  });

  it.each([
    {
      name: "pull 失败提示",
      actionLabel: "Pull",
      status: 500,
      errorCode: "GIT_PULL_FAILED",
      detail: "pull failed",
      expected: "拉取失败，请先确认远程分支状态。"
    },
    {
      name: "超时提示",
      actionLabel: "Fetch",
      status: 504,
      errorCode: "GIT_COMMAND_TIMEOUT",
      detail: "Git 命令执行超时：git fetch origin",
      expected: "Git 操作超时了，先确认仓库状态和网络环境。"
    },
    {
      name: "网络失败提示",
      actionLabel: "Fetch",
      status: 502,
      errorCode: "GIT_REMOTE_FAILED",
      detail: "远程网络异常，暂时无法完成同步",
      expected: "远程同步失败，请检查 Git 输出和网络状态。"
    }
  ])("在远程同步场景里展示 $name", async ({ actionLabel, status, errorCode, detail, expected }) => {
    const baseStatus: GitStatusDto = {
      snapshot: {
        workspaceId: "workspace-1",
        repoRoot: "C:/repo",
        branch: "main",
        ahead: 0,
        behind: 0,
        hasRemote: true,
        isDirty: false,
        lastFetchedAt: null
      },
      changes: []
    };

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/git/status?")) {
        return createJsonResponse(baseStatus);
      }

      if (url.includes("/api/git/rules?")) {
        return createJsonResponse({
          id: "rule-1",
          workspaceId: "workspace-1",
          name: "默认规则",
          subjectPattern: "^(?<type>[a-z]+)(\\([^)]+\\))?:\\s(?<subject>.+)$",
          maxSubjectLength: 72,
          language: "zh",
          requireBody: false,
          requireIssue: false,
          issuePattern: "#\\d+",
          updatedAt: "2026-03-23T00:00:00.000Z"
        });
      }

      if (url.includes("/api/git/history?")) {
        return createJsonResponse({
          items: [],
          cursor: "0",
          nextCursor: null
        });
      }

      if (url.includes("/api/git/branches?")) {
        return createJsonResponse({
          currentBranch: "main",
          local: [{ name: "main", current: true, upstream: "origin/main", remote: false }],
          remote: [{ name: "origin/main", current: false, upstream: null, remote: true }]
        });
      }

      if (url.endsWith("/api/git/remote/sync") && init?.method === "POST") {
        return createErrorResponse(status, {
          error_code: errorCode,
          detail
        });
      }

      throw new Error(`未处理的请求: ${url}`);
    }) as typeof fetch;

    render(<GitSidebar workspaceId="workspace-1" />);

    expect(await screen.findByText("远程同步")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: actionLabel }));

    expect(await screen.findByText(expected)).toBeInTheDocument();
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

function createErrorResponse(
  status: number,
  payload: {
    error_code: string;
    detail: string;
    field?: string;
  }
): Response {
  return createJsonResponse(
    {
      ...payload,
      timestamp: "2026-03-23T00:00:00.000Z"
    },
    status
  );
}
