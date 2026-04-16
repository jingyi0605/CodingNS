import { afterEach, describe, expect, it, vi } from "vitest";

describe("ProviderDiscoveryHelperClient", () => {
  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.doUnmock("node:readline");
    vi.resetModules();
  });

  it("AbortSignal 触发后会向 provider helper 发送 cancel 消息", async () => {
    const writes: string[] = [];
    const stdin = {
      destroyed: false,
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
          knownSessions: []
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
});
