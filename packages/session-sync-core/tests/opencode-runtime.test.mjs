import test from "node:test";
import assert from "node:assert/strict";

import { OpenCodeRuntimeAdapter } from "../dist/index.js";

test("OpenCodeRuntimeAdapter 会创建会话、发送消息并消费 SSE 事件", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";
    requests.push({
      url,
      method,
      body: typeof init.body === "string" ? init.body : null
    });

    if (url.startsWith("http://127.0.0.1:41827/session?") && method === "POST") {
      return jsonResponse({ id: "ses_test_runtime" });
    }

    if (url === "http://127.0.0.1:41827/session/ses_test_runtime" && method === "GET") {
      return jsonResponse({
        id: "ses_test_runtime",
        directory: "/Users/jackson/Code/CodingNS"
      });
    }

    if (url === "http://127.0.0.1:41827/event" && method === "GET") {
      return sseResponse([
        {
          payload: {
            type: "session.status",
            properties: {
              sessionID: "ses_test_runtime",
              status: {
                type: "busy"
              }
            }
          }
        },
        {
          payload: {
            type: "message.part.updated",
            properties: {
              part: {
                id: "prt_runtime_1",
                messageID: "msg_runtime_1",
                sessionID: "ses_test_runtime",
                type: "text",
                text: "OpenCode 已响应",
                time: {
                  end: 1
                }
              }
            }
          }
        },
        {
          payload: {
            type: "message.updated",
            properties: {
              info: {
                id: "msg_runtime_1",
                sessionID: "ses_test_runtime",
                role: "assistant",
                time: {
                  created: 1
                }
              }
            }
          }
        },
        {
          payload: {
            type: "session.idle",
            properties: {
              sessionID: "ses_test_runtime"
            }
          }
        }
      ]);
    }

    if (url === "http://127.0.0.1:41827/session/ses_test_runtime/message" && method === "POST") {
      return jsonResponse({});
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const bindings = [];
  const events = [];
  const sink = {
    updateSessionBinding(binding) {
      bindings.push(binding);
    },
    async emit(event) {
      events.push(event);
    }
  };

  const adapter = new OpenCodeRuntimeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    requestTimeoutMs: 1_000
  });
  const launch = await adapter.startSession(
    {
      sessionId: "local-session-1",
      workspaceId: "workspace-1",
      workspacePath: "/Users/jackson/Code/CodingNS",
      provider: "opencode",
      providerSessionId: null,
      rawStoreRef: null,
      options: {
        content: "请回一句测试成功",
        clientRequestId: null,
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        providerPrompt: null,
        attachments: []
      }
    },
    sink
  );

  await launch.completed;

  assert.equal(launch.providerSessionId, "ses_test_runtime");
  assert.equal(launch.rawStoreRef, "opencode://session/ses_test_runtime");
  assert.deepEqual(bindings, [
    {
      providerSessionId: "ses_test_runtime",
      rawStoreRef: "opencode://session/ses_test_runtime"
    }
  ]);

  const sessionCreateRequest = requests.find(
    (request) => request.method === "POST" && request.url.startsWith("http://127.0.0.1:41827/session?")
  );
  assert.ok(sessionCreateRequest);
  assert.equal(JSON.parse(sessionCreateRequest.body).directory, "/Users/jackson/Code/CodingNS");

  const messageRequest = requests.find(
    (request) => request.method === "POST" && request.url.endsWith("/session/ses_test_runtime/message")
  );
  assert.ok(messageRequest);
  assert.equal(JSON.parse(messageRequest.body).parts[0].text, "请回一句测试成功");

  const runningEvent = events.find((event) => event.type === "status");
  assert.ok(runningEvent);
  assert.equal(runningEvent.status, "running");

  const messageEvent = events.find((event) => event.type === "message");
  assert.ok(messageEvent);
  assert.equal(messageEvent.message.kind, "text");
  assert.equal(messageEvent.message.content, "OpenCode 已响应");
  assert.equal(messageEvent.message.providerSessionId, "ses_test_runtime");

  const completeEvent = events.find((event) => event.type === "complete");
  assert.ok(completeEvent);
  assert.equal(completeEvent.status, "completed");
});

test("OpenCodeRuntimeAdapter 运行期间会持有托管 server 租约，并在完成后释放", async (context) => {
  const originalFetch = globalThis.fetch;
  const acquired = [];
  const released = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";

    if (url.startsWith("http://127.0.0.1:41827/session?") && method === "POST") {
      return jsonResponse({ id: "ses_runtime_lease" });
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_lease" && method === "GET") {
      return jsonResponse({
        id: "ses_runtime_lease",
        directory: "/Users/jackson/Code/CodingNS"
      });
    }

    if (url === "http://127.0.0.1:41827/event" && method === "GET") {
      return sseResponse([
        {
          payload: {
            type: "session.idle",
            properties: {
              sessionID: "ses_runtime_lease"
            }
          }
        }
      ]);
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_lease/message" && method === "POST") {
      return jsonResponse({});
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeRuntimeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    requestTimeoutMs: 1_000,
    acquireManagedServerLease(workspacePath) {
      acquired.push(workspacePath);
      return "lease-1";
    },
    releaseManagedServerLease(workspacePath, leaseId) {
      released.push({ workspacePath, leaseId });
    }
  });
  const launch = await adapter.startSession(
    {
      sessionId: "local-session-lease",
      workspaceId: "workspace-1",
      workspacePath: "/Users/jackson/Code/CodingNS",
      provider: "opencode",
      providerSessionId: null,
      rawStoreRef: null,
      options: {
        content: "测试租约释放",
        clientRequestId: null,
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        providerPrompt: null,
        attachments: []
      }
    },
    {
      updateSessionBinding() {},
      async emit() {}
    }
  );

  assert.deepEqual(acquired, ["/Users/jackson/Code/CodingNS"]);
  assert.deepEqual(released, []);

  await launch.completed;

  assert.deepEqual(released, [
    {
      workspacePath: "/Users/jackson/Code/CodingNS",
      leaseId: "lease-1"
    }
  ]);
});

test("OpenCodeRuntimeAdapter 在发送请求先报错、SSE 稍后继续时，不会提前把会话改成 failed", async (context) => {
  const originalFetch = globalThis.fetch;
  const events = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";

    if (url.startsWith("http://127.0.0.1:41827/session?") && method === "POST") {
      return jsonResponse({ id: "ses_test_runtime_race" });
    }

    if (url === "http://127.0.0.1:41827/session/ses_test_runtime_race" && method === "GET") {
      return jsonResponse({
        id: "ses_test_runtime_race",
        directory: "/Users/jackson/Code/CodingNS"
      });
    }

    if (url === "http://127.0.0.1:41827/event" && method === "GET") {
      return sseResponse([
        {
          delayMs: 40,
          frame: {
            payload: {
              type: "message.part.updated",
              properties: {
                part: {
                  id: "prt_runtime_race_1",
                  messageID: "msg_runtime_race_1",
                  sessionID: "ses_test_runtime_race",
                  type: "text",
                  text: "OpenCode 继续输出",
                  time: {
                    end: 1
                  }
                }
              }
            }
          }
        },
        {
          delayMs: 80,
          frame: {
            payload: {
              type: "message.updated",
              properties: {
                info: {
                  id: "msg_runtime_race_1",
                  sessionID: "ses_test_runtime_race",
                  role: "assistant",
                  time: {
                    created: 1
                  }
                }
              }
            }
          }
        },
        {
          delayMs: 120,
          frame: {
            payload: {
              type: "session.idle",
              properties: {
                sessionID: "ses_test_runtime_race"
              }
            }
          }
        }
      ]);
    }

    if (url === "http://127.0.0.1:41827/session/ses_test_runtime_race/message" && method === "POST") {
      return new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error("SERVER_TIMEOUT"));
        }, 20);
      });
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeRuntimeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    requestTimeoutMs: 1_000
  });
  const launch = await adapter.startSession(
    {
      sessionId: "local-session-race",
      workspaceId: "workspace-1",
      workspacePath: "/Users/jackson/Code/CodingNS",
      provider: "opencode",
      providerSessionId: null,
      rawStoreRef: null,
      options: {
        content: "请输出后结束",
        clientRequestId: null,
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        providerPrompt: null,
        attachments: []
      }
    },
    {
      updateSessionBinding() {},
      async emit(event) {
        events.push(event);
      }
    }
  );

  await launch.completed;

  assert.equal(events.some((event) => event.type === "error"), false);
  const messageEvent = events.find((event) => event.type === "message");
  assert.ok(messageEvent);
  assert.equal(messageEvent.message.content, "OpenCode 继续输出");
  const completeEvent = events.find((event) => event.type === "complete");
  assert.ok(completeEvent);
  assert.equal(completeEvent.status, "completed");
});

test("OpenCodeRuntimeAdapter 提交超时后如果确认消息已入库，不会错误重发第二次", async (context) => {
  const originalFetch = globalThis.fetch;
  const events = [];
  let submitAttempts = 0;

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";

    if (url.startsWith("http://127.0.0.1:41827/session?") && method === "POST") {
      return jsonResponse({ id: "ses_runtime_timeout_confirmed" });
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_timeout_confirmed" && method === "GET") {
      return jsonResponse({
        id: "ses_runtime_timeout_confirmed",
        directory: "/Users/jackson/Code/CodingNS"
      });
    }

    if (url === "http://127.0.0.1:41827/event" && method === "GET") {
      return sseResponse([
        {
          delayMs: 1_600,
          frame: {
            payload: {
              type: "session.idle",
              properties: {
                sessionID: "ses_runtime_timeout_confirmed"
              }
            }
          }
        }
      ]);
    }

    if (
      url === "http://127.0.0.1:41827/session/ses_runtime_timeout_confirmed/message"
      && method === "POST"
    ) {
      submitAttempts += 1;
      return await new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        }, { once: true });
      });
    }

    if (
      url === "http://127.0.0.1:41827/session/ses_runtime_timeout_confirmed/message?limit=20"
      && method === "GET"
    ) {
      const createdAt = Date.now();
      return jsonResponse([
        {
          info: {
            id: "msg_runtime_timeout_confirmed",
            sessionID: "ses_runtime_timeout_confirmed",
            role: "user",
            time: {
              created: createdAt
            }
          },
          parts: [
            {
              id: "prt_runtime_timeout_confirmed",
              messageID: "msg_runtime_timeout_confirmed",
              sessionID: "ses_runtime_timeout_confirmed",
              type: "text",
              text: "超时后确认不要重发"
            }
          ]
        }
      ]);
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeRuntimeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    requestTimeoutMs: 5
  });
  const launch = await adapter.startSession(
    {
      sessionId: "local-session-timeout-confirmed",
      workspaceId: "workspace-1",
      workspacePath: "/Users/jackson/Code/CodingNS",
      provider: "opencode",
      providerSessionId: null,
      rawStoreRef: null,
      options: {
        content: "超时后确认不要重发",
        clientRequestId: null,
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        providerPrompt: null,
        attachments: []
      }
    },
    {
      updateSessionBinding() {},
      async emit(event) {
        events.push(event);
      }
    }
  );

  await launch.completed;

  assert.equal(submitAttempts, 1);
  assert.equal(events.some((event) => event.type === "error"), false);
});

test("OpenCodeRuntimeAdapter 会在服务端目录跑偏时直接拒绝启动会话", async (context) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";

    if (url.startsWith("http://127.0.0.1:41827/session?") && method === "POST") {
      return jsonResponse({ id: "ses_wrong_workspace" });
    }

    if (url === "http://127.0.0.1:41827/session/ses_wrong_workspace" && method === "GET") {
      return jsonResponse({
        id: "ses_wrong_workspace",
        directory: "/Users/jackson/Code/AnotherWorkspace"
      });
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeRuntimeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    requestTimeoutMs: 1_000
  });

  await assert.rejects(
    adapter.startSession(
      {
        sessionId: "local-session-wrong-workspace",
        workspaceId: "workspace-1",
        workspacePath: "/Users/jackson/Code/CodingNS",
        provider: "opencode",
        providerSessionId: null,
        rawStoreRef: null,
        options: {
          content: "测试目录校验",
          clientRequestId: null,
          model: null,
          reasoningLevel: null,
          permissionMode: null,
          providerPrompt: null,
          attachments: []
        }
      },
      {
        updateSessionBinding() {
          throw new Error("不应该先写入错误绑定");
        },
        async emit() {}
      }
    ),
    /OPENCODE_SESSION_DIRECTORY_MISMATCH/
  );
});

test("OpenCodeRuntimeAdapter 会把同一个 part 的 delta 更新映射为同一逻辑消息", async (context) => {
  const originalFetch = globalThis.fetch;
  const events = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";

    if (url.startsWith("http://127.0.0.1:41827/session?") && method === "POST") {
      return jsonResponse({ id: "ses_runtime_delta" });
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_delta" && method === "GET") {
      return jsonResponse({
        id: "ses_runtime_delta",
        directory: "/Users/jackson/Code/CodingNS"
      });
    }

    if (url === "http://127.0.0.1:41827/event" && method === "GET") {
      return sseResponse([
        {
          payload: {
            type: "message.updated",
            properties: {
              info: {
                id: "msg_runtime_delta",
                sessionID: "ses_runtime_delta",
                role: "assistant",
                time: {
                  created: 1
                }
              }
            }
          }
        },
        {
          payload: {
            type: "message.part.updated",
            properties: {
              part: {
                id: "prt_runtime_delta",
                messageID: "msg_runtime_delta",
                sessionID: "ses_runtime_delta",
                type: "text",
                text: "Open",
                time: {
                  start: 1
                }
              }
            }
          }
        },
        {
          payload: {
            type: "message.part.delta",
            properties: {
              partID: "prt_runtime_delta",
              messageID: "msg_runtime_delta",
              sessionID: "ses_runtime_delta",
              field: "text",
              delta: "Code"
            }
          }
        },
        {
          payload: {
            type: "session.idle",
            properties: {
              sessionID: "ses_runtime_delta"
            }
          }
        }
      ]);
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_delta/message" && method === "POST") {
      return jsonResponse({});
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeRuntimeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    requestTimeoutMs: 1_000
  });

  const launch = await adapter.startSession(
    {
      sessionId: "local-session-delta",
      workspaceId: "workspace-1",
      workspacePath: "/Users/jackson/Code/CodingNS",
      provider: "opencode",
      providerSessionId: null,
      rawStoreRef: null,
      options: {
        content: "测试 delta 更新",
        clientRequestId: null,
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        providerPrompt: null,
        attachments: []
      }
    },
    {
      updateSessionBinding() {},
      async emit(event) {
        events.push(event);
      }
    }
  );

  await launch.completed;

  const messageEvents = events.filter((event) => event.type === "message");
  assert.equal(messageEvents.length, 2);
  assert.deepEqual(
    messageEvents.map((event) => event.message.content),
    ["Open", "OpenCode"]
  );
  assert.equal(messageEvents[0].message.messageId, messageEvents[1].message.messageId);
  assert.equal(messageEvents[0].message.rawRef, messageEvents[1].message.rawRef);
  assert.equal(messageEvents[0].message.sequence, messageEvents[1].message.sequence);
});

test("OpenCodeRuntimeAdapter 会接续 sequenceBase，并把同一条 assistant message 的多个 part 固定在同一顺序锚点", async (context) => {
  const originalFetch = globalThis.fetch;
  const events = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";

    if (url.startsWith("http://127.0.0.1:41827/session?") && method === "POST") {
      return jsonResponse({ id: "ses_runtime_grouped_sequence" });
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_grouped_sequence" && method === "GET") {
      return jsonResponse({
        id: "ses_runtime_grouped_sequence",
        directory: "/Users/jackson/Code/CodingNS"
      });
    }

    if (url === "http://127.0.0.1:41827/event" && method === "GET") {
      return sseResponse([
        {
          payload: {
            type: "message.part.updated",
            properties: {
              part: {
                id: "prt_runtime_reasoning",
                messageID: "msg_runtime_grouped",
                sessionID: "ses_runtime_grouped_sequence",
                type: "reasoning",
                text: "先想一下",
                time: {
                  start: 1_000
                }
              }
            }
          }
        },
        {
          payload: {
            type: "message.part.updated",
            properties: {
              part: {
                id: "prt_runtime_text",
                messageID: "msg_runtime_grouped",
                sessionID: "ses_runtime_grouped_sequence",
                type: "text",
                text: "回复 123",
                time: {
                  end: 5_000
                }
              }
            }
          }
        },
        {
          payload: {
            type: "message.updated",
            properties: {
              info: {
                id: "msg_runtime_grouped",
                sessionID: "ses_runtime_grouped_sequence",
                role: "assistant",
                time: {
                  created: 1_000
                }
              }
            }
          }
        },
        {
          payload: {
            type: "session.idle",
            properties: {
              sessionID: "ses_runtime_grouped_sequence"
            }
          }
        }
      ]);
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_grouped_sequence/message" && method === "POST") {
      return jsonResponse({});
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeRuntimeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    requestTimeoutMs: 1_000
  });

  const launch = await adapter.startSession(
    {
      sessionId: "local-session-grouped-sequence",
      workspaceId: "workspace-1",
      workspacePath: "/Users/jackson/Code/CodingNS",
      provider: "opencode",
      providerSessionId: null,
      rawStoreRef: null,
      sequenceBase: 5,
      options: {
        content: "测试 grouped sequence",
        clientRequestId: null,
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        providerPrompt: null,
        attachments: []
      }
    },
    {
      updateSessionBinding() {},
      async emit(event) {
        events.push(event);
      }
    }
  );

  await launch.completed;

  const messageEvents = events.filter((event) => event.type === "message");
  assert.equal(messageEvents.length, 2);
  assert.deepEqual(
    messageEvents.map((event) => [event.message.kind, event.message.content]),
    [
      ["thinking", "先想一下"],
      ["text", "回复 123"]
    ]
  );
  assert.deepEqual(
    messageEvents.map((event) => event.message.sequence),
    [6, 6]
  );
  assert.equal(
    messageEvents[0].message.rawRef,
    "opencode://session/ses_runtime_grouped_sequence/message/msg_runtime_grouped/part/prt_runtime_reasoning?part=1001"
  );
  assert.equal(
    messageEvents[1].message.rawRef,
    "opencode://session/ses_runtime_grouped_sequence/message/msg_runtime_grouped/part/prt_runtime_text?part=2001"
  );
  assert.equal(messageEvents[0].message.timestamp, "1970-01-01T00:00:01.000Z");
  assert.equal(messageEvents[1].message.timestamp, "1970-01-01T00:00:01.000Z");
});

test("OpenCodeRuntimeAdapter 会在 message.updated 晚到时重新发出修正后的时间线锚点", async (context) => {
  const originalFetch = globalThis.fetch;
  const events = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";

    if (url.startsWith("http://127.0.0.1:41827/session?") && method === "POST") {
      return jsonResponse({ id: "ses_runtime_late_anchor" });
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_late_anchor" && method === "GET") {
      return jsonResponse({
        id: "ses_runtime_late_anchor",
        directory: "/Users/jackson/Code/CodingNS"
      });
    }

    if (url === "http://127.0.0.1:41827/event" && method === "GET") {
      return sseResponse([
        {
          payload: {
            type: "message.part.updated",
            properties: {
              part: {
                id: "prt_runtime_late_anchor",
                messageID: "msg_runtime_late_anchor",
                sessionID: "ses_runtime_late_anchor",
                type: "text",
                text: "回复 456",
                time: {
                  end: 5_000
                }
              }
            }
          }
        },
        {
          payload: {
            type: "message.updated",
            properties: {
              info: {
                id: "msg_runtime_late_anchor",
                sessionID: "ses_runtime_late_anchor",
                role: "assistant",
                time: {
                  created: 1_000
                }
              }
            }
          }
        },
        {
          payload: {
            type: "session.idle",
            properties: {
              sessionID: "ses_runtime_late_anchor"
            }
          }
        }
      ]);
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_late_anchor/message" && method === "POST") {
      return jsonResponse({});
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeRuntimeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    requestTimeoutMs: 1_000
  });

  const launch = await adapter.startSession(
    {
      sessionId: "local-session-late-anchor",
      workspaceId: "workspace-1",
      workspacePath: "/Users/jackson/Code/CodingNS",
      provider: "opencode",
      providerSessionId: null,
      rawStoreRef: null,
      sequenceBase: 9,
      options: {
        content: "测试 late anchor",
        clientRequestId: null,
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        providerPrompt: null,
        attachments: []
      }
    },
    {
      updateSessionBinding() {},
      async emit(event) {
        events.push(event);
      }
    }
  );

  await launch.completed;

  const messageEvents = events.filter((event) => event.type === "message");
  assert.equal(messageEvents.length, 2);
  assert.deepEqual(
    messageEvents.map((event) => event.message.sequence),
    [10, 10]
  );
  assert.equal(messageEvents[0].message.timestamp, "1970-01-01T00:00:05.000Z");
  assert.equal(messageEvents[1].message.timestamp, "1970-01-01T00:00:01.000Z");
  assert.equal(messageEvents[0].message.rawRef, messageEvents[1].message.rawRef);
});

test("OpenCodeRuntimeAdapter 会忽略 event 流里回放的旧轮次消息，避免把历史回复重新追加到当前轮次", async (context) => {
  const originalFetch = globalThis.fetch;
  const events = [];
  const now = Date.now();

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";

    if (url.startsWith("http://127.0.0.1:41827/session?") && method === "POST") {
      return jsonResponse({ id: "ses_runtime_replay_guard" });
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_replay_guard" && method === "GET") {
      return jsonResponse({
        id: "ses_runtime_replay_guard",
        directory: "/Users/jackson/Code/CodingNS"
      });
    }

    if (url === "http://127.0.0.1:41827/event" && method === "GET") {
      return sseResponse([
        {
          payload: {
            type: "message.part.updated",
            properties: {
              part: {
                id: "prt_runtime_old_text",
                messageID: "msg_runtime_old",
                sessionID: "ses_runtime_replay_guard",
                type: "text",
                text: "旧回复 345",
                time: {
                  start: now - 60_000,
                  end: now - 59_000
                }
              }
            }
          }
        },
        {
          payload: {
            type: "message.updated",
            properties: {
              info: {
                id: "msg_runtime_old",
                sessionID: "ses_runtime_replay_guard",
                role: "assistant",
                time: {
                  created: now - 60_000
                }
              }
            }
          }
        },
        {
          payload: {
            type: "session.idle",
            properties: {
              sessionID: "ses_runtime_replay_guard"
            }
          }
        },
        {
          payload: {
            type: "session.status",
            properties: {
              sessionID: "ses_runtime_replay_guard",
              status: {
                type: "busy"
              }
            }
          }
        },
        {
          payload: {
            type: "message.part.updated",
            properties: {
              part: {
                id: "prt_runtime_new_text",
                messageID: "msg_runtime_new",
                sessionID: "ses_runtime_replay_guard",
                type: "text",
                text: "新回复 567",
                time: {
                  start: now + 10,
                  end: now + 200
                }
              }
            }
          }
        },
        {
          payload: {
            type: "message.updated",
            properties: {
              info: {
                id: "msg_runtime_new",
                sessionID: "ses_runtime_replay_guard",
                role: "assistant",
                time: {
                  created: now + 10
                }
              }
            }
          }
        },
        {
          payload: {
            type: "session.idle",
            properties: {
              sessionID: "ses_runtime_replay_guard"
            }
          }
        }
      ]);
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_replay_guard/message" && method === "POST") {
      return jsonResponse({});
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeRuntimeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    requestTimeoutMs: 1_000
  });

  const launch = await adapter.startSession(
    {
      sessionId: "local-session-replay-guard",
      workspaceId: "workspace-1",
      workspacePath: "/Users/jackson/Code/CodingNS",
      provider: "opencode",
      providerSessionId: null,
      rawStoreRef: null,
      sequenceBase: 11,
      options: {
        content: "测试 replay guard",
        clientRequestId: null,
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        providerPrompt: null,
        attachments: []
      }
    },
    {
      updateSessionBinding() {},
      async emit(event) {
        events.push(event);
      }
    }
  );

  await launch.completed;

  const messageEvents = events.filter((event) => event.type === "message");
  assert.equal(messageEvents.length, 1);
  assert.equal(messageEvents[0].message.content, "新回复 567");
  assert.equal(messageEvents[0].message.sequence, 12);
  assert.equal(events.filter((event) => event.type === "complete").length, 1);
});

test("OpenCodeRuntimeAdapter 在 message.updated 延迟到达时也会先流式推送 text part", async (context) => {
  const originalFetch = globalThis.fetch;
  const events = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";

    if (url.startsWith("http://127.0.0.1:41827/session?") && method === "POST") {
      return jsonResponse({ id: "ses_runtime_late_info" });
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_late_info" && method === "GET") {
      return jsonResponse({
        id: "ses_runtime_late_info",
        directory: "/Users/jackson/Code/CodingNS"
      });
    }

    if (url === "http://127.0.0.1:41827/event" && method === "GET") {
      return sseResponse([
        {
          payload: {
            type: "message.part.updated",
            properties: {
              part: {
                id: "prt_runtime_late_info",
                messageID: "msg_runtime_late_info",
                sessionID: "ses_runtime_late_info",
                type: "text",
                text: "Open",
                time: {
                  start: 1
                }
              }
            }
          }
        },
        {
          payload: {
            type: "message.part.delta",
            properties: {
              partID: "prt_runtime_late_info",
              messageID: "msg_runtime_late_info",
              sessionID: "ses_runtime_late_info",
              field: "text",
              delta: "Code"
            }
          }
        },
        {
          payload: {
            type: "message.updated",
            properties: {
              info: {
                id: "msg_runtime_late_info",
                sessionID: "ses_runtime_late_info",
                role: "assistant",
                time: {
                  created: 1
                }
              }
            }
          }
        },
        {
          payload: {
            type: "session.idle",
            properties: {
              sessionID: "ses_runtime_late_info"
            }
          }
        }
      ]);
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_late_info/message" && method === "POST") {
      return jsonResponse({});
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeRuntimeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    requestTimeoutMs: 1_000
  });

  const launch = await adapter.startSession(
    {
      sessionId: "local-session-late-info",
      workspaceId: "workspace-1",
      workspacePath: "/Users/jackson/Code/CodingNS",
      provider: "opencode",
      providerSessionId: null,
      rawStoreRef: null,
      options: {
        content: "测试 message.updated 延迟",
        clientRequestId: null,
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        providerPrompt: null,
        attachments: []
      }
    },
    {
      updateSessionBinding() {},
      async emit(event) {
        events.push(event);
      }
    }
  );

  await launch.completed;

  const messageEvents = events.filter((event) => event.type === "message");
  assert.equal(messageEvents.length, 2);
  assert.deepEqual(
    messageEvents.map((event) => [event.message.role, event.message.content]),
    [
      ["assistant", "Open"],
      ["assistant", "OpenCode"]
    ]
  );
  assert.equal(messageEvents[0].message.messageId, messageEvents[1].message.messageId);
});

test("OpenCodeRuntimeAdapter 在非 default permissionMode 下也只会沿用 OpenCode 当前配置", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";
    requests.push({
      url,
      method,
      body: typeof init.body === "string" ? init.body : null
    });

    if (url.startsWith("http://127.0.0.1:41827/session?") && method === "POST") {
      return jsonResponse({ id: "ses_runtime_permission" });
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_permission" && method === "GET") {
      return jsonResponse({
        id: "ses_runtime_permission",
        directory: "/Users/jackson/Code/CodingNS"
      });
    }

    if (url === "http://127.0.0.1:41827/event" && method === "GET") {
      return sseResponse([
        {
          payload: {
            type: "session.idle",
            properties: {
              sessionID: "ses_runtime_permission"
            }
          }
        }
      ]);
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_permission/message" && method === "POST") {
      return jsonResponse({});
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeRuntimeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    requestTimeoutMs: 1_000
  });

  const launch = await adapter.startSession(
    {
      sessionId: "local-session-permission",
      workspaceId: "workspace-1",
      workspacePath: "/Users/jackson/Code/CodingNS",
      provider: "opencode",
      providerSessionId: null,
      rawStoreRef: null,
      options: {
        content: "直接继续",
        clientRequestId: null,
        model: null,
        reasoningLevel: null,
        permissionMode: "bypassPermissions",
        providerPrompt: null,
        attachments: []
      }
    },
    {
      updateSessionBinding() {},
      async emit() {}
    }
  );

  await launch.completed;

  const messageRequest = requests.find(
    (request) => request.method === "POST" && request.url.endsWith("/session/ses_runtime_permission/message")
  );
  assert.ok(messageRequest);
  assert.deepEqual(JSON.parse(messageRequest.body), {
    parts: [
      {
        type: "text",
        text: "直接继续"
      }
    ]
  });
});

test("OpenCodeRuntimeAdapter 会把 patch part 收口成可读摘要，而不是原始 JSON", async (context) => {
  const originalFetch = globalThis.fetch;
  const events = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";

    if (url.startsWith("http://127.0.0.1:41827/session?") && method === "POST") {
      return jsonResponse({ id: "ses_runtime_patch" });
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_patch" && method === "GET") {
      return jsonResponse({
        id: "ses_runtime_patch",
        directory: "/Users/jackson/Code/CodingNS"
      });
    }

    if (url === "http://127.0.0.1:41827/event" && method === "GET") {
      return sseResponse([
        {
          payload: {
            type: "message.updated",
            properties: {
              info: {
                id: "msg_runtime_patch",
                sessionID: "ses_runtime_patch",
                role: "assistant",
                time: {
                  created: 1
                }
              }
            }
          }
        },
        {
          payload: {
            type: "message.part.updated",
            properties: {
              part: {
                id: "prt_runtime_patch",
                messageID: "msg_runtime_patch",
                sessionID: "ses_runtime_patch",
                type: "patch",
                hash: "604cbacfa354f74120047742bfa43e935249c817",
                files: [
                  "/Users/jackson/Code/CodingNS/apps/user-app/src/app/styles.css"
                ],
                time: {
                  end: 1
                }
              }
            }
          }
        },
        {
          payload: {
            type: "session.idle",
            properties: {
              sessionID: "ses_runtime_patch"
            }
          }
        }
      ]);
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_patch/message" && method === "POST") {
      return jsonResponse({});
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeRuntimeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    requestTimeoutMs: 1_000
  });

  const launch = await adapter.startSession(
    {
      sessionId: "local-session-patch",
      workspaceId: "workspace-1",
      workspacePath: "/Users/jackson/Code/CodingNS",
      provider: "opencode",
      providerSessionId: null,
      rawStoreRef: null,
      options: {
        content: "测试 patch 摘要",
        clientRequestId: null,
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        providerPrompt: null,
        attachments: []
      }
    },
    {
      updateSessionBinding() {},
      async emit(event) {
        events.push(event);
      }
    }
  );

  await launch.completed;

  const messageEvent = events.find((event) => event.type === "message");
  assert.ok(messageEvent);
  assert.equal(messageEvent.message.kind, "tool_call");
  assert.equal(messageEvent.message.toolCall?.name, "apply_patch");
  assert.ok(messageEvent.message.content.includes("*** Begin Patch"));
});

test("OpenCodeRuntimeAdapter 会把网络失败收口成 SERVER_UNAVAILABLE", async (context) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    throw new TypeError("fetch failed", {
      cause: {
        code: "ECONNREFUSED"
      }
    });
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeRuntimeAdapter({
    baseUrl: "http://127.0.0.1:4096",
    requestTimeoutMs: 1_000
  });

  await assert.rejects(
    () =>
      adapter.startSession(
        {
          sessionId: "local-session-2",
          workspaceId: "workspace-1",
          workspacePath: "/Users/jackson/Code/CodingNS",
          provider: "opencode",
          providerSessionId: null,
          rawStoreRef: null,
          options: {
            content: "测试网络失败",
            clientRequestId: null,
            model: null,
            reasoningLevel: null,
            permissionMode: null,
            providerPrompt: null,
            attachments: []
          }
        },
        {
          updateSessionBinding() {},
          async emit() {}
        }
      ),
    (error) => error instanceof Error && error.message === "SERVER_UNAVAILABLE"
  );
});

test("OpenCodeRuntimeAdapter 对 GET 请求只有连续超时达到阈值后才会收口成 SERVER_TIMEOUT", async (context) => {
  const originalFetch = globalThis.fetch;
  let getAttempts = 0;

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";

    if (url.startsWith("http://127.0.0.1:4096/session?") && method === "POST") {
      return jsonResponse({ id: "ses_timeout_retry_get" });
    }

    if (url === "http://127.0.0.1:4096/session/ses_timeout_retry_get" && method === "GET") {
      getAttempts += 1;
      return await new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }

    return await new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeRuntimeAdapter({
    baseUrl: "http://127.0.0.1:4096",
    requestTimeoutMs: 5
  });

  await assert.rejects(
    () =>
      adapter.startSession(
        {
          sessionId: "local-session-timeout",
          workspaceId: "workspace-1",
          workspacePath: "/Users/jackson/Code/CodingNS",
          provider: "opencode",
          providerSessionId: null,
          rawStoreRef: null,
          options: {
            content: "测试超时重试",
            clientRequestId: null,
            model: null,
            reasoningLevel: null,
            permissionMode: null,
            providerPrompt: null,
            attachments: []
          }
        },
        {
          updateSessionBinding() {},
          async emit() {}
        }
      ),
    (error) => error instanceof Error && error.message === "SERVER_TIMEOUT"
  );

  assert.equal(getAttempts, 5);
});

test("OpenCodeRuntimeAdapter 会在 resolver 刷新后切换到新的 server 地址", async (context) => {
  const originalFetch = globalThis.fetch;
  let currentBaseUrl = "http://127.0.0.1:4096";

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";

    if (url.startsWith("http://127.0.0.1:4096/")) {
      throw new TypeError("fetch failed", {
        cause: {
          code: "ECONNREFUSED"
        }
      });
    }

    if (url.startsWith("http://127.0.0.1:41827/session?") && method === "POST") {
      return jsonResponse({ id: "ses_refresh_runtime" });
    }

    if (url === "http://127.0.0.1:41827/session/ses_refresh_runtime" && method === "GET") {
      return jsonResponse({
        id: "ses_refresh_runtime",
        directory: "/Users/jackson/Code/CodingNS"
      });
    }

    if (url === "http://127.0.0.1:41827/event" && method === "GET") {
      return sseResponse([
        {
          payload: {
            type: "session.idle",
            properties: {
              sessionID: "ses_refresh_runtime"
            }
          }
        }
      ]);
    }

    if (url === "http://127.0.0.1:41827/session/ses_refresh_runtime/message" && method === "POST") {
      return jsonResponse({});
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeRuntimeAdapter({
    baseUrlResolver: ({ refresh } = {}) => {
      if (refresh) {
        currentBaseUrl = "http://127.0.0.1:41827";
      }

      return currentBaseUrl;
    },
    requestTimeoutMs: 1_000
  });

  const launch = await adapter.startSession(
    {
      sessionId: "local-session-3",
      workspaceId: "workspace-1",
      workspacePath: "/Users/jackson/Code/CodingNS",
      provider: "opencode",
      providerSessionId: null,
      rawStoreRef: null,
      options: {
        content: "刷新地址后继续",
        clientRequestId: null,
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        providerPrompt: null,
        attachments: []
      }
    },
    {
      updateSessionBinding() {},
      async emit() {}
    }
  );

  await launch.completed;

  assert.equal(currentBaseUrl, "http://127.0.0.1:41827");
  assert.equal(launch.providerSessionId, "ses_refresh_runtime");
});

test("OpenCodeRuntimeAdapter 会忽略 step 事件和空 text part", async (context) => {
  const originalFetch = globalThis.fetch;
  const events = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";

    if (url.startsWith("http://127.0.0.1:41827/session?") && method === "POST") {
      return jsonResponse({ id: "ses_runtime_filter" });
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_filter" && method === "GET") {
      return jsonResponse({
        id: "ses_runtime_filter",
        directory: "/Users/jackson/Code/CodingNS"
      });
    }

    if (url === "http://127.0.0.1:41827/event" && method === "GET") {
      return sseResponse([
        {
          payload: {
            type: "message.updated",
            properties: {
              info: {
                id: "msg_runtime_filter",
                sessionID: "ses_runtime_filter",
                role: "assistant",
                time: {
                  created: 1
                }
              }
            }
          }
        },
        {
          payload: {
            type: "message.part.updated",
            properties: {
              part: {
                id: "prt_step_start",
                messageID: "msg_runtime_filter",
                sessionID: "ses_runtime_filter",
                type: "step-start"
              }
            }
          }
        },
        {
          payload: {
            type: "message.part.updated",
            properties: {
              part: {
                id: "prt_empty_text",
                messageID: "msg_runtime_filter",
                sessionID: "ses_runtime_filter",
                type: "text",
                text: "",
                time: {
                  start: 1
                },
                metadata: {
                  openai: {
                    itemId: "msg_raw"
                  }
                }
              }
            }
          }
        },
        {
          payload: {
            type: "message.part.updated",
            properties: {
              part: {
                id: "prt_final_text",
                messageID: "msg_runtime_filter",
                sessionID: "ses_runtime_filter",
                type: "text",
                text: "4567",
                time: {
                  start: 2,
                  end: 2
                }
              }
            }
          }
        },
        {
          payload: {
            type: "message.part.updated",
            properties: {
              part: {
                id: "prt_step_finish",
                messageID: "msg_runtime_filter",
                sessionID: "ses_runtime_filter",
                type: "step-finish",
                reason: "stop"
              }
            }
          }
        },
        {
          payload: {
            type: "session.idle",
            properties: {
              sessionID: "ses_runtime_filter"
            }
          }
        }
      ]);
    }

    if (url === "http://127.0.0.1:41827/session/ses_runtime_filter/message" && method === "POST") {
      return jsonResponse({});
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  };

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const adapter = new OpenCodeRuntimeAdapter({
    baseUrl: "http://127.0.0.1:41827",
    requestTimeoutMs: 1_000
  });

  const launch = await adapter.startSession(
    {
      sessionId: "local-session-4",
      workspaceId: "workspace-1",
      workspacePath: "/Users/jackson/Code/CodingNS",
      provider: "opencode",
      providerSessionId: null,
      rawStoreRef: null,
      options: {
        content: "过滤占位事件",
        clientRequestId: null,
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        providerPrompt: null,
        attachments: []
      }
    },
    {
      updateSessionBinding() {},
      async emit(event) {
        events.push(event);
      }
    }
  );

  await launch.completed;

  const messageEvents = events.filter((event) => event.type === "message");
  assert.equal(messageEvents.length, 1);
  assert.equal(messageEvents[0].message.content, "4567");
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function sseResponse(frames) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      for (const item of frames) {
        const frame = item && typeof item === "object" && "frame" in item ? item.frame : item;
        const delayMs =
          item && typeof item === "object" && "delayMs" in item && Number.isFinite(item.delayMs)
            ? item.delayMs
            : 0;

        if (delayMs > 0) {
          await new Promise((resolve) => {
            setTimeout(resolve, delayMs);
          });
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      }

      controller.close();
    }
  });

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream"
    }
  });
}
