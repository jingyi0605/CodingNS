import test from "node:test";
import assert from "node:assert/strict";

import { ProviderRegistry } from "../dist/index.js";

function createAdapter(providerId) {
  return {
    providerId,
    async detectSessions() {
      return [];
    },
    async readSessionHistory() {
      return {
        messages: [],
        cursor: null,
        nextCursor: null,
        total: 0
      };
    },
    subscribeSession() {
      return {
        close() {}
      };
    },
    async resumeSession(providerSessionId, rawStoreRef) {
      return {
        provider: providerId,
        providerSessionId,
        resumedAt: "2026-03-27T00:00:00.000Z",
        rawStoreRef
      };
    },
    async startSession(workspacePath) {
      return {
        session: {
          provider: providerId,
          providerSessionId: `${providerId}-session`,
          title: `${providerId} session`,
          workspacePath,
          rawStoreRef: `${providerId}://${workspacePath}`,
          lastMessageAt: null,
          messageCount: 0
        },
        initialCursor: null
      };
    },
    async sendMessage(providerSessionId, rawStoreRef, content, clientRequestId) {
      return {
        acceptedAt: "2026-03-27T00:00:00.000Z",
        clientRequestId,
        message: {
          messageId: `${providerId}-message`,
          provider: providerId,
          providerSessionId,
          role: "user",
          kind: "text",
          content,
          toolCall: null,
          timestamp: "2026-03-27T00:00:00.000Z",
          sequence: 1,
          rawRef: rawStoreRef
        }
      };
    },
    async readSessionTitle() {
      return `${providerId} title`;
    },
    async renameSessionTitle(_providerSessionId, _rawStoreRef, title) {
      return title;
    },
    async updateSessionArchiveState(rawStoreRef, _providerSessionId, isArchived) {
      return {
        rawStoreRef,
        isArchived
      };
    },
    getProviderCapabilities() {
      return {
        provider: providerId,
        canStartSession: true,
        canResumeSession: true,
        canSendMessage: true,
        inRunInputMode: "none",
        supportsSubagents: false,
        supportsInterrupt: false,
        supportsStructuredToolCalls: false,
        supportsTokenUsage: false,
        supportsAttachments: false,
        supportsPermissionPrompt: false,
        supportsCheckpoint: false,
        limitations: []
      };
    },
    async getSessionCapabilities() {
      return this.getProviderCapabilities();
    }
  };
}

test("ProviderRegistry 允许注册第三个 provider", () => {
  const registry = new ProviderRegistry([
    createAdapter("claude-code"),
    createAdapter("codex"),
    createAdapter("opencode")
  ]);

  assert.equal(registry.list().length, 3);
  assert.equal(registry.get("opencode").providerId, "opencode");
});

test("ProviderRegistry 遇到重复 providerId 会直接拒绝", () => {
  assert.throws(() => {
    new ProviderRegistry([createAdapter("codex"), createAdapter("codex")]);
  }, /PROVIDER_ALREADY_REGISTERED/);
});
