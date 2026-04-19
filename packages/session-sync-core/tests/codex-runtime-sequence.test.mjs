import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CodexRuntimeAdapter } from "../dist/runtime/codex-runtime.js";

function createRunRequest(overrides = {}) {
  return {
    sessionId: "session-1",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/workspace-1",
    provider: "codex",
    providerSessionId: "thread-1",
    rawStoreRef: "/tmp/codex-real/session.jsonl",
    sequenceBase: 5,
    options: {
      content: "请继续",
      clientRequestId: "client-1",
      model: null,
      reasoningLevel: null,
      permissionMode: null,
      providerPrompt: null,
      attachments: []
    },
    ...overrides
  };
}

test("CodexRuntimeAdapter 生成运行时消息时会接续 sequenceBase", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-runtime-sequence-"));
  const rawStoreRef = join(tempDir, "sessions", "2026", "03", "29", "session.jsonl");
  const emitted = [];
  const adapter = new CodexRuntimeAdapter({ homeDir: tempDir });

  mkdirSync(join(tempDir, "sessions", "2026", "03", "29"), { recursive: true });
  writeFileSync(rawStoreRef, "", "utf8");

  try {
    await adapter.runTurn(
      null,
      createRunRequest({
        rawStoreRef,
        sequenceBase: 5
      }),
      {
        async emit(event) {
          emitted.push(event);
        },
        updateSessionBinding() {}
      },
      "thread-1",
      rawStoreRef,
      new AbortController(),
      {
        async next() {
          return {
            done: true,
            value: undefined
          };
        }
      },
      [
        {
          type: "item.completed",
          item: {
            type: "agent_message",
            text: "Codex 已处理完成"
          }
        }
      ],
      Date.now()
    );

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]?.type, "message");
    assert.equal(emitted[0]?.message.sequence, 6);
    assert.equal(emitted[0]?.message.role, "assistant");
    assert.equal(emitted[0]?.message.content, "Codex 已处理完成");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexRuntimeAdapter continueSession 会直接复用 provider 子线程，而不是按本地历史重建上下文", async () => {
  const resumedThreadIds = [];
  let resumeFromHistoryCalled = false;
  let closeHandler = null;
  const adapter = new CodexRuntimeAdapter({
    homeDir: "/tmp/codingns-codex-runtime-continue",
    transportFactory: () => ({
      async initialize() {},
      async startThread() {
        throw new Error("UNEXPECTED_START_THREAD");
      },
      async resumeThread(_request, providerSessionId) {
        resumedThreadIds.push(providerSessionId);
        return {
          providerSessionId,
          rawStoreRef: `/tmp/${providerSessionId}.jsonl`
        };
      },
      async resumeThreadFromHistory() {
        resumeFromHistoryCalled = true;
        return {
          providerSessionId: "rebuilt-thread",
          rawStoreRef: "/tmp/rebuilt-thread.jsonl"
        };
      },
      async startTurn() {
        closeHandler?.(null);
      },
      async steerTurn() {},
      async interruptTurn() {},
      setNotificationHandler() {},
      setServerRequestHandler() {},
      setOnClose(handler) {
        closeHandler = handler;
      },
      isClosed() {
        return false;
      },
      close() {}
    })
  });

  const launch = await adapter.continueSession(
    createRunRequest({
      providerSessionId: "child-thread-dirty",
      rawStoreRef: "/tmp/host-sanitized-view.jsonl"
    }),
    {
      async emit() {},
      updateSessionBinding() {}
    }
  );

  await launch.completed;

  assert.deepEqual(resumedThreadIds, ["child-thread-dirty"]);
  assert.equal(resumeFromHistoryCalled, false);
});

test("CodexRuntimeAdapter continueSession 遇到未加载的 fork 子线程时，会按本地 transcript 冷恢复", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-runtime-cold-resume-"));
  const rawStoreRef = join(tempDir, "sessions", "2026", "04", "19", "child-thread.jsonl");
  const bindings = [];
  const resumeFromHistoryCalls = [];
  let closeHandler = null;

  mkdirSync(join(tempDir, "sessions", "2026", "04", "19"), { recursive: true });
  writeFileSync(
    rawStoreRef,
    [
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "019da3bc-6401-74e1-90f6-52fcb30d225f",
          cwd: "/tmp/workspace-1"
        }
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "父会话问题"
        }
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "父会话回答"
        }
      })
    ].join("\n"),
    "utf8"
  );

  try {
    const adapter = new CodexRuntimeAdapter({
      homeDir: tempDir,
      transportFactory: () => ({
        async initialize() {},
        async startThread() {
          throw new Error("UNEXPECTED_START_THREAD");
        },
        async resumeThread() {
          throw new Error("no rollout found for thread id 019da3bc-6401-74e1-90f6-52fcb30d225f");
        },
        async resumeThreadFromHistory(input) {
          resumeFromHistoryCalls.push(input);
          return {
            providerSessionId: "rebuilt-child-thread",
            rawStoreRef
          };
        },
        async startTurn() {
          closeHandler?.(null);
        },
        async steerTurn() {},
        async interruptTurn() {},
        setNotificationHandler() {},
        setServerRequestHandler() {},
        setOnClose(handler) {
          closeHandler = handler;
        },
        isClosed() {
          return false;
        },
        close() {}
      })
    });

    const launch = await adapter.continueSession(
      createRunRequest({
        providerSessionId: "019da3bc-6401-74e1-90f6-52fcb30d225f",
        rawStoreRef
      }),
      {
        async emit() {},
        updateSessionBinding(binding) {
          bindings.push(binding);
        }
      }
    );

    await launch.completed;

    assert.equal(resumeFromHistoryCalls.length, 1);
    assert.deepEqual(
      resumeFromHistoryCalls[0]?.history,
      [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "父会话问题" }]
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "父会话回答" }]
        }
      ]
    );
    assert.equal(launch.providerSessionId, "rebuilt-child-thread");
    assert.equal(bindings.at(0)?.providerSessionId, "rebuilt-child-thread");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexRuntimeAdapter continueSession 遇到父会话 rawStoreRef 脏绑定时，会优先切到当前子线程 transcript", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-codex-runtime-continue-dirty-"));
  const parentRawStoreRef = join(tempDir, "parent-thread.jsonl");
  const childRawStoreRef = join(tempDir, "child-thread.jsonl");
  const bindings = [];
  const emitted = [];
  let closeHandler = null;

  try {
    writeFileSync(
      parentRawStoreRef,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "parent-thread",
            cwd: "/tmp/workspace-1"
          }
        })
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      childRawStoreRef,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "child-thread",
            cwd: "/tmp/workspace-1"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const adapter = new CodexRuntimeAdapter({
      homeDir: tempDir,
      transportFactory: () => ({
        async initialize() {},
        async startThread() {
          throw new Error("UNEXPECTED_START_THREAD");
        },
        async resumeThread(_request, providerSessionId) {
          return {
            providerSessionId,
            rawStoreRef: childRawStoreRef
          };
        },
        async resumeThreadFromHistory() {
          throw new Error("UNEXPECTED_RESUME_THREAD_FROM_HISTORY");
        },
        async startTurn() {
          closeHandler?.(null);
        },
        async steerTurn() {},
        async interruptTurn() {},
        setNotificationHandler() {},
        setServerRequestHandler() {},
        setOnClose(handler) {
          closeHandler = handler;
        },
        isClosed() {
          return false;
        },
        close() {}
      })
    });

    const launch = await adapter.continueSession(
      createRunRequest({
        providerSessionId: "child-thread",
        rawStoreRef: parentRawStoreRef
      }),
      {
        async emit(event) {
          emitted.push(event);
        },
        updateSessionBinding(binding) {
          bindings.push(binding);
        }
      }
    );

    await launch.completed;

    assert.equal(launch.rawStoreRef, childRawStoreRef);
    assert.equal(bindings.at(0)?.providerSessionId, "child-thread");
    assert.equal(bindings.at(0)?.rawStoreRef, childRawStoreRef);
    assert.equal(emitted.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexRuntimeAdapter 会把运行中追加消息转发到 app-server 的 steerTurn", async () => {
  const steerCalls = [];
  let closeHandler = null;
  const adapter = new CodexRuntimeAdapter({
    homeDir: "/tmp/codingns-codex-runtime-steer",
    transportFactory: () => ({
      async initialize() {},
      async startThread() {
        return {
          providerSessionId: "thread-steer",
          rawStoreRef: "/tmp/thread-steer.jsonl"
        };
      },
      async resumeThread() {
        throw new Error("UNEXPECTED_RESUME_THREAD");
      },
      async resumeThreadFromHistory() {
        throw new Error("UNEXPECTED_RESUME_THREAD_FROM_HISTORY");
      },
      async startTurn() {
        return {
          notification: {
            method: "turn/started",
            params: {
              turn: {
                id: "turn-steer-1"
              }
            }
          }
        };
      },
      async steerTurn(options) {
        steerCalls.push(options);
      },
      async interruptTurn() {},
      setNotificationHandler() {},
      setServerRequestHandler() {},
      setOnClose(handler) {
        closeHandler = handler;
      },
      isClosed() {
        return false;
      },
      close() {
        closeHandler?.(null);
      }
    })
  });

  const launch = await adapter.startSession(
    createRunRequest({
      providerSessionId: null,
      rawStoreRef: null
    }),
    {
      async emit() {},
      updateSessionBinding() {}
    }
  );

  await launch.submitDuringRun?.({
    content: "继续补一条要求",
    clientRequestId: "client-steer-2",
    model: null,
    reasoningLevel: null,
    permissionMode: null,
    providerPrompt: "继续补一条要求",
    attachments: []
  });

  assert.equal(steerCalls.length, 1);
  assert.equal(steerCalls[0]?.content, "继续补一条要求");
});
