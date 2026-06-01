import { describe, expect, it } from "vitest";

import { resolveAffairsDocumentExtension, resolveAffairsDocumentVisual } from "./affairs-document-visual";

describe("affairs-document-visual", () => {
  it("能识别常见办公文档类型", () => {
    expect(resolveAffairsDocumentVisual("周报.docx")).toMatchObject({
      extension: "docx",
      kind: "word",
      badge: "DOC",
      tone: "blue"
    });
    expect(resolveAffairsDocumentVisual("成本核算.xlsx")).toMatchObject({
      extension: "xlsx",
      kind: "spreadsheet",
      badge: "XLS",
      tone: "green"
    });
    expect(resolveAffairsDocumentVisual("宣讲稿.pptx")).toMatchObject({
      extension: "pptx",
      kind: "presentation",
      badge: "PPT",
      tone: "orange"
    });
  });

  it("能识别图片压缩包代码和多媒体", () => {
    expect(resolveAffairsDocumentVisual("封面图.heic")).toMatchObject({
      kind: "image",
      tone: "purple"
    });
    expect(resolveAffairsDocumentVisual("归档资料.zip")).toMatchObject({
      kind: "archive",
      badge: "ZIP",
      tone: "amber"
    });
    expect(resolveAffairsDocumentVisual("同步脚本.ts")).toMatchObject({
      kind: "code",
      badge: "CODE",
      tone: "indigo"
    });
    expect(resolveAffairsDocumentVisual("演示视频.mp4")).toMatchObject({
      kind: "video",
      badge: "VIDEO",
      tone: "violet"
    });
  });

  it("能把 html json xml yaml sql 分开识别", () => {
    expect(resolveAffairsDocumentVisual("页面模板.html")).toMatchObject({
      kind: "web",
      badge: "HTML",
      tone: "sky"
    });
    expect(resolveAffairsDocumentVisual("配置.json")).toMatchObject({
      kind: "json",
      badge: "JSON",
      tone: "cyan"
    });
    expect(resolveAffairsDocumentVisual("清单.xml")).toMatchObject({
      kind: "xml",
      badge: "XML",
      tone: "cyan"
    });
    expect(resolveAffairsDocumentVisual("流水线.yaml")).toMatchObject({
      kind: "yaml",
      badge: "YAML",
      tone: "cyan"
    });
    expect(resolveAffairsDocumentVisual("建表.sql")).toMatchObject({
      kind: "database",
      badge: "SQL",
      tone: "cyan"
    });
  });

  it("没有后缀时回退成通用文件", () => {
    expect(resolveAffairsDocumentExtension("README")).toBe("document");
    expect(resolveAffairsDocumentVisual("README")).toMatchObject({
      extension: "document",
      kind: "file",
      badge: "FILE",
      tone: "neutral"
    });
  });
});
