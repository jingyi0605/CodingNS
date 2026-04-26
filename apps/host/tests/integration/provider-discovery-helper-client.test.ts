import { afterEach, describe, expect, it, vi } from "vitest";

describe("ProviderDiscoveryHelperClient", () => {
  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.doUnmock("node:readline");
    vi.resetModules();
  });

  it("构造 client 时不会提前拉起 provider helper，首个请求才会 spawn", async () => {
    const spawn = vi.fn(() => ({
      stdout: {},
      stderr: {
        on: vi.fn()
      },
      stdin: {
        destroyed: false,
        on: vi.fn(),
        write: vi.fn((_content: string, callback?: (error?: Error | null) => void) => {
          callback?.(null);
          return true;
        })
      },
      killed: false,
      kill: vi.fn(),
      on: vi.fn()
    }));

    vi.doMock("node:child_process", () => ({
      spawn
    }));
    vi.doMock("node:readline", () => ({
      default: {
        createInterface: vi.fn(() => ({
          on: vi.fn(),
          close: vi.fn()
        }))
      }
    }));

    const { ProviderDiscoveryHelperClient } = await import(
      "../../src/modules/provider/provider-discovery-helper-client.js"
    );

    const client = new ProviderDiscoveryHelperClient();
    expect(spawn).not.toHaveBeenCalled();

    const pending = client.readOpenCodeCliModels({
      commandPath: "/tmp/opencode",
      workspacePath: "/tmp/workspace",
      timeoutMs: 5000
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    client.dispose();
    await expect(pending).rejects.toThrow("provider discovery helper 已关闭");
  });

  it("AbortSignal 触发后会向 provider helper 发送 cancel 消息", async () => {
    const writes: string[] = [];
    const stdin = {
      destroyed: false,
      on: vi.fn(),
      write: vi.fn((content: string, callback?: (error?: Error | null) => void) => {
        writes.push(content.trim());
        callback?.(null);
        return true;
      })
    };
    const child = {
      stdout: {},
      stderr: {
        on: vi.fn()
      },
      stdin,
      killed: false,
      kill: vi.fn(),
      on: vi.fn()
    };
    const stdoutReader = {
      on: vi.fn(),
      close: vi.fn()
    };

    vi.doMock("node:child_process", () => ({
      spawn: vi.fn(() => child)
    }));
    vi.doMock("node:readline", () => ({
      default: {
        createInterface: vi.fn(() => stdoutReader)
      }
    }));

    const { ProviderDiscoveryHelperClient } = await import(
      "../../src/modules/provider/provider-discovery-helper-client.js"
    );
    const client = new ProviderDiscoveryHelperClient();
    const controller = new AbortController();
    const promise = client.readOpenCodeCliModels(
      {
        commandPath: "/tmp/opencode",
        workspacePath: "/tmp/workspace",
        timeoutMs: 5000
      },
      controller.signal
    );

    controller.abort(new Error("manual abort"));

    await expect(promise).rejects.toThrow("manual abort");
    expect(JSON.parse(writes[0])).toMatchObject({
      id: "1",
      type: "opencode_cli_models",
      commandPath: "/tmp/opencode",
      workspacePath: "/tmp/workspace",
      timeoutMs: 5000
    });
    expect(JSON.parse(writes[1])).toMatchObject({
      id: "cancel:1",
      type: "cancel",
      targetId: "1"
    });
  });

  it.each([
    {
      title: "discoverWorkspaceSessions",
      invoke: (
        client: {
          discoverWorkspaceSessions: (
            input: {
              config: Record<string, string | null>;
              workspacePath: string;
              knownSessions: [];
            },
            signal?: AbortSignal
          ) => Promise<unknown>;
        },
        signal: AbortSignal
      ) =>
        client.discoverWorkspaceSessions({
          config: {
            claudeCodeHomeDir: "/tmp/claude",
            legnaCodeHomeDir: "/tmp/legna",
            legnaCodeCliPath: "/tmp/legna-cli",
            codexCliPath: "/tmp/codex",
            codexHomeDir: "/tmp/codex-home",
            geminiCliPath: "/tmp/gemini",
            geminiHomeDir: "/tmp/gemini-home",
            kimiDefaultModel: null,
            kimiHomeDir: "/tmp/kimi-home",
            opencodeBaseUrl: "http://127.0.0.1:4096",
            opencodeDataDir: "/tmp/opencode",
            opencodeDbPath: "/tmp/opencode/opencode.db"
          },
          workspacePath: "/tmp/workspace",
          knownSessions: [],
          enabledProviders: ["codex"]
        }, signal),
      expectedType: "workspace_session_discovery"
    },
    {
      title: "readSessionTitle",
      invoke: (
        client: {
          readSessionTitle: (
            input: {
              config: Record<string, string | null>;
              provider: string;
              providerSessionId: string;
              rawStoreRef: string;
            },
            signal?: AbortSignal
          ) => Promise<unknown>;
        },
        signal: AbortSignal
      ) =>
        client.readSessionTitle({
          config: {
            claudeCodeHomeDir: "/tmp/claude",
            legnaCodeHomeDir: "/tmp/legna",
            legnaCodeCliPath: "/tmp/legna-cli",
            codexCliPath: "/tmp/codex",
            codexHomeDir: "/tmp/codex-home",
            geminiCliPath: "/tmp/gemini",
            geminiHomeDir: "/tmp/gemini-home",
            kimiDefaultModel: null,
            kimiHomeDir: "/tmp/kimi-home",
            opencodeBaseUrl: "http://127.0.0.1:4096",
            opencodeDataDir: "/tmp/opencode",
            opencodeDbPath: "/tmp/opencode/opencode.db"
          },
          provider: "claude-code",
          providerSessionId: "session-1",
          rawStoreRef: "/tmp/raw"
        }, signal),
      expectedType: "session_title_read"
    }
  ])("$title 触发 AbortSignal 后也会向 provider helper 发送 cancel 消息", async ({ invoke, expectedType }) => {
    const writes: string[] = [];
    const stdin = {
      destroyed: false,
      on: vi.fn(),
      write: vi.fn((content: string, callback?: (error?: Error | null) => void) => {
        writes.push(content.trim());
        callback?.(null);
        return true;
      })
    };
    const child = {
      stdout: {},
      stderr: {
        on: vi.fn()
      },
      stdin,
      killed: false,
      kill: vi.fn(),
      on: vi.fn()
    };
    const stdoutReader = {
      on: vi.fn(),
      close: vi.fn()
    };

    vi.doMock("node:child_process", () => ({
      spawn: vi.fn(() => child)
    }));
    vi.doMock("node:readline", () => ({
      default: {
        createInterface: vi.fn(() => stdoutReader)
      }
    }));

    const { ProviderDiscoveryHelperClient } = await import(
      "../../src/modules/provider/provider-discovery-helper-client.js"
    );
    const client = new ProviderDiscoveryHelperClient();
    const controller = new AbortController();
    const promise = invoke(client as never, controller.signal);

    controller.abort(new Error("manual abort"));

    await expect(promise).rejects.toThrow("manual abort");
    expect(JSON.parse(writes[0])).toMatchObject({
      id: "1",
      type: expectedType
    });
    expect(JSON.parse(writes[1])).toMatchObject({
      id: "cancel:1",
      type: "cancel",
      targetId: "1"
    });
  });

  it("provider helper 回收退出后，请求会自动拉起新进程并重试一次", async () => {
    const childEvents: Array<Record<string, (value?: unknown, extra?: unknown) => void>> = [];
    const lineHandlers: Array<(line: string) => void> = [];
    const writesByChild: string[][] = [];
    const spawn = vi.fn(() => {
      const writes: string[] = [];
      const events: Record<string, (value?: unknown, extra?: unknown) => void> = {};
      writesByChild.push(writes);
      childEvents.push(events);

      return {
        stdout: {},
        stderr: {
          on: vi.fn()
        },
        stdin: {
          destroyed: false,
          on: vi.fn(),
          write: vi.fn((content: string, callback?: (error?: Error | null) => void) => {
            writes.push(content.trim());
            callback?.(null);
            return true;
          })
        },
        killed: false,
        kill: vi.fn(),
        on: vi.fn((event: string, handler: (value?: unknown, extra?: unknown) => void) => {
          events[event] = handler;
        })
      };
    });

    vi.doMock("node:child_process", () => ({
      spawn
    }));
    vi.doMock("node:readline", () => ({
      default: {
        createInterface: vi.fn(() => ({
          on: vi.fn((event: string, handler: (line: string) => void) => {
            if (event === "line") {
              lineHandlers.push(handler);
            }
          }),
          close: vi.fn()
        }))
      }
    }));

    const { ProviderDiscoveryHelperClient } = await import(
      "../../src/modules/provider/provider-discovery-helper-client.js"
    );
    const client = new ProviderDiscoveryHelperClient();
    const config = {
      claudeCodeHomeDir: "/tmp/claude",
      legnaCodeHomeDir: "/tmp/legna",
      legnaCodeCliPath: "/tmp/legna-cli",
      codexCliPath: "/tmp/codex",
      codexHomeDir: "/tmp/codex-home",
      geminiCliPath: "/tmp/gemini",
      geminiHomeDir: "/tmp/gemini-home",
      kimiDefaultModel: null,
      kimiHomeDir: "/tmp/kimi-home",
      opencodeBaseUrl: "http://127.0.0.1:4096",
      opencodeDataDir: "/tmp/opencode",
      opencodeDbPath: "/tmp/opencode/opencode.db"
    };

    const firstPromise = client.discoverWorkspaceSessions({
      config,
      workspacePath: "/tmp/workspace-a",
      knownSessions: [],
      enabledProviders: ["codex"]
    });
    childEvents[0]?.exit?.(0, "SIGTERM");

    await vi.waitFor(() => {
      expect(lineHandlers.length).toBeGreaterThanOrEqual(2);
    });

    lineHandlers[1]?.(
      JSON.stringify({
        type: "result",
        id: "2",
        ok: true,
        result: {
          sessions: [],
          isComplete: true,
          providerDiagnostics: []
        }
      })
    );

    await expect(firstPromise).resolves.toEqual({
      sessions: [],
      isComplete: true,
      providerDiagnostics: []
    });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(writesByChild[0][0] ?? "{}")).toMatchObject({
      id: "1",
      type: "workspace_session_discovery",
      workspacePath: "/tmp/workspace-a"
    });
    expect(JSON.parse(writesByChild[1][0] ?? "{}")).toMatchObject({
      id: "2",
      type: "workspace_session_discovery",
      workspacePath: "/tmp/workspace-a"
    });
  });

  it("写请求时遇到 EPIPE 会重拉 helper 并自动重试一次", async () => {
    const lineHandlers: Array<(line: string) => void> = [];
    const writesByChild: string[][] = [];
    let spawnCount = 0;
    const spawn = vi.fn(() => {
      spawnCount += 1;
      const writes: string[] = [];
      writesByChild.push(writes);

      return {
        stdout: {},
        stderr: {
          on: vi.fn()
        },
        stdin: {
          destroyed: false,
          on: vi.fn(),
          write: vi.fn((content: string, callback?: (error?: Error | null) => void) => {
            writes.push(content.trim());

            if (spawnCount === 1) {
              const error = Object.assign(new Error("broken pipe"), {
                code: "EPIPE"
              });
              callback?.(error);
              return false;
            }

            callback?.(null);
            return true;
          })
        },
        killed: false,
        kill: vi.fn(),
        on: vi.fn()
      };
    });

    vi.doMock("node:child_process", () => ({
      spawn
    }));
    vi.doMock("node:readline", () => ({
      default: {
        createInterface: vi.fn(() => ({
          on: vi.fn((event: string, handler: (line: string) => void) => {
            if (event === "line") {
              lineHandlers.push(handler);
            }
          }),
          close: vi.fn()
        }))
      }
    }));

    const { ProviderDiscoveryHelperClient } = await import(
      "../../src/modules/provider/provider-discovery-helper-client.js"
    );
    const client = new ProviderDiscoveryHelperClient();
    const config = {
      claudeCodeHomeDir: "/tmp/claude",
      legnaCodeHomeDir: "/tmp/legna",
      legnaCodeCliPath: "/tmp/legna-cli",
      codexCliPath: "/tmp/codex",
      codexHomeDir: "/tmp/codex-home",
      geminiCliPath: "/tmp/gemini",
      geminiHomeDir: "/tmp/gemini-home",
      kimiDefaultModel: null,
      kimiHomeDir: "/tmp/kimi-home",
      opencodeBaseUrl: "http://127.0.0.1:4096",
      opencodeDataDir: "/tmp/opencode",
      opencodeDbPath: "/tmp/opencode/opencode.db"
    };

    const promise = client.discoverWorkspaceSessions({
      config,
      workspacePath: "/tmp/workspace-retry",
      knownSessions: [],
      enabledProviders: ["codex"]
    });

    await vi.waitFor(() => {
      expect(lineHandlers.length).toBeGreaterThanOrEqual(2);
    });

    lineHandlers[1]?.(
      JSON.stringify({
        type: "result",
        id: "2",
        ok: true,
        result: {
          sessions: [],
          isComplete: true,
          providerDiagnostics: []
        }
      })
    );

    await expect(promise).resolves.toEqual({
      sessions: [],
      isComplete: true,
      providerDiagnostics: []
    });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(writesByChild[0][0] ?? "{}")).toMatchObject({
      id: "1",
      type: "workspace_session_discovery",
      workspacePath: "/tmp/workspace-retry"
    });
    expect(JSON.parse(writesByChild[1][0] ?? "{}")).toMatchObject({
      id: "2",
      type: "workspace_session_discovery",
      workspacePath: "/tmp/workspace-retry"
    });
  });
});
