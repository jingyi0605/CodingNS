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
    start(controller) {
      for (const frame of frames) {
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
