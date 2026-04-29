import { describe, expect, it } from "vitest";

import { t } from "../../shared/i18n";
import {
  buildSessionExportFileName,
  buildSessionMarkdownExport,
  buildSessionPdfExport,
  buildStandaloneSessionExportHtml
} from "./session-export";

import type { SessionSummaryDto } from "./api/conversation-api";
import type { SessionMessageViewModel } from "./runtime/session-runtime-machine";

function createSessionSummary(): SessionSummaryDto {
  return {
    sessionId: "session-1",
    workspaceId: "workspace-1",
    provider: "codex",
    providerSessionId: "provider-session-1",
    rawStoreRef: "store-ref",
    title: "导出测试会话",
    messageCount: 2,
    lastMessageAt: "2026-04-28T10:05:00.000Z",
    createdAt: "2026-04-28T10:00:00.000Z",
    updatedAt: "2026-04-28T10:05:00.000Z",
    syncStatus: "idle",
    syncCursor: null,
    lastSyncAt: null,
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    runningState: "completed",
    activitySource: "runtime",
    lastEventAt: "2026-04-28T10:05:00.000Z",
    completedAt: "2026-04-28T10:05:00.000Z",
    lastSeenAt: null,
    activityState: "idle"
  };
}

function createMessage(input: Partial<SessionMessageViewModel> & Pick<SessionMessageViewModel, "id" | "role" | "content" | "timestamp">): SessionMessageViewModel {
  return {
    sessionId: "session-1",
    kind: "text",
    toolCall: null,
    attachments: [],
    attachmentPayloads: null,
    origin: null,
    originRef: null,
    sequence: 1,
    rawRef: `raw://${input.id}`,
    deliveryState: "sent",
    clientRequestId: null,
    ...input
  };
}

describe("session-export", () => {
  it("生成稳定的导出文件名", () => {
    const exportDate = new Date("2026-04-28T10:06:07.000Z");
    const fileName = buildSessionExportFileName(
      createSessionSummary(),
      "md",
      exportDate
    );
    const expectedTimestamp = [
      exportDate.getFullYear(),
      String(exportDate.getMonth() + 1).padStart(2, "0"),
      String(exportDate.getDate()).padStart(2, "0")
    ].join("")
      + "-"
      + [
        String(exportDate.getHours()).padStart(2, "0"),
        String(exportDate.getMinutes()).padStart(2, "0"),
        String(exportDate.getSeconds()).padStart(2, "0")
      ].join("");

    expect(fileName).toBe(`导出测试会话-${expectedTimestamp}.md`);
  });

  it("支持 html 导出文件名和文档外壳", () => {
    const fileName = buildSessionExportFileName(createSessionSummary(), "html", new Date("2026-04-28T10:06:07.000Z"));
    const documentHtml = buildStandaloneSessionExportHtml({
      title: "导出测试会话",
      bodyHtml: "<main>hello</main>",
      styleText: "body { color: red; }",
      htmlAttributes: { lang: "zh-CN" },
      bodyAttributes: { "data-runtime-platform": "desktop" },
      htmlStyle: "--demo: 1;",
      bodyStyle: "margin: 0;"
    });

    expect(fileName.endsWith(".html")).toBe(true);
    expect(documentHtml).toContain("<!DOCTYPE html>");
    expect(documentHtml).toContain('<html lang="zh-CN" style="--demo: 1;">');
    expect(documentHtml).toContain('<body data-runtime-platform="desktop" style="margin: 0;">');
    expect(documentHtml).toContain("<main>hello</main>");
  });

  it("把会话消息导出成 markdown", () => {
    const markdown = buildSessionMarkdownExport(createSessionSummary(), [
      createMessage({
        id: "message-1",
        role: "user",
        content: "请帮我导出当前会话。",
        timestamp: "2026-04-28T10:00:01.000Z"
      }),
      createMessage({
        id: "message-2",
        role: "assistant",
        content: "可以，下面给你方案。",
        timestamp: "2026-04-28T10:00:05.000Z",
        toolCall: {
          callId: "tool-1",
          name: "update_plan",
          input: "{\"plan\":[]}",
          output: "{\"ok\":true}",
          error: null,
          status: "completed"
        }
      })
    ]);

    expect(markdown).toContain("# 导出测试会话");
    expect(markdown).toContain(`## 1. ${t("conversation.roleUser")}`);
    expect(markdown).toContain("请帮我导出当前会话。");
    expect(markdown).toContain(`## 2. ${t("conversation.roleAssistant")}`);
    expect(markdown).toContain(`### ${t("conversation.exportMarkdownToolSectionTitle")}`);
    expect(markdown).toContain(`#### ${t("conversation.exportMarkdownToolInputLabel")}`);
    expect(markdown).toContain("{\"plan\":[]}");
    expect(markdown).toContain(`#### ${t("conversation.exportMarkdownToolOutputLabel")}`);
    expect(markdown).toContain("{\"ok\":true}");
  });

  it("生成可下载的 PDF 文件头", () => {
    const pdfBytes = buildSessionPdfExport(createSessionSummary(), [
      createMessage({
        id: "message-1",
        role: "user",
        content: "请导出包含中文内容的 PDF。",
        timestamp: "2026-04-28T10:00:01.000Z"
      })
    ]);

    const header = new TextDecoder().decode(pdfBytes.slice(0, 8));
    expect(header.startsWith("%PDF-1.4")).toBe(true);
  });

  it("PDF 会统一使用同一套字体输出中英文内容", () => {
    const pdfBytes = buildSessionPdfExport(createSessionSummary(), [
      createMessage({
        id: "message-1",
        role: "user",
        content: "使用opencli查询",
        timestamp: "2026-04-28T10:00:01.000Z"
      })
    ]);

    const pdfText = new TextDecoder().decode(pdfBytes);
    expect(pdfText.includes("BT /F1")).toBe(true);
    expect(pdfText.includes("BT /F2")).toBe(false);
    expect(pdfText.includes("BT /F3")).toBe(false);
  });
});
