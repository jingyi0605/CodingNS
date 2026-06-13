import test from "node:test";
import assert from "node:assert/strict";

import { ProviderRuntimeService } from "../dist/runtime/provider-runtime-service.js";

function createRunRequest(overrides = {}) {
  return {
    sessionId: "session-1",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/workspace-1",
    provider: "codex",
    providerSessionId: null,
    rawStoreRef: null,
    options: {
      content: "初始消息",
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

test("ProviderRuntimeService 会把运行中输入提交给当前 active run", async () => {
  const submitCalls = [];
  const adapter = {
    providerId: "codex",
    async startSession() {
      return {
        providerSessionId: "thread-1",
        rawStoreRef: "codex://thread-1",
        completed: new Promise(() => {}),
        submitDuringRun: async (options) => {
          submitCalls.push(options);
        }
      };
    },
    async continueSession() {
      throw new Error("not used");
    }
  };

  const service = new ProviderRuntimeService([adapter]);

  try {
    await service.startSession(createRunRequest());
    const snapshot = await service.submitToActiveRun("session-1", {
      content: "继续补充要求",
      clientRequestId: "client-2",
      model: "gpt-5.3-codex",
      reasoningLevel: "high",
      permissionMode: null,
      providerPrompt: "继续补充要求",
      attachments: []
    });

    assert.equal(submitCalls.length, 1);
    assert.equal(submitCalls[0]?.content, "继续补充要求");
    assert.equal(snapshot.sessionId, "session-1");
    assert.equal(snapshot.providerSessionId, "thread-1");
  } finally {
    await service.dispose();
  }
});

test("ProviderRuntimeService 在 active run 不支持运行中输入时会明确报错", async () => {
  const adapter = {
    providerId: "codex",
    async startSession() {
      return {
        providerSessionId: "thread-1",
        rawStoreRef: "codex://thread-1",
        completed: new Promise(() => {})
      };
    },
    async continueSession() {
      throw new Error("not used");
    }
  };

  const service = new ProviderRuntimeService([adapter]);

  try {
    await service.startSession(createRunRequest());

    await assert.rejects(
      () =>
        service.submitToActiveRun("session-1", {
          content: "继续补充要求",
          clientRequestId: "client-2",
          model: null,
          reasoningLevel: null,
          permissionMode: null,
          providerPrompt: null,
          attachments: []
        }),
      /IN_RUN_INPUT_NOT_SUPPORTED/
    );
  } finally {
    await service.dispose();
  }
});

test("ProviderRuntimeService 在运行中提交 guidance 时不会重启第二个 active run", async () => {
  const submitCalls = [];
  let startCalls = 0;
  let continueCalls = 0;
  let resolveCompleted;
  const completed = new Promise((resolve) => {
    resolveCompleted = resolve;
  });

  const adapter = {
    providerId: "claude-code",
    async startSession() {
      startCalls += 1;
      return {
        providerSessionId: "claude-session-1",
        rawStoreRef: "claude://session-1",
        completed,
        submitDuringRun: async (options) => {
          submitCalls.push(options);
        }
      };
    },
    async continueSession() {
      continueCalls += 1;
      throw new Error("not used");
    }
  };

  const service = new ProviderRuntimeService([adapter]);

  try {
    await service.startSession(
      createRunRequest({
        provider: "claude-code"
      })
    );
    const beforeSubmit = service.getSnapshot("session-1");

    const afterSubmit = await service.submitToActiveRun("session-1", {
      content: "继续这条思路",
      clientRequestId: "client-2",
      model: null,
      reasoningLevel: null,
      permissionMode: null,
      providerPrompt: "继续这条思路",
      attachments: []
    });

    assert.equal(startCalls, 1);
    assert.equal(continueCalls, 0);
    assert.equal(submitCalls.length, 1);
    assert.equal(beforeSubmit?.providerSessionId, "claude-session-1");
    assert.equal(afterSubmit.providerSessionId, "claude-session-1");
    assert.equal(afterSubmit.rawStoreRef, "claude://session-1");
    assert.equal(afterSubmit.sessionId, "session-1");

    resolveCompleted();
    await completed;
  } finally {
    await service.dispose();
  }
});

test("ProviderRuntimeService 会忽略已结束 active run 的迟到 binding 更新", async () => {
  let lateUpdate = null;
  let resolveCompleted;
  const completed = new Promise((resolve) => {
    resolveCompleted = resolve;
  });

  const adapter = {
    providerId: "claude-code",
    async startSession(_request, sink) {
      lateUpdate = () =>
        sink.updateSessionBinding({
          providerSessionId: "claude-session-late",
          rawStoreRef: "claude://late"
        });

      return {
        providerSessionId: "claude-session-1",
        rawStoreRef: "claude://session-1",
        completed
      };
    },
    async continueSession() {
      throw new Error("not used");
    }
  };

  const service = new ProviderRuntimeService([adapter]);

  try {
    await service.startSession(
      createRunRequest({
        provider: "claude-code"
      })
    );

    resolveCompleted();
    await completed;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(service.getSnapshot("session-1"), null);
    assert.doesNotThrow(() => lateUpdate?.());
  } finally {
    await service.dispose();
  }
});
