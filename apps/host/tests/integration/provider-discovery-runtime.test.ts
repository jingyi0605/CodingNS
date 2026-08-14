import { afterEach, describe, expect, it, vi } from "vitest";

const DISCOVERY_RESULT = {
  sessions: [],
  isComplete: true,
  providerDiagnostics: []
};

describe("provider-discovery-runtime", () => {
  afterEach(() => {
    vi.doUnmock("@codingns/session-sync-core");
    vi.resetModules();
  });

  it("相同工作区且底层 store 未变化时会复用 inflight，并命中短 TTL 缓存", async () => {
    const discoverWorkspaceSessions = vi.fn(async () => DISCOVERY_RESULT);
    const readSessionTitle = vi.fn(async () => "title");

    vi.doMock("@codingns/session-sync-core", () => ({
      ClaudeCodeAdapter: class {},
      LegnaCodeAdapter: class {},
      CodexAdapter: class {},
      GeminiAdapter: class {},
      KimiAdapter: class {},
      OpenCodeAdapter: class {},
      ProviderRegistry: class {},
      SessionSyncService: class {
        discoverWorkspaceSessions = discoverWorkspaceSessions;
        readSessionTitle = readSessionTitle;
      }
    }));

    const runtime = await import("../../src/modules/provider/provider-discovery-runtime.js");
    const config = createConfig();
    const knownSessions = [
      {
        provider: "codex",
        providerSessionId: "provider-session-1",
        title: "session",
        workspacePath: "/tmp/workspace",
        rawStoreRef: "/tmp/workspace/.codex/session-1.json",
        lastMessageAt: "2026-04-17T00:00:00.000Z",
        messageCount: 1,
        sourceMtimeMs: 1,
        sourceSizeBytes: 64
      }
    ];

    const enabledProviders = ["codex"];
    await Promise.all([
      runtime.discoverWorkspaceSessionsInRuntime(config, "/tmp/workspace", knownSessions, enabledProviders),
      runtime.discoverWorkspaceSessionsInRuntime(config, "/tmp/workspace", [...knownSessions], enabledProviders)
    ]);

    expect(discoverWorkspaceSessions).toHaveBeenCalledTimes(1);

    await runtime.discoverWorkspaceSessionsInRuntime(config, "/tmp/workspace", knownSessions, enabledProviders);

    expect(discoverWorkspaceSessions).toHaveBeenCalledTimes(1);

    await runtime.discoverWorkspaceSessionsInRuntime(
      config,
      "/tmp/workspace",
      [
        {
          ...knownSessions[0],
          title: "session updated",
          lastMessageAt: "2026-04-17T01:00:00.000Z",
          messageCount: 99
        }
      ],
      enabledProviders
    );

    expect(discoverWorkspaceSessions).toHaveBeenCalledTimes(1);
  });

  it("相同标题读取会复用 inflight，并命中短 TTL 缓存", async () => {
    const discoverWorkspaceSessions = vi.fn(async () => DISCOVERY_RESULT);
    const readSessionTitle = vi.fn(async () => "标题");

    vi.doMock("@codingns/session-sync-core", () => ({
      ClaudeCodeAdapter: class {},
      LegnaCodeAdapter: class {},
      CodexAdapter: class {},
      GeminiAdapter: class {},
      KimiAdapter: class {},
      OpenCodeAdapter: class {},
      ProviderRegistry: class {},
      SessionSyncService: class {
        discoverWorkspaceSessions = discoverWorkspaceSessions;
        readSessionTitle = readSessionTitle;
      }
    }));

    const runtime = await import("../../src/modules/provider/provider-discovery-runtime.js");
    const config = createConfig();

    await Promise.all([
      runtime.readSessionTitleInRuntime(config, "codex", "provider-session-1", "/tmp/raw"),
      runtime.readSessionTitleInRuntime(config, "codex", "provider-session-1", "/tmp/raw")
    ]);

    expect(readSessionTitle).toHaveBeenCalledTimes(1);

    await runtime.readSessionTitleInRuntime(config, "codex", "provider-session-1", "/tmp/raw");

    expect(readSessionTitle).toHaveBeenCalledTimes(1);
  });

  it("创建 Claude adapter 时会带上额外 projects 根", async () => {
    const claudeAdapterOptions: unknown[] = [];
    const discoverWorkspaceSessions = vi.fn(async () => DISCOVERY_RESULT);
    const readSessionTitle = vi.fn(async () => "title");

    vi.doMock("@codingns/session-sync-core", () => ({
      ClaudeCodeAdapter: class {
        constructor(options: unknown) {
          claudeAdapterOptions.push(options);
        }
      },
      LegnaCodeAdapter: class {},
      CodexAdapter: class {},
      GeminiAdapter: class {},
      KimiAdapter: class {},
      OpenCodeAdapter: class {},
      ProviderRegistry: class {},
      SessionSyncService: class {
        discoverWorkspaceSessions = discoverWorkspaceSessions;
        readSessionTitle = readSessionTitle;
      }
    }));

    const runtime = await import("../../src/modules/provider/provider-discovery-runtime.js");
    const config = {
      ...createConfig(),
      claudeExtraProjectRoots: ["/tmp/runtime-home/projects"]
    };

    await runtime.discoverWorkspaceSessionsInRuntime(config, "/tmp/workspace", [], ["claude-code"]);

    expect(claudeAdapterOptions).toContainEqual({
      homeDir: "/tmp/claude",
      extraProjectRoots: ["/tmp/runtime-home/projects"]
    });
  });
});

function createConfig() {
  return {
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
}
