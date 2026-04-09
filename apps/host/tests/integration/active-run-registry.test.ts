import { describe, expect, it, vi } from "vitest";

import {
  ActiveRunRegistry,
  type NormalizedMessage,
  type RuntimeEventInput
} from "@codingns/session-sync-core";

describe("ActiveRunRegistry", () => {
  it("晚绑定监听器时会回放已经产生的 runtime 事件", async () => {
    const registry = new ActiveRunRegistry();
    const handle = registry.register({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      workspacePath: "/tmp/workspace-1",
      provider: "codex",
      providerSessionId: null,
      rawStoreRef: null
    });

    await handle.emit(buildMessageEvent("thread-1", "第一段响应", 1, "2026-04-09T09:00:00.000Z"));

    const received: NormalizedMessage[] = [];
    handle.attach((event) => {
      if (event.type === "message") {
        received.push(event.message);
      }
    });

    await flushMicrotasks();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      providerSessionId: "thread-1",
      content: "第一段响应"
    });
  });

  it("慢监听器不会阻塞 emit，也不会拖慢其他监听器", async () => {
    const registry = new ActiveRunRegistry();
    const handle = registry.register({
      sessionId: "session-2",
      workspaceId: "workspace-1",
      workspacePath: "/tmp/workspace-1",
      provider: "codex",
      providerSessionId: null,
      rawStoreRef: null
    });

    let releaseSlowListener: (() => void) | null = null;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlowListener = resolve;
    });
    const slowSeen: string[] = [];
    const fastSeen: string[] = [];

    handle.attach(async (event) => {
      if (event.type !== "message") {
        return;
      }

      slowSeen.push(event.message.content);

      if (slowSeen.length === 1) {
        await slowGate;
      }
    });

    handle.attach((event) => {
      if (event.type === "message") {
        fastSeen.push(event.message.content);
      }
    });

    let firstEmitResolved = false;
    const firstEmit = handle
      .emit(buildMessageEvent("thread-2", "第一段响应", 1, "2026-04-09T09:00:01.000Z"))
      .then(() => {
        firstEmitResolved = true;
      });

    await flushMicrotasks();

    expect(firstEmitResolved).toBe(true);
    expect(fastSeen).toEqual(["第一段响应"]);
    expect(slowSeen).toEqual(["第一段响应"]);

    await handle.emit(buildMessageEvent("thread-2", "第二段响应", 2, "2026-04-09T09:00:02.000Z"));
    await flushMicrotasks();

    expect(fastSeen).toEqual(["第一段响应", "第二段响应"]);
    expect(slowSeen).toEqual(["第一段响应"]);

    releaseSlowListener?.();
    await firstEmit;
    await vi.waitFor(() => {
      expect(slowSeen).toEqual(["第一段响应", "第二段响应"]);
    });
  });
});

function buildMessageEvent(
  providerSessionId: string,
  content: string,
  sequence: number,
  timestamp: string
): RuntimeEventInput {
  return {
    type: "message",
    providerSessionId,
    rawStoreRef: `codex://${providerSessionId}`,
    timestamp,
    message: {
      messageId: `message-${sequence}`,
      provider: "codex",
      providerSessionId,
      role: "assistant",
      kind: "text",
      content,
      toolCall: null,
      attachments: [],
      timestamp,
      sequence,
      rawRef: `codex://${providerSessionId}/message-${sequence}`
    }
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
