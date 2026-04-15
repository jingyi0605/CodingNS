import { describe, expect, it } from "vitest";

import { parseMessageRichContent } from "./message-rich-content";

describe("parseMessageRichContent", () => {
  it("会隐藏内部图片附件调试块", () => {
    const content = [
      "请帮我匹配并隐藏这段调试语句",
      "[[CODINGNS_IMAGE_ATTACHMENTS]]",
      "下面这些图片是用户随消息附带的本地附件。请先读取并理解它们，再继续处理这条请求。",
      "/Users/jackson/.codingns/session-attachments/session-1/example-image.png",
      "[[/CODINGNS_IMAGE_ATTACHMENTS]]"
    ].join("\n\n");

    expect(parseMessageRichContent(content)).toEqual({
      text: "请帮我匹配并隐藏这段调试语句",
      inlineImages: []
    });
  });
});
