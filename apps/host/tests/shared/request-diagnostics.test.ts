import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import {
  HttpRequestDiagnosticsTracker,
  logHostFatalDiagnostics
} from "../../src/shared/http/request-diagnostics.js";

describe("HttpRequestDiagnosticsTracker", () => {
  it("记录最近请求并脱敏预览 token", async () => {
    const tracker = new HttpRequestDiagnosticsTracker();
    const app = Fastify({ logger: false });

    app.addHook("onRequest", async (request, reply) => {
      const requestId = tracker.begin(request);
      request.requestDiagnosticsId = requestId;
      reply.raw.once("finish", () => {
        tracker.finish(requestId, reply, request);
      });
    });
    app.addHook("onResponse", async (request, reply) => {
      if (typeof request.requestDiagnosticsId === "number") {
        tracker.finish(request.requestDiagnosticsId, reply, request);
      }
    });
    app.get("/preview/affairs-files/:token/*", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/preview/affairs-files/sensitive-token/path/to/demo.html?token=secret&safe=1",
      headers: {
        "user-agent": "diagnostics-test"
      }
    });

    expect(response.statusCode).toBe(200);

    const snapshot = tracker.snapshot("test");
    expect(snapshot.activeRequests).toEqual([]);
    expect(snapshot.recentRequests).toHaveLength(1);
    expect(snapshot.recentRequests[0]).toEqual(
      expect.objectContaining({
        method: "GET",
        url: "/preview/affairs-files/[redacted]/path/to/demo.html?token=%5Bredacted%5D&safe=1",
        routePath: "/preview/affairs-files/:token/*",
        statusCode: 200,
        headersSent: true,
        userAgent: "diagnostics-test"
      })
    );

    await app.close();
  });

  it("fatal 日志会带上 active 和 recent 请求快照", async () => {
    const tracker = new HttpRequestDiagnosticsTracker();
    const app = Fastify({ logger: false });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    app.addHook("onRequest", async (request, reply) => {
      const requestId = tracker.begin(request);
      request.requestDiagnosticsId = requestId;
      reply.raw.once("finish", () => {
        tracker.finish(requestId, reply, request);
      });
    });
    app.get("/done", async () => ({ ok: true }));

    await app.inject({ method: "GET", url: "/done" });
    tracker.begin({
      method: "GET",
      url: "/pending",
      headers: {},
      ip: "127.0.0.1"
    } as any);

    const error = Object.assign(new Error("Cannot write headers after they are sent to the client"), {
      code: "ERR_HTTP_HEADERS_SENT"
    });
    logHostFatalDiagnostics(tracker, "uncaughtException", error);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[host-fatal]",
      expect.objectContaining({
        reason: "uncaughtException",
        error: expect.objectContaining({
          code: "ERR_HTTP_HEADERS_SENT",
          message: "Cannot write headers after they are sent to the client"
        }),
        diagnostics: expect.objectContaining({
          activeRequests: expect.arrayContaining([
            expect.objectContaining({
              method: "GET",
              url: "/pending"
            })
          ]),
          recentRequests: expect.arrayContaining([
            expect.objectContaining({
              method: "GET",
              url: "/done",
              statusCode: 200
            })
          ])
        })
      })
    );

    await app.close();
  });
});
