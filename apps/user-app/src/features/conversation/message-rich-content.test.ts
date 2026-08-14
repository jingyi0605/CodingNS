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
      inlineImages: [],
      structuredQuestions: null
    });
  });

  it("会隐藏未闭合的内部图片附件调试块", () => {
    const content = [
      "分析图片内容",
      "[[CODINGNS_IMAGE_ATTACHMENTS]]",
      "下面这些图片是用户随消息附带的本地附件。",
      "/Users/jackson/.codingns/session-attachments/session-1/example-image.png"
    ].join("\n\n");

    expect(parseMessageRichContent(content)).toEqual({
      text: "分析图片内容",
      inlineImages: [],
      structuredQuestions: null
    });
  });

  it("会识别结构化问题并从可见文本里剥掉 questions JSON", () => {
    const content = JSON.stringify({
      questions: [
        {
          question: "你想把笑话保存到哪个文件名？",
          header: "文件名",
          options: [
            {
              label: "jokes.md",
              description: "保存为 jokes.md"
            }
          ]
        }
      ]
    });

    expect(parseMessageRichContent(content)).toEqual({
      text: "",
      inlineImages: [],
      structuredQuestions: {
        questions: [
          {
            id: "structured-question-1",
            header: "文件名",
            question: "你想把笑话保存到哪个文件名？",
            allowOther: false,
            secret: false,
            multiSelect: false,
            options: [
              {
                label: "jokes.md",
                description: "保存为 jokes.md"
              }
            ]
          }
        ]
      }
    });
  });

  it("会识别正文后面的 question 代码块，并保留前置说明文字", () => {
    const content = [
      "我有两个问题需要确认：",
      "```question",
      JSON.stringify({
        questions: [
          {
            question: "spec 目录下的 requirements.md 是否存在？",
            header: "Spec 文件存在",
            options: [
              {
                label: "帮我创建",
                description: "按模板先补齐"
              }
            ]
          }
        ]
      }, null, 2),
      "```"
    ].join("\n");

    expect(parseMessageRichContent(content)).toEqual({
      text: "我有两个问题需要确认：",
      inlineImages: [],
      structuredQuestions: {
        questions: [
          {
            id: "structured-question-1",
            header: "Spec 文件存在",
            question: "spec 目录下的 requirements.md 是否存在？",
            allowOther: false,
            secret: false,
            multiSelect: false,
            options: [
              {
                label: "帮我创建",
                description: "按模板先补齐"
              }
            ]
          }
        ]
      }
    });
  });
});
