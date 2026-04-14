import { createServer } from "node:http";

import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { createWsServer } from "../src/ws/ws-server.js";

const activeClosers: Array<() => Promise<void> | void> = [];

function createWsMessageQueue(socket: WebSocket) {
  const pending: string[] = [];
  const waiters: Array<(value: string) => void> = [];

  socket.on("message", (raw) => {
    const text = raw.toString();
    const waiter = waiters.shift();

    if (waiter) {
      waiter(text);
      return;
    }

    pending.push(text);
  });

  return {
    async next(timeoutMs = 2_000): Promise<string> {
      if (pending.length > 0) {
        return pending.shift()!;
      }

      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.indexOf(resolve);

          if (index >= 0) {
            waiters.splice(index, 1);
          }

          reject(new Error(`等待 WebSocket 消息超时: ${timeoutMs}ms`));
        }, timeoutMs);

        waiters.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
    }
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

afterEach(async () => {
  while (activeClosers.length > 0) {
    const close = activeClosers.pop();
    await close?.();
  }
});

describe("ws-server 会话订阅确认", () => {
  it("只有订阅真正建好后才发送 session.subscribed，避免紧跟着 load_older 时误报未订阅", async () => {
    const server = createServer();
    activeClosers.push(() => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    }));

    const wsServer = createWsServer(
      server,
      {
        authenticate() {
          return {
            accessToken: "token",
            user: {
              userId: "user-1",
              username: "tester"
            }
          };
        }
      } as never,
      {
        async readSessionHistory(_sessionId, cursor) {
          if (cursor === null) {
            return {
              cursor: "cursor-initial",
              nextCursor: "cursor-older",
              total: 2,
              messages: [
                {
                  messageId: "message-2",
                  provider: "codex",
                  providerSessionId: "provider-session-1",
                  role: "assistant",
                  kind: "text",
                  content: "最新一条",
                  toolCall: null,
                  attachments: [],
                  timestamp: "2026-04-14T10:00:00.000Z",
                  sequence: 2,
                  rawRef: "raw://message-2"
                }
              ]
            };
          }

          return {
            cursor: "cursor-older",
            nextCursor: null,
            total: 2,
            messages: [
              {
                messageId: "message-1",
                provider: "codex",
                providerSessionId: "provider-session-1",
                role: "user",
                kind: "text",
                content: "更早一条",
                toolCall: null,
                attachments: [],
                timestamp: "2026-04-14T09:59:00.000Z",
                sequence: 1,
                rawRef: "raw://message-1"
              }
            ]
          };
        },
        async subscribeSession() {
          await delay(80);
          return {
            close() {}
          };
        }
      } as never,
      {
        subscribeRuntime() {
          return {
            close() {}
          };
        }
      } as never,
      {
        handleMessage() {
          return false;
        },
        cleanupClient() {}
      } as never,
      {
        handleMessage() {
          return false;
        },
        cleanupClient() {},
        async broadcastSnapshot() {}
      } as never
    );
    activeClosers.push(() => wsServer.close());

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.once("error", reject);
    });

    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("未获取到测试端口");
    }

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?access_token=token`);
    activeClosers.push(() => socket.close());
    const messages = createWsMessageQueue(socket);

    expect(JSON.parse(await messages.next()).type).toBe("system.connected");

    socket.send(
      JSON.stringify({
        type: "session.subscribe",
        sessionId: "session-1",
        limit: 1
      })
    );

    let sawSubscribed = false;
    let sawOlderHistory = false;

    for (let index = 0; index < 4; index += 1) {
      const payload = JSON.parse(await messages.next()) as {
        type: string;
        error_code?: string;
        messages?: Array<{ content: string }>;
      };

      if (payload.type === "session.subscribed") {
        sawSubscribed = true;
        socket.send(
          JSON.stringify({
            type: "session.load_older",
            sessionId: "session-1",
            cursor: "cursor-older",
            limit: 1
          })
        );
        continue;
      }

      if (payload.type === "session.error") {
        expect(payload.error_code).not.toBe("SESSION_NOT_SUBSCRIBED");
      }

      if (payload.type === "session.history_older") {
        sawOlderHistory = true;
        expect(payload.messages?.[0]?.content).toBe("更早一条");
        break;
      }
    }

    expect(sawSubscribed).toBe(true);
    expect(sawOlderHistory).toBe(true);
  });
});
