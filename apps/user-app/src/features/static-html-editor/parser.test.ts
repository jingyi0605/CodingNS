import { describe, expect, it } from "vitest";

import { t } from "../../shared/i18n";
import {
  appendProjectPage,
  buildStaticHtmlDocumentProject,
  buildStaticHtmlPresentationPreview,
  buildStaticHtmlPresentationPreviewFromProject,
  duplicateProjectPage,
  duplicateProjectNode,
  inspectStaticHtmlPresentation,
  moveProjectPage,
  removeProjectPage,
  writeStaticHtmlDocumentProject
} from "./parser";
import { readFileSync } from "node:fs";

describe("static html presentation parser", () => {
  it("能识别 deck + slide 的静态 HTML 演示文档", () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <style>
            :root { --deck-width: 1600px; --deck-height: 900px; }
          </style>
        </head>
        <body>
          <div class="deck">
            <section class="slide" data-title="封面">
              <div class="slide-shell">
                <h1>封面标题</h1>
                <p>封面正文</p>
              </div>
            </section>
            <section class="slide" data-title="第二页">
              <div class="slide-shell">
                <h2>第二页标题</h2>
                <img src="/assets/chart.png" alt="图表" />
              </div>
            </section>
          </div>
        </body>
      </html>
    `;

    const probe = inspectStaticHtmlPresentation(html, "demo.html");
    expect(probe.supported).toBe(true);
    expect(probe.pages).toHaveLength(2);
    expect(probe.pages[0]?.title).toBe("封面");
    expect(probe.viewport).toEqual({ width: 1600, height: 900 });

    const project = buildStaticHtmlDocumentProject({
      html,
      filePath: "demo.html"
    });
    expect(project).not.toBeNull();
    expect(project?.pages).toHaveLength(2);
    expect(project?.canvas.width).toBe(1600);
    expect(project?.assets[0]?.src).toBe("/assets/chart.png");
    expect(Object.values(project?.nodes ?? {}).some((node) => node.type === "text")).toBe(true);
    expect(Object.values(project?.nodes ?? {}).some((node) => node.type === "image")).toBe(true);
    expect(Object.values(project?.nodes ?? {}).some((node) => node.children.length > 0)).toBe(true);
  });

  it("没有稳定分页结构时会拒绝进入演示文档模式", () => {
    const html = `
      <!doctype html>
      <html>
        <body>
          <main>
            <article>just a normal html file</article>
          </main>
        </body>
      </html>
    `;

    const probe = inspectStaticHtmlPresentation(html, "demo.html");
    expect(probe.supported).toBe(false);
    expect(buildStaticHtmlDocumentProject({ html, filePath: "demo.html" })).toBeNull();
  });

  it("能只抽出当前页的 HTML 作为逐页预览", () => {
    const html = `
      <!doctype html>
      <html>
        <body>
          <div class="deck">
            <section class="slide" data-title="第一页"><h1>第一页</h1></section>
            <section class="slide" data-title="第二页"><h1>第二页</h1></section>
          </div>
        </body>
      </html>
    `;

    const preview = buildStaticHtmlPresentationPreview({
      html,
      pageIndex: 1
    });

    expect(preview).toContain('data-cns-active-page="true"');
    expect(preview).toContain("第二页");
    expect(preview).toContain("[data-cns-page-root");
  });

  it("逐页预览会显式隐藏非当前页，并显式显示当前页", () => {
    const html = `
      <!doctype html>
      <html>
        <body>
          <div class="deck">
            <section class="slide" data-title="第一页"><h1>第一页</h1></section>
            <section class="slide" data-title="第二页"><h1>第二页</h1></section>
          </div>
        </body>
      </html>
    `;

    const preview = buildStaticHtmlPresentationPreview({
      html,
      pageIndex: 0
    });

    expect(preview).toContain('[data-cns-page-root="true"]:not([data-cns-active-page="true"]) {');
    expect(preview).toContain('display: none !important;');
    expect(preview).toContain('[data-cns-page-root="true"][data-cns-active-page="true"] {');
    expect(preview).toContain('visibility: visible !important;');
  });

  it("复杂静态 HTML 在演示文档模式下仍能保留当前页内容，不会生成白屏", () => {
    const html = readFileSync(
      "/Users/jackson/Code/CodingNS/tmp/20260426-AI模型贴脸对战.html",
      "utf8"
    );

    const project = buildStaticHtmlDocumentProject({
      html,
      filePath: "20260426-AI模型贴脸对战.html"
    });

    expect(project).not.toBeNull();
    expect(project?.canvas.width).toBe(1220);
    expect(project?.canvas.height).toBe(686);

    const preview = buildStaticHtmlPresentationPreviewFromProject({
      html,
      project: project!,
      pageIndex: 0
    });

    expect(preview).toContain('data-cns-active-page="true"');
    expect(preview).toContain("AI 贴脸对战");
    expect(preview).toContain("DeepSeek-V4");
    expect(preview).toContain("model-pill");
  });

  it("响应式静态 HTML 在演示文档模式下仍会保留第一页可见内容和主题样式", () => {
    const html = readFileSync(
      "/Users/jackson/Code/CodingNS/tmp/codingns-presentation.html",
      "utf8"
    );

    const project = buildStaticHtmlDocumentProject({
      html,
      filePath: "codingns-presentation.html"
    });

    expect(project).not.toBeNull();
    expect(project?.canvas.width).toBe(1600);
    expect(project?.canvas.height).toBe(900);

    const preview = buildStaticHtmlPresentationPreviewFromProject({
      html,
      project: project!,
      pageIndex: 0
    });

    expect(preview).toContain('data-cns-active-page="true"');
    expect(preview).toContain("有请今天的主角");
    expect(preview).toContain("CodingNS");
    expect(preview).toContain("hero-logo");
    expect(preview).toContain(".bg-grid");
    expect(preview).toContain("--dark-bg: #0a0e1a");
    expect(preview).toContain('.fade-up,');
    expect(preview).toContain('opacity: 1 !important;');
    expect(preview).toContain('transition: none !important;');
    expect(preview).not.toContain("let current = 0;");
    expect(preview).not.toContain("setTimeout(() => { isAnimating = false; }, 600);");
  });

  it("根据项目草稿生成预览时会把节点编辑结果回写进当前页 HTML", () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <style>
            :root { --deck-width: 1600px; --deck-height: 900px; }
          </style>
        </head>
        <body>
          <div class="deck">
            <section class="slide" data-title="封面">
              <div class="slide-shell">
                <div class="hero-card">
                  <h1 style="font-size: 32px; color: #111111;">原始标题</h1>
                </div>
              </div>
            </section>
          </div>
        </body>
      </html>
    `;

    const project = buildStaticHtmlDocumentProject({
      html,
      filePath: "demo.html"
    });

    expect(project).not.toBeNull();
    const textNode = Object.values(project?.nodes ?? {}).find((node) => node.type === "text");
    expect(textNode).toBeTruthy();

    const editedProject = {
      ...project!,
      nodes: {
        ...project!.nodes,
        [textNode!.id]: {
          ...textNode!,
          content: {
            ...textNode!.content,
            text: "已修改标题"
          },
          style: {
            ...textNode!.style,
            color: "#ff0000",
            fontSize: 48
          }
        }
      }
    };

    const preview = buildStaticHtmlPresentationPreviewFromProject({
      html,
      project: editedProject,
      pageIndex: 0,
      selectedNodeId: textNode!.id
    });

    expect(preview).toContain("已修改标题");
    expect(preview).toContain("color: #ff0000");
    expect(preview).toContain("font-size: 48px");
    expect(preview).toContain('data-cns-node-selected="true"');
  });

  it("复制节点后，草稿副本也会进入当前页预览", () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <style>
            :root { --deck-width: 1600px; --deck-height: 900px; }
          </style>
        </head>
        <body>
          <div class="deck">
            <section class="slide" data-title="封面">
              <div class="slide-shell">
                <div class="hero-card">
                  <h1 style="font-size: 32px; color: #111111;">原始标题</h1>
                </div>
              </div>
            </section>
          </div>
        </body>
      </html>
    `;

    const project = buildStaticHtmlDocumentProject({
      html,
      filePath: "demo.html"
    });

    expect(project).not.toBeNull();
    const textNode = Object.values(project?.nodes ?? {}).find((node) => node.type === "text");
    expect(textNode).toBeTruthy();

    const duplicated = duplicateProjectNode(project!, textNode!.id);
    expect(duplicated.duplicatedNodeId).toBeTruthy();

    const preview = buildStaticHtmlPresentationPreviewFromProject({
      html,
      project: duplicated.project,
      pageIndex: 0,
      selectedNodeId: duplicated.duplicatedNodeId
    });

    expect(duplicated.project.nodes[duplicated.duplicatedNodeId!]?.name).toBe("原始标题 副本");
    expect(preview).toContain(`data-cns-node-id="${duplicated.duplicatedNodeId}"`);
    expect(preview).toContain('left: 24px');
    expect(preview).toContain('top: 24px');
  });

  it("保存回 HTML 时会去掉预览专用标记，并保留草稿副本内容", () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <style>
            :root { --deck-width: 1600px; --deck-height: 900px; }
          </style>
        </head>
        <body>
          <div class="deck">
            <section class="slide" data-title="封面">
              <div class="slide-shell">
                <div class="hero-card">
                  <h1 style="font-size: 32px; color: #111111;">原始标题</h1>
                </div>
              </div>
            </section>
          </div>
        </body>
      </html>
    `;

    const project = buildStaticHtmlDocumentProject({
      html,
      filePath: "demo.html"
    });

    expect(project).not.toBeNull();
    const textNode = Object.values(project?.nodes ?? {}).find((node) => node.type === "text");
    expect(textNode).toBeTruthy();

    const duplicated = duplicateProjectNode(project!, textNode!.id);
    const savedHtml = writeStaticHtmlDocumentProject({
      html,
      project: duplicated.project
    });

    expect(savedHtml).toContain("原始标题");
    expect(savedHtml?.match(/原始标题/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(savedHtml).toContain("position: absolute");
    expect(savedHtml).not.toContain("data-cns-page-root");
    expect(savedHtml).not.toContain("data-cns-node-selected");
  });

  it("新增、删除和调整页面顺序后，保存回 HTML 会同步页面结构", () => {
    const html = `
      <!doctype html>
      <html>
        <body>
          <div class="deck">
            <section class="slide" data-title="封面">
              <div class="slide-shell"><h1>封面标题</h1></div>
            </section>
            <section class="slide" data-title="方案页">
              <div class="slide-shell"><h1>方案页标题</h1></div>
            </section>
          </div>
        </body>
      </html>
    `;

    const project = buildStaticHtmlDocumentProject({
      html,
      filePath: "deck.html"
    });

    expect(project).not.toBeNull();

    const appended = appendProjectPage(project!);
    const moved = moveProjectPage(appended.project, appended.project.pages[2]!.id, "up");
    const removed = removeProjectPage(moved.project, moved.project.pages[0]!.id);
    const savedHtml = writeStaticHtmlDocumentProject({
      html,
      project: removed.project
    });
    const untitledLabel = t("conversation.fileViewerPresentationUntitled");

    expect(savedHtml).toContain(`data-title="${untitledLabel}"`);
    expect(savedHtml).not.toContain('data-title="封面"');

    const untitledIndex = savedHtml?.indexOf(`data-title="${untitledLabel}"`) ?? -1;
    const planIndex = savedHtml?.indexOf('data-title="方案页"') ?? -1;
    expect(untitledIndex).toBeGreaterThanOrEqual(0);
    expect(planIndex).toBeGreaterThanOrEqual(0);
    expect(untitledIndex).toBeLessThan(planIndex);
  });

  it("新增页面会插入到当前页后面，并保持为空白页结构", () => {
    const html = `
      <!doctype html>
      <html>
        <body>
          <div class="deck">
            <section class="slide" data-title="第一页">
              <div class="slide-shell"><h1>第一页标题</h1></div>
            </section>
            <section class="slide" data-title="第二页">
              <div class="slide-shell"><h1>第二页标题</h1></div>
            </section>
          </div>
        </body>
      </html>
    `;

    const project = buildStaticHtmlDocumentProject({
      html,
      filePath: "insert-page.html"
    });

    expect(project).not.toBeNull();
    const inserted = appendProjectPage(project!, {
      insertAfterPageId: project!.pages[0]!.id
    });
    const savedHtml = writeStaticHtmlDocumentProject({
      html,
      project: inserted.project
    });
    const untitledLabel = t("conversation.fileViewerPresentationUntitled");

    expect(inserted.project.pages.map((page) => page.title)).toEqual([
      "第一页",
      untitledLabel,
      "第二页"
    ]);
    expect(savedHtml).toContain(`<h1>${untitledLabel}</h1>`);
    expect(savedHtml).not.toContain("第一页标题</h1></section><section");
  });

  it("复制页面会把整页内容插入到源页面后面，并保持布局内容一致", () => {
    const html = `
      <!doctype html>
      <html>
        <body>
          <div class="deck">
            <section class="slide" data-title="第一页">
              <div class="slide-shell">
                <h1 style="font-size: 48px;">第一页标题</h1>
                <p>第一页说明</p>
              </div>
            </section>
            <section class="slide" data-title="第二页">
              <div class="slide-shell"><h1>第二页标题</h1></div>
            </section>
          </div>
        </body>
      </html>
    `;

    const project = buildStaticHtmlDocumentProject({
      html,
      filePath: "duplicate-page.html"
    });

    expect(project).not.toBeNull();

    const duplicated = duplicateProjectPage(project!, project!.pages[0]!.id);
    const savedHtml = writeStaticHtmlDocumentProject({
      html,
      project: duplicated.project
    });

    expect(duplicated.project.pages.map((page) => page.title)).toEqual([
      "第一页",
      "第一页",
      "第二页"
    ]);
    expect(savedHtml?.match(/第一页标题/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(savedHtml?.match(/第一页说明/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(savedHtml?.indexOf('data-title="第一页"')).toBeLessThan(
      savedHtml?.lastIndexOf('data-title="第一页"') ?? -1
    );
    expect(
      Object.values(duplicated.project.nodes).some((node) => (
        node.id.startsWith("page-3-root")
        && node.runtimeFlags.some((flag) => flag.startsWith("clone-source:") || flag.startsWith("draft-clone"))
      ))
    ).toBe(false);
  });
});
