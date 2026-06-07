import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AffairsLightweightSessionService } from "../../src/modules/workspace/affairs-lightweight-session-service.js";

describe("AffairsLightweightSessionService", () => {
  const originalHome = process.env.HOME;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalLightweightOpenAiKey = process.env.CODINGNS_LIGHTWEIGHT_OPENAI_API_KEY;
  const originalOpenAiModel = process.env.OPENAI_MODEL;
  const originalLightweightOpenAiModel = process.env.CODINGNS_LIGHTWEIGHT_OPENAI_MODEL;
  const originalFetch = global.fetch;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.CODINGNS_LIGHTWEIGHT_OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    delete process.env.CODINGNS_LIGHTWEIGHT_OPENAI_MODEL;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    restoreEnv("OPENAI_API_KEY", originalOpenAiKey);
    restoreEnv("CODINGNS_LIGHTWEIGHT_OPENAI_API_KEY", originalLightweightOpenAiKey);
    restoreEnv("OPENAI_MODEL", originalOpenAiModel);
    restoreEnv("CODINGNS_LIGHTWEIGHT_OPENAI_MODEL", originalLightweightOpenAiModel);
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("轻量 Codex 会保存图片和文件附件，并把它们放进模型请求", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "affairs-lightweight-home-"));
    process.env.HOME = homeDir;
    await fs.mkdir(path.join(homeDir, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".codex", "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "proxy-key" }),
      "utf8"
    );
    await fs.writeFile(
      path.join(homeDir, ".codex", "config.toml"),
      [
        'model = "gpt-5.4"',
        'model_provider = "proxy"',
        "",
        "[model_providers.proxy]",
        'base_url = "https://api.glor-ai.top:1443"'
      ].join("\n"),
      "utf8"
    );

    let requestPayload: any = null;
    global.fetch = vi.fn(async (_input, init) => {
      requestPayload = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({ output_text: "附件已读取" }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    const hostDataRootDir = await fs.mkdtemp(path.join(os.tmpdir(), "affairs-lightweight-data-"));
    const service = new AffairsLightweightSessionService(hostDataRootDir);
    const result = await service.startSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "codex",
      content: "看看附件",
      clientRequestId: "client-attachment-1",
      attachments: [
        {
          kind: "image",
          fileName: "demo.png",
          mimeType: "image/png",
          fileSize: 3,
          contentBase64: "aW1n"
        },
        {
          kind: "file",
          fileName: "note.txt",
          mimeType: "text/plain",
          fileSize: 11,
          contentBase64: Buffer.from("hello file", "utf8").toString("base64")
        }
      ]
    });

    expect(result.userMessage.attachments).toEqual([
      expect.objectContaining({ kind: "image", fileName: "demo.png", mimeType: "image/png" }),
      expect.objectContaining({ kind: "file", fileName: "note.txt", mimeType: "text/plain" })
    ]);
    const userInput = requestPayload.input.find((item: any) => item.role === "user");
    expect(userInput.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "input_image", image_url: "data:image/png;base64,aW1n" }),
      expect.objectContaining({ type: "input_text", text: expect.stringContaining("hello file") })
    ]));
  });

  it("会优先复用现有 Codex CLI provider 配置，并在第三方代理下走轻量 runtime", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "affairs-lightweight-home-"));
    process.env.HOME = homeDir;
    await fs.mkdir(path.join(homeDir, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".codex", "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "proxy-key" }),
      "utf8"
    );
    await fs.writeFile(
      path.join(homeDir, ".codex", "config.toml"),
      [
        'model = "gpt-5.4"',
        'model_provider = "proxy"',
        "",
        "[model_providers.proxy]",
        'base_url = "https://api.glor-ai.top:1443"'
      ].join("\n"),
      "utf8"
    );

    const hostDataRootDir = await fs.mkdtemp(path.join(os.tmpdir(), "affairs-lightweight-data-"));
    const service = new AffairsLightweightSessionService(hostDataRootDir);
    global.fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe("https://api.glor-ai.top:1443/responses");
      const payload = JSON.parse(String(init?.body ?? "{}"));
      expect(payload.tools).toEqual([
        expect.objectContaining({
          type: "web_search"
        })
      ]);
      expect(payload.input?.[0]).toEqual(expect.objectContaining({
        role: "system"
      }));
      return new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "hello"
                }
              ]
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    const result = await service.startSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "codex",
      content: "对话测试"
    });

    expect(result.assistantMessage.content).toBe("hello");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("优先使用独立 lightweight-runtime.json 里的 OpenAI 官方 key", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "affairs-lightweight-home-"));
    process.env.HOME = homeDir;

    const hostDataRootDir = await fs.mkdtemp(path.join(os.tmpdir(), "affairs-lightweight-data-"));
    await fs.writeFile(
      path.join(hostDataRootDir, "lightweight-runtime.json"),
      JSON.stringify({
        openai: {
          apiKey: "official-key",
          model: "gpt-5.4"
        }
      }),
      "utf8"
    );

    global.fetch = vi.fn(async (input) => {
      expect(String(input)).toBe("https://api.openai.com/v1/responses");
      return new Response(
        JSON.stringify({
          output_text: "hello"
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    const service = new AffairsLightweightSessionService(hostDataRootDir);
    const result = await service.startSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "codex",
      content: "对话测试"
    });

    expect(result.assistantMessage.content).toBe("hello");
    expect(result.session.runningState).toBe("completed");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("responses 没返回正文时，会自动 fallback 到 chat completions", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "affairs-lightweight-home-"));
    process.env.HOME = homeDir;
    await fs.mkdir(path.join(homeDir, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".codex", "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "proxy-key" }),
      "utf8"
    );
    await fs.writeFile(
      path.join(homeDir, ".codex", "config.toml"),
      [
        'model = "gpt-5.4"',
        'model_provider = "proxy"',
        "",
        "[model_providers.proxy]",
        'base_url = "https://api.glor-ai.top:1443"'
      ].join("\n"),
      "utf8"
    );

    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/responses")) {
        return new Response(
          JSON.stringify({
            output: []
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }
      if (url.endsWith("/v1/chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "fallback hello"
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;

    const hostDataRootDir = await fs.mkdtemp(path.join(os.tmpdir(), "affairs-lightweight-data-"));
    const service = new AffairsLightweightSessionService(hostDataRootDir);
    const result = await service.startSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "codex",
      content: "对话测试"
    });

    expect(result.assistantMessage.content).toBe("fallback hello");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("轻量 Codex 会把联网搜索工具消息持久化到历史里，并保留 query 和 sources", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "affairs-lightweight-home-"));
    process.env.HOME = homeDir;
    await fs.mkdir(path.join(homeDir, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".codex", "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "proxy-key" }),
      "utf8"
    );
    await fs.writeFile(
      path.join(homeDir, ".codex", "config.toml"),
      [
        'model = "gpt-5.4"',
        'model_provider = "proxy"',
        "",
        "[model_providers.proxy]",
        'base_url = "https://api.glor-ai.top:1443"'
      ].join("\n"),
      "utf8"
    );

    global.fetch = vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            [
              "event: response.web_search_call.searching",
              'data: {"type":"response.web_search_call.searching","item_id":"search-1","action":{"query":"OpenAI news today"}}',
              "",
              "event: response.web_search_call.completed",
              'data: {"type":"response.web_search_call.completed","item_id":"search-1","action":{"query":"OpenAI news today","sources":[{"title":"OpenAI official","url":"https://openai.com/index/example"},{"title":"AP News","url":"https://apnews.com/example"}]}}',
              "",
              "event: response.output_text.delta",
              'data: {"type":"response.output_text.delta","delta":"hello"}',
              "",
              "data: [DONE]",
              ""
            ].join("\n")
          ));
          controller.close();
        }
      }),
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream"
        }
      }
    )) as typeof fetch;

    const hostDataRootDir = await fs.mkdtemp(path.join(os.tmpdir(), "affairs-lightweight-data-"));
    const service = new AffairsLightweightSessionService(hostDataRootDir);
    let sessionId: string | null = null;
    await service.startSessionStream({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "codex",
      content: "对话测试"
    }, (event) => {
      if (event.type === "started") {
        sessionId = event.session.sessionId;
      }
    });

    expect(sessionId).toBeTruthy();
    const history = await service.readMessages("workspace-1", sessionId!, "user-1");
    expect(history.messages.map((message) => `${message.role}:${message.kind}`)).toEqual([
      "user:text",
      "tool:tool_result",
      "assistant:text"
    ]);
    const toolMessage = history.messages[1];
    expect(toolMessage.toolCall?.name).toBe("web_search");
    expect(toolMessage.toolCall?.input).toBe("OpenAI news today");
    expect(toolMessage.toolCall?.status).toBe("completed");
    expect(toolMessage.toolCall?.output).toContain('"query": "OpenAI news today"');
    expect(toolMessage.toolCall?.output).toContain('"title": "OpenAI official"');
    expect(toolMessage.toolCall?.output).toContain('"url": "https://apnews.com/example"');
    expect(history.messages[1]!.sequence).toBeLessThan(history.messages[2]!.sequence);
  });

  it("轻量 Codex 能解析代理 responses 在 response.output_item.done 里返回的联网搜索结果", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "affairs-lightweight-home-"));
    process.env.HOME = homeDir;
    await fs.mkdir(path.join(homeDir, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".codex", "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "proxy-key" }),
      "utf8"
    );
    await fs.writeFile(
      path.join(homeDir, ".codex", "config.toml"),
      [
        'model = "gpt-5.4"',
        'model_provider = "proxy"',
        "",
        "[model_providers.proxy]",
        'base_url = "https://api.glor-ai.top:1443"'
      ].join("\n"),
      "utf8"
    );

    global.fetch = vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            [
              "event: response.output_item.added",
              'data: {"type":"response.output_item.added","item":{"id":"ws_1","type":"web_search_call","status":"in_progress"},"output_index":0,"sequence_number":2}',
              "",
              "event: response.web_search_call.searching",
              'data: {"type":"response.web_search_call.searching","item_id":"ws_1","output_index":0,"sequence_number":3}',
              "",
              "event: response.output_item.done",
              'data: {"type":"response.output_item.done","item":{"id":"ws_1","type":"web_search_call","status":"completed","action":{"type":"search","query":"OpenAI news today official blog latest 2025","sources":[{"type":"url","url":"https://openai.com/index/example-1"},{"type":"url","url":"https://openai.com/index/example-2"}]}}}',
              "",
              "event: response.output_text.delta",
              'data: {"type":"response.output_text.delta","delta":"hello"}',
              "",
              "data: [DONE]",
              ""
            ].join("\n")
          ));
          controller.close();
        }
      }),
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream"
        }
      }
    )) as typeof fetch;

    const hostDataRootDir = await fs.mkdtemp(path.join(os.tmpdir(), "affairs-lightweight-data-"));
    const service = new AffairsLightweightSessionService(hostDataRootDir);
    let sessionId: string | null = null;
    await service.startSessionStream({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "codex",
      content: "对话测试"
    }, (event) => {
      if (event.type === "started") {
        sessionId = event.session.sessionId;
      }
    });

    const history = await service.readMessages("workspace-1", sessionId!, "user-1");
    const toolMessage = history.messages.find((message) => message.role === "tool");
    expect(toolMessage?.toolCall?.input).toBe("OpenAI news today official blog latest 2025");
    expect(toolMessage?.toolCall?.output).toContain('"url": "https://openai.com/index/example-1"');
    expect(toolMessage?.toolCall?.output).toContain('"query": "OpenAI news today official blog latest 2025"');
  });

  it("轻量 Codex 流式发送时会持续产出 delta 并在结束后写回完整结果", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "affairs-lightweight-home-"));
    process.env.HOME = homeDir;
    await fs.mkdir(path.join(homeDir, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".codex", "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "proxy-key" }),
      "utf8"
    );
    await fs.writeFile(
      path.join(homeDir, ".codex", "config.toml"),
      [
        'model = "gpt-5.4"',
        'model_provider = "proxy"',
        "",
        "[model_providers.proxy]",
        'base_url = "https://api.glor-ai.top:1443"'
      ].join("\n"),
      "utf8"
    );

    global.fetch = vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            [
              "event: response.web_search_call.searching",
              "data: {\"type\":\"response.web_search_call.searching\",\"item_id\":\"search-1\"}",
              "",
              "event: response.web_search_call.completed",
              "data: {\"type\":\"response.web_search_call.completed\",\"item_id\":\"search-1\",\"action\":{\"sources\":[{\"title\":\"A\"},{\"title\":\"B\"}]}}",
              "",
              "event: response.output_text.delta",
              "data: {\"type\":\"response.output_text.delta\",\"delta\":\"he\"}",
              "",
              "event: response.output_text.delta",
              "data: {\"type\":\"response.output_text.delta\",\"delta\":\"llo\"}",
              "",
              "data: [DONE]",
              ""
            ].join("\n")
          ));
          controller.close();
        }
      }),
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream"
        }
      }
    )) as typeof fetch;

    const hostDataRootDir = await fs.mkdtemp(path.join(os.tmpdir(), "affairs-lightweight-data-"));
    const service = new AffairsLightweightSessionService(hostDataRootDir);
    const events: string[] = [];
    await service.startSessionStream({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "codex",
      content: "对话测试"
    }, (event) => {
      if (event.type === "delta") {
        events.push(event.delta);
        return;
      }
      if (event.type === "tool") {
        events.push(`${event.toolName}:${event.status}:${event.detail}`);
        return;
      }
      events.push(event.type);
    });

    expect(events).toEqual([
      "started",
      "web_search:running:正在联网搜索",
      "web_search:completed:联网搜索完成，找到 2 个来源",
      "he",
      "llo",
      "completed"
    ]);
  });

  it("事务轻量会话可以单独标记已读、收藏、归档、重命名和删除", async () => {
    const hostDataRootDir = await fs.mkdtemp(path.join(os.tmpdir(), "affairs-lightweight-data-"));
    const service = new AffairsLightweightSessionService(hostDataRootDir);
    const workspaceId = "workspace-1";
    const userId = "user-1";
    const sessionId = "light-ops-1";
    const sessionFilePath = path.join(hostDataRootDir, "affairs-lightweight-sessions", workspaceId, `${sessionId}.json`);
    await fs.mkdir(path.dirname(sessionFilePath), { recursive: true });
    await fs.writeFile(sessionFilePath, JSON.stringify({
      version: 1,
      userId,
      session: {
        sessionId,
        workspaceId,
        provider: "codex",
        providerSessionId: `affairs-lightweight:codex:${sessionId}`,
        rawStoreRef: sessionFilePath,
        providerConfigMode: "global-default",
        providerPresetId: null,
        parentSessionId: null,
        isSubagent: false,
        subagentLabel: null,
        isArchived: false,
        isFavorite: false,
        title: "原始标题",
        messageCount: 2,
        lastMessageAt: "2026-06-03T12:00:00.000Z",
        createdAt: "2026-06-03T11:00:00.000Z",
        updatedAt: "2026-06-03T12:00:00.000Z",
        syncStatus: "idle",
        syncCursor: null,
        lastSyncAt: "2026-06-03T12:00:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "completed",
        activitySource: "runtime",
        lastEventAt: "2026-06-03T12:00:00.000Z",
        completedAt: "2026-06-03T12:00:00.000Z",
        lastSeenAt: null,
        activityState: "completed_unread"
      },
      messages: []
    }), "utf8");

    await service.markSessionSeen(workspaceId, sessionId, userId, "2026-06-03T12:05:00.000Z");
    const favorited = await service.updateSessionFavoriteState(workspaceId, sessionId, userId, true);
    const archived = await service.updateSessionArchiveState(workspaceId, sessionId, userId, true);
    const renamed = await service.renameSessionTitle(workspaceId, sessionId, userId, "新标题");
    const finalSession = await service.getSession(workspaceId, sessionId, userId);

    expect(favorited.isFavorite).toBe(true);
    expect(archived.isArchived).toBe(true);
    expect(renamed.title).toBe("新标题");
    expect(finalSession.lastSeenAt).toBe("2026-06-03T12:05:00.000Z");
    expect(finalSession.activityState).toBe("idle");

    await service.deleteSession(workspaceId, sessionId, userId);
    await expect(service.getSession(workspaceId, sessionId, userId)).rejects.toMatchObject({
      errorCode: "AFFAIRS_LIGHTWEIGHT_SESSION_NOT_FOUND"
    });
  });

  it("会话文件短暂损坏时，会优先回退到最近一次内存快照，不再直接 500", async () => {
    const hostDataRootDir = await fs.mkdtemp(path.join(os.tmpdir(), "affairs-lightweight-data-"));
    const service = new AffairsLightweightSessionService(hostDataRootDir);
    const workspaceId = "workspace-1";
    const userId = "user-1";
    const sessionId = "light-cache-1";
    const sessionFilePath = path.join(hostDataRootDir, "affairs-lightweight-sessions", workspaceId, `${sessionId}.json`);
    await fs.mkdir(path.dirname(sessionFilePath), { recursive: true });
    await fs.writeFile(sessionFilePath, JSON.stringify({
      version: 1,
      userId,
      session: {
        sessionId,
        workspaceId,
        provider: "codex",
        providerSessionId: `affairs-lightweight:codex:${sessionId}`,
        rawStoreRef: sessionFilePath,
        providerConfigMode: "global-default",
        providerPresetId: null,
        parentSessionId: null,
        isSubagent: false,
        subagentLabel: null,
        isArchived: false,
        isFavorite: false,
        title: "缓存回退测试",
        messageCount: 1,
        lastMessageAt: "2026-06-03T12:00:00.000Z",
        createdAt: "2026-06-03T11:00:00.000Z",
        updatedAt: "2026-06-03T12:00:00.000Z",
        syncStatus: "idle",
        syncCursor: null,
        lastSyncAt: "2026-06-03T12:00:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "completed",
        activitySource: "runtime",
        lastEventAt: "2026-06-03T12:00:00.000Z",
        completedAt: "2026-06-03T12:00:00.000Z",
        lastSeenAt: null,
        activityState: "idle"
      },
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          kind: "text",
          content: "ok",
          sequence: 1,
          createdAt: "2026-06-03T12:00:00.000Z",
          updatedAt: "2026-06-03T12:00:00.000Z",
          provider: "codex",
          providerSessionId: `affairs-lightweight:codex:${sessionId}`,
          metadata: {},
          rawRef: `${sessionFilePath}#assistant-1`
        }
      ]
    }), "utf8");

    const firstRead = await service.readMessages(workspaceId, sessionId, userId);
    expect(firstRead.total).toBe(1);

    await fs.writeFile(sessionFilePath, "{", "utf8");

    const fallbackRead = await service.readMessages(workspaceId, sessionId, userId);
    expect(fallbackRead.total).toBe(1);
    expect(fallbackRead.messages[0]?.content).toBe("ok");
  });

  it("写会话文件时会走临时文件 + rename，不留下半截 JSON", async () => {
    const hostDataRootDir = await fs.mkdtemp(path.join(os.tmpdir(), "affairs-lightweight-data-"));
    const service = new AffairsLightweightSessionService(hostDataRootDir);
    const workspaceId = "workspace-1";
    const userId = "user-1";
    const sessionId = "light-atomic-1";
    const sessionFilePath = path.join(hostDataRootDir, "affairs-lightweight-sessions", workspaceId, `${sessionId}.json`);
    await fs.mkdir(path.dirname(sessionFilePath), { recursive: true });
    await fs.writeFile(sessionFilePath, JSON.stringify({
      version: 1,
      userId,
      session: {
        sessionId,
        workspaceId,
        provider: "codex",
        providerSessionId: `affairs-lightweight:codex:${sessionId}`,
        rawStoreRef: sessionFilePath,
        providerConfigMode: "global-default",
        providerPresetId: null,
        parentSessionId: null,
        isSubagent: false,
        subagentLabel: null,
        isArchived: false,
        isFavorite: false,
        title: "原始标题",
        messageCount: 0,
        lastMessageAt: null,
        createdAt: "2026-06-03T11:00:00.000Z",
        updatedAt: "2026-06-03T11:00:00.000Z",
        syncStatus: "idle",
        syncCursor: null,
        lastSyncAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        resumedAt: null,
        runningState: "completed",
        activitySource: "runtime",
        lastEventAt: "2026-06-03T11:00:00.000Z",
        completedAt: "2026-06-03T11:00:00.000Z",
        lastSeenAt: null,
        activityState: "idle"
      },
      messages: []
    }), "utf8");

    await service.renameSessionTitle(workspaceId, sessionId, userId, "新标题");

    const content = await fs.readFile(sessionFilePath, "utf8");
    expect(() => JSON.parse(content)).not.toThrow();
    const workspaceDirEntries = await fs.readdir(path.dirname(sessionFilePath));
    expect(workspaceDirEntries.filter((name) => name.includes(".tmp"))).toEqual([]);
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
