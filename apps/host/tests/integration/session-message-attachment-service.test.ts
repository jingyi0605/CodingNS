import { describe, expect, it } from "vitest";

import { normalizeProviderMessageContent } from "../../src/modules/sessions/session-message-attachment-service.js";

describe("SessionMessageAttachmentService 内容清洗", () => {
  it("会清理 Codex 消息里的内部附件提示块", () => {
    const content = [
      "请先处理这个问题",
      "[[CODINGNS_IMAGE_ATTACHMENTS]]",
      "下面这些图片是用户随消息附带的本地附件。请先读取并理解它们，再继续处理这条请求。",
      "/tmp/session-attachments/example.png",
      "[[/CODINGNS_IMAGE_ATTACHMENTS]]"
    ].join("\n\n");

    expect(normalizeProviderMessageContent("codex", content)).toBe("请先处理这个问题");
  });

  it("缺少结束标记时不会误删消息正文", () => {
    const content = [
      "请先处理这个问题",
      "[[CODINGNS_IMAGE_ATTACHMENTS]]",
      "这是一段不完整的内部提示"
    ].join("\n\n");

    expect(normalizeProviderMessageContent("codex", content)).toBe(content);
  });
});
