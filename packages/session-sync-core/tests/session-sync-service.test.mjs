import test from "node:test";
import assert from "node:assert/strict";

import { SessionSyncService } from "../dist/index.js";

test("SessionSyncService 在单个 provider 发现失败时仍会返回其他 provider 的结果", async () => {
  const service = new SessionSyncService({
    list() {
      return [
        {
          providerId: "good-provider",
          async detectSessionsDetailed() {
            return {
              sessions: [
                {
                  provider: "good-provider",
                  providerSessionId: "good-session-1",
                  title: "Good Session",
                  workspacePath: "/tmp/workspace",
                  rawStoreRef: "good://session/good-session-1",
                  lastMessageAt: "2026-04-11T10:00:00.000Z",
                  messageCount: 3
                }
              ],
              isComplete: true
            };
          }
        },
        {
          providerId: "bad-provider",
          async detectSessionsDetailed() {
            throw new Error("SERVER_TIMEOUT");
          }
        }
      ];
    }
  });

  const discovery = await service.discoverWorkspaceSessions("/tmp/workspace");

  assert.equal(discovery.sessions.length, 1);
  assert.equal(discovery.sessions[0]?.provider, "good-provider");
  assert.equal(discovery.isComplete, false);
  assert.deepEqual(
    discovery.providerDiagnostics?.map((entry) => ({
      provider: entry.provider,
      status: entry.status,
      isComplete: entry.isComplete,
      errorMessage: entry.errorMessage
    })),
    [
      {
        provider: "bad-provider",
        status: "failed",
        isComplete: false,
        errorMessage: "SERVER_TIMEOUT"
      },
      {
        provider: "good-provider",
        status: "success",
        isComplete: true,
        errorMessage: null
      }
    ]
  );
});

test("SessionSyncService 会在所有 provider 都完整成功时返回完整发现结果", async () => {
  const service = new SessionSyncService({
    list() {
      return [
        {
          providerId: "provider-a",
          async detectSessionsDetailed() {
            return {
              sessions: [
                {
                  provider: "provider-a",
                  providerSessionId: "session-a",
                  title: "Session A",
                  workspacePath: "/tmp/workspace",
                  rawStoreRef: "a://session/session-a",
                  lastMessageAt: "2026-04-11T10:00:00.000Z",
                  messageCount: 1
                }
              ],
              isComplete: true
            };
          }
        },
        {
          providerId: "provider-b",
          async detectSessionsDetailed() {
            return {
              sessions: [
                {
                  provider: "provider-b",
                  providerSessionId: "session-b",
                  title: "Session B",
                  workspacePath: "/tmp/workspace",
                  rawStoreRef: "b://session/session-b",
                  lastMessageAt: "2026-04-11T11:00:00.000Z",
                  messageCount: 2
                }
              ],
              isComplete: true
            };
          }
        }
      ];
    }
  });

  const discovery = await service.discoverWorkspaceSessions("/tmp/workspace");

  assert.deepEqual(
    discovery.sessions.map((session) => session.providerSessionId),
    ["session-b", "session-a"]
  );
  assert.equal(discovery.isComplete, true);
  assert.deepEqual(
    discovery.providerDiagnostics?.map((entry) => ({
      provider: entry.provider,
      status: entry.status,
      isComplete: entry.isComplete
    })),
    [
      {
        provider: "provider-a",
        status: "success",
        isComplete: true
      },
      {
        provider: "provider-b",
        status: "success",
        isComplete: true
      }
    ]
  );
});

test("SessionSyncService 会保留 provider 自带的扫描诊断字段", async () => {
  const service = new SessionSyncService({
    list() {
      return [
        {
          providerId: "provider-a",
          async detectSessionsDetailed() {
            return {
              sessions: [
                {
                  provider: "provider-a",
                  providerSessionId: "session-a",
                  title: "Session A",
                  workspacePath: "/tmp/workspace",
                  rawStoreRef: "a://session/session-a",
                  lastMessageAt: "2026-04-11T10:00:00.000Z",
                  messageCount: 1
                }
              ],
              isComplete: true,
              providerDiagnostics: [
                {
                  provider: "provider-a",
                  status: "success",
                  durationMs: 12,
                  sessionCount: 1,
                  isComplete: true,
                  errorMessage: null,
                  scannedFiles: 9,
                  skippedByMtimeSize: 5,
                  parsedFiles: 4,
                  bytesRead: 4096
                }
              ]
            };
          }
        }
      ];
    }
  });

  const discovery = await service.discoverWorkspaceSessions("/tmp/workspace");

  assert.deepEqual(discovery.providerDiagnostics, [
    {
      provider: "provider-a",
      status: "success",
      durationMs: 12,
      sessionCount: 1,
      isComplete: true,
      errorMessage: null,
      scannedFiles: 9,
      skippedByMtimeSize: 5,
      parsedFiles: 4,
      bytesRead: 4096
    }
  ]);
});
