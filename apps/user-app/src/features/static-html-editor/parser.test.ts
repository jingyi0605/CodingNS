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

  it("逐页预览会注入 base href，保证相对资源按原文件目录解析", () => {
    const html = `
      <!doctype html>
      <html>
        <head></head>
        <body>
          <div class="deck">
            <section class="slide" data-title="第一页">
              <img src="./assets/chart.png" alt="图表" />
            </section>
          </div>
        </body>
      </html>
    `;

    const preview = buildStaticHtmlPresentationPreview({
      html,
      pageIndex: 0,
      baseHref: "http://127.0.0.1:3100/preview/files/token/demo/index.html?_preview=3"
    });

    expect(preview).toContain(
      '<base href="http://127.0.0.1:3100/preview/files/token/demo/index.html?_preview=3">'
    );
    expect(preview).toContain('<img src="./assets/chart.png" alt="图表"');
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

  it("复杂静态 HTML 保存回写时会保留 br、多 span 和原始页面结构", () => {
    const html = readFileSync(
      "/Users/jackson/Code/CodingNS/tmp/20260426-AI模型贴脸对战.html",
      "utf8"
    );

    const project = buildStaticHtmlDocumentProject({
      html,
      filePath: "20260426-AI模型贴脸对战.html"
    });

    expect(project).not.toBeNull();

    const deepSeekNode = Object.values(project?.nodes ?? {}).find((node) =>
      node.type === "text" && node.content.text?.includes("DeepSeek")
    );
    const footerNode = Object.values(project?.nodes ?? {}).find((node) =>
      node.type === "text" && node.content.text?.includes("CodingNS 并行会话")
    );

    expect(deepSeekNode).toBeDefined();
    expect(footerNode).toBeDefined();

    const editedProject = {
      ...project!,
      nodes: {
        ...project!.nodes,
        [deepSeekNode!.id]: {
          ...deepSeekNode!,
          content: {
            ...deepSeekNode!.content,
            text: "DeepSeek-V4 1 硬刚 GPT-5.5、Claude 4.6、KIMI-2.6",
            runs: [
              {
                ...(deepSeekNode!.content.runs?.[0] ?? { text: "DeepSeek-V4" }),
                text: "DeepSeek-V4 1"
              },
              ...(deepSeekNode!.content.runs?.slice(1) ?? [])
            ]
          }
        }
      }
    };

    const savedHtml = writeStaticHtmlDocumentProject({
      html,
      project: editedProject
    });

    expect(savedHtml).toContain("<span class=\"gradient\">DeepSeek-V4 1</span><br");
    expect(savedHtml).toContain("<div class=\"footer\"><span>CodingNS 并行会话</span><span>前端专场 · UP 主主观局</span></div>");
    expect(savedHtml).toContain("<b>3 / 4<br>一次过</b>");
    expect(savedHtml).toContain("<b>Claude<br>4.6</b>");
    expect(savedHtml).not.toContain("style=\"width: 1220px;");
    expect(savedHtml).toContain("class=\"slide active\"");
    expect(savedHtml).toContain("class=\"slide next\"");
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
    expect(preview).toContain("文件 &amp; Git 管理");
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

  it("带页头和内容区的页面不会漏掉 h2 标题文本节点", () => {
    const html = readFileSync(
      "/Users/jackson/Code/头脑风暴/20260511-企业Agent平台建设技术方案PPT-1.html",
      "utf8"
    );

    const project = buildStaticHtmlDocumentProject({
      html,
      filePath: "/Users/jackson/Code/头脑风暴/20260511-企业Agent平台建设技术方案PPT-1.html"
    });

    expect(project).not.toBeNull();

    const targetNode = Object.values(project?.nodes ?? {}).find((node) =>
      node.type === "text" && node.content.text === "鲁抗医药建设背景与项目目标"
    );

    expect(targetNode).toBeDefined();
    expect(targetNode?.editable).toBe(true);
  });

  it("混合 span 和文本节点的容器会按文本组件导入", () => {
    const html = readFileSync(
      "/Users/jackson/Code/CodingNS/tmp/codingns-presentation.html",
      "utf8"
    );

    const project = buildStaticHtmlDocumentProject({
      html,
      filePath: "/Users/jackson/Code/CodingNS/tmp/codingns-presentation.html"
    });

    expect(project).not.toBeNull();

    const targetNode = Object.values(project?.nodes ?? {}).find((node) =>
      node.type === "text" && node.content.text?.includes("把 AI 编程工作流从一台电脑里解放出来")
    );

    expect(targetNode).toBeDefined();
    expect(targetNode?.editable).toBe(true);
    expect(targetNode?.patchStrategy).toBe("text_and_style");
    expect(targetNode?.content.runs?.length).toBeGreaterThanOrEqual(3);
    expect(targetNode?.content.runs?.[0]?.text).toContain("{");
  });

  it("带少量 inline 装饰的文本节点预览回写时会保留 runs 结构", () => {
    const html = `
      <!doctype html>
      <html>
        <body>
          <div class="deck">
            <section class="slide active" data-title="第一页">
              <div class="hero-tagline">
                <span class="hero-bracket">{</span> 核心文案 <span class="hero-bracket">}</span>
              </div>
            </section>
          </div>
        </body>
      </html>
    `;

    const project = buildStaticHtmlDocumentProject({
      html,
      filePath: "rich-runs.html"
    });

    expect(project).not.toBeNull();

    const textNode = Object.values(project?.nodes ?? {}).find((node) =>
      node.type === "text" && node.content.text?.includes("核心文案")
    );

    expect(textNode).toBeDefined();
    expect(textNode?.content.runs).toHaveLength(3);

    const preview = buildStaticHtmlPresentationPreviewFromProject({
      html,
      project: project!,
      pageIndex: 0
    });

    expect(preview).toContain('class="hero-bracket"');
    expect(preview).toContain("核心文案");
  });

  it("inline runs 会保留 run 之间的空格，不会把可见文本和 runs 文本长度搞乱", () => {
    const html = `
      <!doctype html>
      <html>
        <body>
          <div class="deck">
            <section class="slide active" data-title="第一页">
              <div class="fade-up slide-title">CodingNS <span class="gradient-text">=</span> 把工作流带走</div>
            </section>
          </div>
        </body>
      </html>
    `;

    const project = buildStaticHtmlDocumentProject({
      html,
      filePath: "inline-space-runs.html"
    });

    expect(project).not.toBeNull();

    const textNode = Object.values(project?.nodes ?? {}).find((node) =>
      node.type === "text" && node.content.text?.includes("CodingNS = 把工作流带走")
    );

    expect(textNode).toBeDefined();
    expect(textNode?.content.text).toBe("CodingNS = 把工作流带走");
    expect(textNode?.content.runs).toEqual([
      expect.objectContaining({ text: "CodingNS " }),
      expect.objectContaining({ text: "=" }),
      expect.objectContaining({ text: " 把工作流带走" })
    ]);
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
            text: "已修改标题",
            runs: [{ text: "已修改标题" }]
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
    expect(savedHtml).not.toContain("<base ");
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

  it("复杂演示文档编辑后保存，不会把后面页面内容串回到前面的第一页", () => {
    const html = readFileSync(
      "/Users/jackson/Code/CodingNS/tmp/codingns-presentation.html",
      "utf8"
    );

    const project = buildStaticHtmlDocumentProject({
      html,
      filePath: "/Users/jackson/Code/CodingNS/tmp/codingns-presentation.html"
    });

    expect(project).not.toBeNull();

    const targetNode = Object.values(project?.nodes ?? {}).find((node) =>
      node.type === "text" && node.content.text?.includes("文件 & Git 管理")
    );

    expect(targetNode).toBeDefined();

    const nextProject = {
      ...project!,
      nodes: {
        ...project!.nodes,
        [targetNode!.id]: {
          ...targetNode!,
          content: {
            ...targetNode!.content,
            text: "文件 & Git 管理-已修改",
            runs: Array.isArray(targetNode!.content.runs)
              ? targetNode!.content.runs.map((run, index) => (
                  index === 0
                    ? { ...run, text: "文件 & " }
                    : index === 1
                    ? { ...run, text: "Git 管理-已修改" }
                    : run
                ))
              : targetNode!.content.runs
          }
        }
      }
    };

    const savedHtml = writeStaticHtmlDocumentProject({
      html,
      project: nextProject
    });

    expect(savedHtml).toContain('data-title="文件 &amp; Git 管理"');
    expect(savedHtml).toContain("文件 &amp; <span class=\"gradient-text-green\">Git 管理-已修改</span>");
    expect(savedHtml?.match(/<div class="slide active"/g)?.length ?? 0).toBe(1);
    expect(savedHtml?.indexOf('data-title="第 1 页"')).toBeLessThan(
      savedHtml?.indexOf('data-title="文件 &amp; Git 管理"') ?? -1
    );
  });
});
