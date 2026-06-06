import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import "../../../app/styles.css";
import { clientConfigStore } from "../../../config/client-config-store";
import { t } from "../../../shared/i18n";
import { ToastProvider } from "../../../shared/toast";
import type { FilePreviewDto } from "../api/file-context-api";
import { FileViewerModal, FileViewerPanel } from "./FileViewerModal";

const fileApiMock = vi.hoisted(() => ({
  getFilePreview: vi.fn(),
  saveFileContent: vi.fn()
}));
const presentationExportApiMock = vi.hoisted(() => ({
  createPresentationExportTask: vi.fn(),
  downloadPresentationExportTask: vi.fn(),
  getPresentationExportTask: vi.fn()
}));
const downloadAnchorClickMock = vi.hoisted(() => vi.fn());
const clipboardWriteTextMock = vi.hoisted(() => vi.fn());
const platformMock = vi.hoisted(() => ({
  openExternal: vi.fn(),
  writeClipboardText: vi.fn(),
  isDesktop: true,
  isMobile: false
}));
const resizeObserverState = vi.hoisted(() => ({
  callback: null as ResizeObserverCallback | null
}));

function getPresentationRunsEditor(): HTMLDivElement | null {
  return document.querySelector<HTMLDivElement>(".static-html-presentation-runs-editor");
}

function getPresentationRunWrappers(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".static-html-presentation-runs-editor [data-static-html-run-wrapper='true']")
  );
}

function getPresentationRunInputs(): HTMLTextAreaElement[] {
  return Array.from(
    document.querySelectorAll<HTMLTextAreaElement>(".static-html-presentation-runs-editor [data-static-html-run-input='true']")
  );
}

async function replaceSingleRunText(
  user: ReturnType<typeof userEvent.setup>,
  nextText: string,
  runIndex = 0
): Promise<void> {
  const input = getPresentationRunInputs()[runIndex];
  expect(input).toBeTruthy();
  await user.clear(input!);
  await user.type(input!, nextText);
}

vi.mock("../api/file-context-api", () => ({
  getFilePreview: fileApiMock.getFilePreview,
  saveFileContent: fileApiMock.saveFileContent
}));

vi.mock("../../../platform/server/presentation-export-manager", () => ({
  createPresentationExportTask: presentationExportApiMock.createPresentationExportTask,
  downloadPresentationExportTask: presentationExportApiMock.downloadPresentationExportTask,
  getPresentationExportTask: presentationExportApiMock.getPresentationExportTask
}));

vi.mock("../../../platform/platform-provider", () => ({
  usePlatform: () => ({
    isDesktop: platformMock.isDesktop,
    isMobile: platformMock.isMobile,
    bridge: {
      openExternal: platformMock.openExternal,
      writeClipboardText: platformMock.writeClipboardText
    }
  })
}));

describe("FileViewerModal", () => {
  beforeEach(() => {
    platformMock.isDesktop = true;
    platformMock.isMobile = false;
    clientConfigStore.hydrate(createRuntimeConfigSnapshot("http://127.0.0.1:3002"));
    fileApiMock.getFilePreview.mockResolvedValue(createPreviewResponse());
    fileApiMock.saveFileContent.mockReset();
    presentationExportApiMock.createPresentationExportTask.mockReset();
    presentationExportApiMock.downloadPresentationExportTask.mockReset();
    presentationExportApiMock.downloadPresentationExportTask.mockResolvedValue({
      fileName: "export.pdf",
      blob: new Blob(["mock export"], {
        type: "application/octet-stream"
      })
    });
    presentationExportApiMock.getPresentationExportTask.mockReset();
    downloadAnchorClickMock.mockReset();
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:mock-export")
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(downloadAnchorClickMock);
    platformMock.openExternal.mockReset();
    platformMock.openExternal.mockResolvedValue({ ok: true });
    platformMock.writeClipboardText.mockReset();
    platformMock.writeClipboardText.mockResolvedValue({ ok: true });
    clipboardWriteTextMock.mockReset();
    clipboardWriteTextMock.mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock
      }
    });
    resizeObserverState.callback = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeObserverState.callback = callback;
        }

        observe() {
          return undefined;
        }

        disconnect() {
          return undefined;
        }
      }
    );
  });

  afterEach(() => {
    delete window.DocsAPI;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("文件名换行后仍然溢出时，会自动切到更小字号，避免继续挤压操作按钮", async () => {
    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="超长超长超长超长超长超长超长超长超长超长超长超长超长超长超长.pdf"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    const title = await waitFor(() => {
      const element = document.querySelector<HTMLElement>(".file-viewer-title");
      expect(element).not.toBeNull();
      return element!;
    });

    Object.defineProperty(title, "clientHeight", {
      configurable: true,
      value: 28
    });
    Object.defineProperty(title, "scrollHeight", {
      configurable: true,
      value: 56
    });

    await act(async () => {
      resizeObserverState.callback?.([], {} as ResizeObserver);
    });

    expect(title.dataset.scaleTier).toBe("tight");
  });

  it("父组件重复渲染但文件未切换时，不会重新加载并覆盖编辑中的内容", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const firstOnClose = vi.fn();
    const nextOnClose = vi.fn();

    const view = render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="notes.txt"
          open
          onClose={firstOnClose}
          onSaved={onSaved}
        />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(fileApiMock.getFilePreview).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("tab", { name: t("conversation.fileViewerEdit") }));
    const editor = await screen.findByTestId("file-viewer-editor");
    await user.clear(editor);
    await user.type(editor, "hello world");

    view.rerender(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="notes.txt"
          open
          onClose={nextOnClose}
          onSaved={onSaved}
        />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("file-viewer-editor")).toHaveValue("hello world");
    });
    expect(fileApiMock.getFilePreview).toHaveBeenCalledTimes(1);
  });

  it("传入自定义 saveHandler 时，会优先走自定义保存逻辑", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const saveHandler = vi.fn().mockResolvedValue(undefined);

    render(
      <ToastProvider>
        <FileViewerPanel
          workspaceId="workspace-1"
          filePath="notes.txt"
          open
          onClose={vi.fn()}
          onSaved={onSaved}
          saveHandler={saveHandler}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerEdit") }));
    const editor = await screen.findByTestId("file-viewer-editor");
    await user.clear(editor);
    await user.type(editor, "custom saved content");
    await user.click(screen.getByRole("button", { name: t("conversation.filePanelSave") }));

    await waitFor(() => {
      expect(saveHandler).toHaveBeenCalledTimes(1);
    });
    expect(saveHandler).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      filePath: "notes.txt",
      content: "custom saved content",
      expectedVersion: "preview-version-1"
    }));
    expect(fileApiMock.saveFileContent).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith("notes.txt");
    });
  });

  it("有 diff 数据时依然保持代码预览，并显示新增和修改标尺", async () => {
    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "notes.ts",
        content: [
          "const first = 1;",
          "const second = 2;",
          "const third = 3;",
          "const fourth = 4;"
        ].join("\n"),
        version: "v2",
        size: 64
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="notes.ts"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
          diffContent={[
            "diff --git a/notes.ts b/notes.ts",
            "index 1111111..2222222 100644",
            "--- a/notes.ts",
            "+++ b/notes.ts",
            "@@ -1,3 +1,4 @@",
            "-const first = 0;",
            "+const first = 1;",
            " const second = 2;",
            " const third = 3;",
            "+const fourth = 4;"
          ].join("\n")}
        />
      </ToastProvider>
    );

    const dialog = await screen.findByRole("dialog");

    expect(screen.queryByText("diff --git a/notes.ts b/notes.ts")).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent("const");
    expect(dialog.querySelector('[data-testid="file-overview-ruler"]')).not.toBeNull();
    expect(dialog.querySelectorAll('.file-overview-marker[data-kind="modify"]')).toHaveLength(1);
    expect(dialog.querySelectorAll('.file-overview-marker[data-kind="add"]')).toHaveLength(1);

    const codeLines = dialog.querySelectorAll(".file-viewer-code-line");
    expect(codeLines).toHaveLength(4);
    expect(codeLines[0]).toHaveClass("diff-line-modify");
    expect(codeLines[3]).toHaveClass("diff-line-add");
  });

  it.each([
    {
      name: "Markdown",
      path: "docs/guide.md",
      kind: "markdown" as const,
      content: "# 新标题\n\n正文\n\n未变内容",
      testId: null
    },
    {
      name: "HTML",
      path: "site/index.html",
      kind: "html" as const,
      content: "<!doctype html><html><body>new</body></html>",
      testId: "file-viewer-html-preview"
    },
    {
      name: "图片",
      path: "assets/diagram.png",
      kind: "image" as const,
      content: null,
      testId: "file-viewer-image-preview"
    },
    {
      name: "PDF",
      path: "docs/spec.pdf",
      kind: "pdf" as const,
      content: null,
      testId: "file-viewer-pdf-preview"
    }
  ])("$name 预览视图会叠加显示 diff 标尺", async ({ path, kind, content, testId }) => {
    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path,
        kind,
        content,
        version: content === null ? null : "preview-diff-v1",
        previewPath: kind === "markdown" ? null : `/preview/files/preview-token/${path}`,
        previewUrl: kind === "markdown" ? null : `http://127.0.0.1:3002/preview/files/preview-token/${path}`,
        capabilities: {
          canEdit: kind === "markdown",
          canRefresh: true,
          canResize: true,
          canZoom: kind === "image" || kind === "pdf",
          canPaginate: kind === "pdf"
        }
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath={path}
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
          diffContent={[
            `diff --git a/${path} b/${path}`,
            "index 1111111..2222222 100644",
            `--- a/${path}`,
            `+++ b/${path}`,
            "@@ -1,3 +1,5 @@",
            "+# 新标题",
            "+",
            "+正文",
            "+",
            " 未变内容"
          ].join("\n")}
        />
      </ToastProvider>
    );

    if (testId) {
      await screen.findByTestId(testId);
    } else {
      await screen.findByText("新标题");
    }

    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector(".file-viewer-preview-overview-shell")).not.toBeNull();
    expect(dialog.querySelector('[data-testid="file-overview-ruler"]')).not.toBeNull();
    expect(dialog.querySelector(".file-viewer-preview-diff-badge")).toHaveTextContent(
      t("conversation.fileViewerDiffAdded")
    );
    expect(dialog.querySelectorAll('.file-overview-marker[data-kind="add"]')).toHaveLength(1);

    if (kind === "markdown") {
      const markdownPreview = dialog.querySelector(".file-viewer-markdown");
      const previewShell = dialog.querySelector(".file-viewer-preview-overview-shell");

      expect(markdownPreview).not.toBeNull();
      expect(previewShell).not.toBeNull();
      expect(getComputedStyle(markdownPreview as Element).overflowY).toBe("auto");
      expect(getComputedStyle(previewShell as Element).height).toBe("100%");
      expect(dialog.querySelectorAll(".file-viewer-markdown .markdown-diff-block.diff-block-add").length)
        .toBeGreaterThan(0);
    }
  });

  it("配置文件在编辑态显示带行号的高亮编辑区，并跟随输入实时更新", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: ".env.local",
        content: 'NODE_ENV="development"\nPORT=3000\n',
        version: "env-v1"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath=".env.local"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await screen.findByText("NODE_ENV");
    await user.click(screen.getByRole("tab", { name: t("conversation.fileViewerEdit") }));

    const editor = await screen.findByTestId("file-viewer-editor");
    const liveRender = await screen.findByTestId("file-viewer-inline-render");
    expect(document.querySelectorAll(".file-viewer-code-gutter").length).toBeGreaterThan(0);
    expect(liveRender).toHaveTextContent("NODE_ENV");
    expect(liveRender).toHaveTextContent("3000");

    await user.clear(editor);
    await user.type(editor, 'NODE_ENV="production"\nPORT=3100\n');

    await waitFor(() => {
      expect(liveRender).toHaveTextContent("production");
      expect(liveRender).toHaveTextContent("3100");
    });
  });

  it("Markdown 在编辑态也使用带行号的高亮编辑区，并实时更新内容", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "docs/readme.md",
        kind: "markdown",
        content: "# 标题\n\n内容\n",
        version: "md-v1"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="docs/readme.md"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await screen.findByText("标题");
    await user.click(screen.getByRole("tab", { name: t("conversation.fileViewerEdit") }));

    const editor = await screen.findByTestId("file-viewer-editor");
    const liveRender = await screen.findByTestId("file-viewer-inline-render");
    expect(editor).toHaveValue("# 标题\n\n内容\n");
    expect(document.querySelectorAll(".file-viewer-code-gutter").length).toBeGreaterThan(0);
    expect(liveRender).toHaveTextContent("# 标题");
    expect(liveRender).toHaveTextContent("内容");

    await user.clear(editor);
    await user.type(editor, "# 新标题\n\n新内容\n");

    await waitFor(() => {
      expect(liveRender).toHaveTextContent("# 新标题");
      expect(liveRender).toHaveTextContent("新内容");
    });
  });

  it("Markdown 预览里的纯文本块和无语言代码块都提供复制按钮", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "docs/script.md",
        kind: "markdown",
        content: [
          "```text",
          "第一段纯文本",
          "```",
          "",
          "```",
          "第二段无语言代码块",
          "```"
        ].join("\n"),
        version: "md-copy-v1"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="docs/script.md"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await screen.findByText("第一段纯文本");

    const copyButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".file-viewer-markdown-copy-block .file-viewer-copy-button")
    );
    expect(copyButtons).toHaveLength(2);

    await user.click(copyButtons[0]!);
    await user.click(copyButtons[1]!);

    expect(platformMock.writeClipboardText).toHaveBeenNthCalledWith(1, "第一段纯文本");
    expect(platformMock.writeClipboardText).toHaveBeenNthCalledWith(2, "第二段无语言代码块");
    expect(clipboardWriteTextMock).not.toHaveBeenCalled();
  });

  it("代码视图里的文件块头部提供复制图标，可直接复制全文", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "notes.ts",
        content: "const alpha = 1;\nconst beta = 2;\n",
        version: "code-copy-v1"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="notes.ts"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(document.querySelector(".file-viewer-code-header .file-viewer-copy-button")).not.toBeNull();
    });

    const copyButton = document.querySelector<HTMLButtonElement>(".file-viewer-code-header .file-viewer-copy-button");

    await user.click(copyButton!);

    expect(platformMock.writeClipboardText).toHaveBeenCalledWith("const alpha = 1;\nconst beta = 2;\n");
    expect(clipboardWriteTextMock).not.toHaveBeenCalled();
  });

  it("桌面端原生剪贴板桥接失败时，复制按钮会回退到兼容复制路径", async () => {
    const user = userEvent.setup();
    const execCommandMock = vi.fn().mockReturnValue(true);
    platformMock.writeClipboardText.mockResolvedValue({
      ok: false,
      detail: "clipboard unavailable"
    });
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: undefined
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommandMock
    });

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "docs/script.md",
        kind: "markdown",
        content: ["```text", "macOS fallback copy", "```"].join("\n"),
        version: "md-copy-fallback-v1"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="docs/script.md"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await screen.findByText("macOS fallback copy");

    const copyButton = document.querySelector<HTMLButtonElement>(
      ".file-viewer-markdown-copy-block .file-viewer-copy-button"
    );
    expect(copyButton).not.toBeNull();

    await user.click(copyButton!);

    await waitFor(() => {
      expect(platformMock.writeClipboardText).toHaveBeenCalledWith("macOS fallback copy");
      expect(execCommandMock).toHaveBeenCalledWith("copy");
    });
  });

  it("移动端文件预览默认全屏，并只保留视图、刷新和保存操作", async () => {
    platformMock.isDesktop = false;
    platformMock.isMobile = true;

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "site/index.html",
        kind: "html",
        content: "<!doctype html><html><body>preview</body></html>",
        version: "html-v1",
        previewPath: "/preview/files/preview-token/site/index.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/site/index.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="site/index.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    const dialog = await screen.findByRole("dialog");

    expect(dialog).toHaveAttribute("data-size", "full");
    expect(screen.getByRole("tab", { name: t("conversation.fileViewerPreview") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("conversation.fileViewerRefreshPreview") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("conversation.filePanelSave") })).not.toBeInTheDocument();
    expect(screen.queryByText(/当前以 .* 模式打开/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("conversation.fileViewerSizeDefault") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("conversation.fileViewerSizeFull") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("conversation.fileViewerOpenExternal") })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: t("conversation.fileViewerEdit") }));
    expect(screen.getByRole("button", { name: t("conversation.filePanelSave") })).toBeInTheDocument();
  });

  it("HTML 文件默认铺满视图，且支持刷新预览与外部打开", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "site/index.html",
        kind: "html",
        content: "<!doctype html><html><body>preview</body></html>",
        version: "html-v1",
        previewPath: "/preview/files/preview-token/site/index.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/site/index.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="site/index.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    const dialog = await screen.findByRole("dialog");
    const previewFrame = await screen.findByTestId("file-viewer-html-preview");
    expect(previewFrame).toHaveAttribute(
      "src",
      expect.stringContaining("/preview/files/preview-token/site/index.html?_preview=0")
    );
    expect(previewFrame).toHaveAttribute(
      "sandbox",
      "allow-forms allow-modals allow-scripts allow-same-origin"
    );
    expect(dialog).toHaveAttribute("data-size", "full");
    expect(screen.queryByRole("tab", { name: t("conversation.fileViewerCode") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("conversation.fileViewerSizeDefault") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("conversation.fileViewerSizeFull") })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerRefreshPreview") }));

    await waitFor(() => {
      expect(fileApiMock.getFilePreview).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId("file-viewer-html-preview")).toHaveAttribute(
        "src",
        expect.stringContaining("_preview=1")
      );
    });

    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerOpenExternal") }));

    expect(platformMock.openExternal).toHaveBeenCalledWith(
      "http://127.0.0.1:3002/preview/files/preview-token/site/index.html"
    );
  });

  it("Office 文件预览模态框默认铺满，并隐藏默认模式按钮", async () => {
    const destroyEditor = vi.fn();
    const docEditor = vi.fn(() => ({
      destroyEditor
    }));
    window.DocsAPI = {
      DocEditor: docEditor
    };

    const script = document.createElement("script");
    script.dataset.onlyofficeSrc = "http://127.0.0.1:8088/web-apps/apps/api/documents/api.js";
    script.dataset.loaded = "true";
    document.head.appendChild(script);

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "docs/layout.docx",
        kind: "office",
        content: null,
        version: "doc-layout-v1",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/docs/layout.docx",
        onlyOffice: {
          apiScriptUrl: "http://127.0.0.1:8088/web-apps/apps/api/documents/api.js",
          editorMode: "edit",
          documentUrl: "http://127.0.0.1:3002/preview/files/preview-token/docs/layout.docx",
          callbackUrl: "http://127.0.0.1:3002/api/office/onlyoffice/callback/mock-token",
          editorConfig: {
            documentType: "word",
            type: "desktop",
            document: {
              fileType: "docx",
              key: "doc-layout-v1",
              title: "layout.docx",
              url: "http://127.0.0.1:3002/preview/files/preview-token/docs/layout.docx"
            },
            editorConfig: {
              callbackUrl: "http://127.0.0.1:3002/api/office/onlyoffice/callback/mock-token",
              mode: "edit"
            }
          }
        },
        capabilities: {
          canEdit: false,
          canRefresh: true,
          canResize: true,
          canZoom: false,
          canPaginate: false
        }
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="docs/layout.docx"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    const dialog = await screen.findByRole("dialog", { name: "docs/layout.docx" });

    expect(await screen.findByTestId("file-viewer-office-preview")).toBeInTheDocument();
    expect(dialog).toHaveAttribute("data-size", "full");
    expect(screen.queryByRole("button", { name: t("conversation.fileViewerSizeDefault") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("conversation.fileViewerSizeFull") })).not.toBeInTheDocument();
  });

  it("Tools 目录下的 HTML 工具页即使含有 slide 结构，也只走普通预览链路", async () => {
    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "Tools/会员管理.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <head>
              <style>:root { --deck-width: 1600px; --deck-height: 900px; }</style>
            </head>
            <body>
              <div class="deck">
                <section class="slide" data-title="会员管理">
                  <div class="slide-shell">
                    <h1>会员管理</h1>
                    <p>这里是工具页，不是演示文档。</p>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "tool-html-v1",
        previewPath: "/preview/files/preview-token/Tools/%E4%BC%9A%E5%91%98%E7%AE%A1%E7%90%86.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/Tools/%E4%BC%9A%E5%91%98%E7%AE%A1%E7%90%86.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="Tools/会员管理.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    const previewFrame = await screen.findByTestId("file-viewer-html-preview");
    expect(previewFrame).toHaveAttribute(
      "src",
      expect.stringContaining("/preview/files/preview-token/Tools/%E4%BC%9A%E5%91%98%E7%AE%A1%E7%90%86.html?_preview=0")
    );
    expect(screen.queryByRole("tab", { name: t("conversation.fileViewerPresentation") })).not.toBeInTheDocument();
    expect(screen.queryByTestId("static-html-presentation-view")).not.toBeInTheDocument();
  });

  it("HTML 编辑视图会显示带行号的代码高亮编辑区，并实时更新高亮内容", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "site/index.html",
        kind: "html",
        content: "<!doctype html>\n<html><body><h1>old</h1></body></html>",
        version: "html-edit-v1",
        previewPath: "/preview/files/preview-token/site/index.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/site/index.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="site/index.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await screen.findByTestId("file-viewer-html-preview");
    await user.click(screen.getByRole("tab", { name: t("conversation.fileViewerEdit") }));

    expect(screen.getByRole("button", { name: t("conversation.filePanelSave") })).toBeInTheDocument();
    expect(screen.getByTestId("file-viewer-inline-render")).toBeInTheDocument();
    expect(document.querySelectorAll(".file-viewer-code-gutter").length).toBeGreaterThan(0);
    expect(screen.getByTestId("file-viewer-inline-render")).toHaveTextContent("old");

    const editor = await screen.findByTestId("file-viewer-editor");
    await user.clear(editor);
    await user.type(editor, "<!doctype html>\n<html><body><h1>new</h1></body></html>");

    await waitFor(() => {
      expect(screen.getByTestId("file-viewer-inline-render")).toHaveTextContent("new");
    });
  });

  it("静态 HTML PPT 会显示演示文档标签，并支持逐页切换", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/demo.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <head>
              <style>:root { --deck-width: 1600px; --deck-height: 900px; }</style>
            </head>
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
        `,
        version: "ppt-v1",
        previewPath: "/preview/files/preview-token/slides/demo.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/demo.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/demo.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") });
    await user.click(screen.getByRole("tab", { name: t("conversation.fileViewerPresentation") }));

    const presentationView = await screen.findByTestId("static-html-presentation-view");
    expect(presentationView).toBeInTheDocument();
    const pageList = document.querySelector(".static-html-presentation-page-list");
    expect(pageList).not.toBeNull();
    const pageButtons = Array.from(pageList?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    expect(pageButtons.some((button) => button.textContent?.includes("封面"))).toBe(true);
    expect(pageButtons.some((button) => button.textContent?.includes("方案页"))).toBe(true);

    const solutionPageButton = pageButtons.find((button) => button.textContent?.includes("方案页"));
    expect(solutionPageButton).toBeDefined();
    await user.click(solutionPageButton!);

    expect(screen.getByTestId("static-html-presentation-frame")).toBeInTheDocument();
    expect(screen.getByTestId("static-html-presentation-frame")).toHaveAttribute(
      "title",
      "方案页"
    );
  });

  it("显式带 presentation 标记的 HTML 即使不在 slides 目录，也会显示演示文档模式", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "tmp/opt-in-presentation.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <head>
              <meta name="codingns-preview-mode" content="presentation" />
            </head>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell"><h1>显式开启演示模式</h1></div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "opt-in-presentation-v1",
        previewPath: "/preview/files/preview-token/tmp/opt-in-presentation.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/tmp/opt-in-presentation.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="tmp/opt-in-presentation.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    const presentationTab = await screen.findByRole("tab", {
      name: t("conversation.fileViewerPresentation")
    });
    expect(presentationTab).toBeInTheDocument();

    await user.click(presentationTab);
    expect(await screen.findByTestId("static-html-presentation-view")).toBeInTheDocument();
  });

  it("演示文档视图支持通过顶部文字工具栏修改文本与样式", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/editable.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <head>
              <style>:root { --deck-width: 1600px; --deck-height: 900px; }</style>
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
        `,
        version: "ppt-edit-v1",
        previewPath: "/preview/files/preview-token/slides/editable.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/editable.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/editable.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));

    const nodeChip = await screen.findByRole("button", { name: /原始标题/ });
    await user.click(nodeChip);

    const runsEditor = getPresentationRunsEditor();
    expect(runsEditor).not.toBeNull();
    await replaceSingleRunText(user, "改过的标题");

    const selects = document.querySelectorAll<HTMLSelectElement>(".static-html-presentation-text-toolbar-select");
    expect(selects.length).toBeGreaterThanOrEqual(3);
    fireEvent.change(selects[1]!, { target: { value: "48" } });
    fireEvent.change(selects[2]!, { target: { value: "1.8" } });

    const toolbarButtons = screen.getAllByRole("button");
    const boldButton = toolbarButtons.find((button) => button.getAttribute("aria-label") === t("conversation.fileViewerPresentationBoldAction"));
    const italicButton = toolbarButtons.find((button) => button.getAttribute("aria-label") === t("conversation.fileViewerPresentationItalicAction"));
    const underlineButton = toolbarButtons.find((button) => button.getAttribute("aria-label") === t("conversation.fileViewerPresentationUnderlineAction"));
    expect(boldButton).toBeDefined();
    expect(italicButton).toBeDefined();
    expect(underlineButton).toBeDefined();
    await user.click(boldButton!);
    await user.click(italicButton!);
    await user.click(underlineButton!);

    const colorInputs = document.querySelectorAll<HTMLInputElement>('.static-html-presentation-text-toolbar-color input[type="color"]');
    expect(colorInputs.length).toBe(2);
    fireEvent.change(colorInputs[0]!, { target: { value: "#ff0000" } });
    fireEvent.change(colorInputs[1]!, { target: { value: "#0000ff" } });

    const frame = screen.getByTestId("static-html-presentation-frame");
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("改过的标题"));
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("font-size: 48px"));
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("font-weight: 700"));
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("font-style: italic"));
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("text-decoration: underline"));
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("color: #ff0000"));
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("background-color: #0000ff"));
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("line-height: 1.8"));
  });

  it("演示文稿编辑工具栏在默认亮色主题下会跟随主题变量显示", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/editable.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <head>
              <style>
                :root { --deck-width: 1600px; --deck-height: 900px; }
                body { color: rgb(26, 26, 26); }
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
        `,
        version: "presentation-v1",
        previewPath: "/preview/files/preview-token/slides/editable.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/editable.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/editable.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));
    const nodeChip = await screen.findByRole("button", { name: /原始标题/ });
    await user.click(nodeChip);

    const toolbar = document.querySelector(".static-html-presentation-toolbar");
    const select = document.querySelector<HTMLSelectElement>(".static-html-presentation-text-toolbar-select");
    const button = document.querySelector<HTMLButtonElement>(".static-html-presentation-text-toolbar-button");

    expect(toolbar).not.toBeNull();
    expect(select).not.toBeNull();
    expect(button).not.toBeNull();

    expect(getComputedStyle(toolbar as Element).color).toBe("rgb(26, 26, 26)");
    expect(getComputedStyle(select as Element).color).toBe("rgb(26, 26, 26)");
    expect(getComputedStyle(button as Element).color).toBe("rgb(26, 26, 26)");
  });

  it("演示文档视图点击画布里的 HTML 组件时，不会联动顶部编辑区", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/canvas-pick.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <head>
              <style>:root { --deck-width: 1600px; --deck-height: 900px; }</style>
            </head>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell">
                    <div class="hero-card">
                      <h1 style="font-size: 32px; color: #111111;">画布标题</h1>
                    </div>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-canvas-v1",
        previewPath: "/preview/files/preview-token/slides/canvas-pick.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/canvas-pick.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/canvas-pick.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "codingns-static-html-node-select",
        nodeId: "page-1-root-node-0-0-node-0-0-0"
      }
    }));

    await waitFor(() => {
      expect(getPresentationRunsEditor()).toBeNull();
    });
  });

  it("演示文档视图支持点击画布里的按钮组件进入编辑区", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/button-pick.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell">
                    <button>立即开始</button>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-button-v1",
        previewPath: "/preview/files/preview-token/slides/button-pick.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/button-pick.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/button-pick.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "codingns-static-html-node-select",
        nodeId: "page-1-root-node-0-0"
      }
    }));

    await waitFor(() => {
      expect(getPresentationRunsEditor()?.textContent)
        .toBe("立即开始");
    });
  });

  it("演示文档视图顶部编辑器会按 runs 显示并保留 inline 装饰结构", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/runs-editor.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell">
                    <div class="hero-tagline">
                      <span class="hero-bracket">{</span> 核心文案 <span class="hero-bracket">}</span>
                    </div>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-runs-v1",
        previewPath: "/preview/files/preview-token/slides/runs-editor.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/runs-editor.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/runs-editor.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));
    await user.click(await screen.findByRole("button", { name: /核心文案/ }));

    const runsEditor = getPresentationRunsEditor();
    expect(runsEditor).not.toBeNull();
    expect(runsEditor?.textContent).toContain("核心文案");
    expect(runsEditor?.querySelectorAll(".hero-bracket")).toHaveLength(2);

    const runWrappers = Array.from(
      runsEditor!.querySelectorAll<HTMLElement>("[data-static-html-run-wrapper='true']")
    );
    const middleRun = runWrappers.find((node) => node.textContent?.includes("核心文案"));
    expect(middleRun).toBeTruthy();
    const middleRunIndex = runWrappers.findIndex((node) => node === middleRun);
    const middleInput = getPresentationRunInputs()[middleRunIndex];
    expect(middleInput).toBeTruthy();
    await user.clear(middleInput!);
    await user.type(middleInput!, " 新文案 ");

    const frame = screen.getByTestId("static-html-presentation-frame");
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining('class="hero-bracket"'));
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("新文案"));
  });

  it("演示文档视图顶部 runs 编辑器会把尾部文本限制在当前 run 内编辑", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/runs-append.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell">
                    <div class="fade-up slide-title">CodingNS <span class="gradient-text">=</span> 把工作流带走</div>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-runs-append-v1",
        previewPath: "/preview/files/preview-token/slides/runs-append.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/runs-append.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/runs-append.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));
    await user.click(await screen.findByRole("button", { name: /CodingNS/ }));

    const runsEditor = getPresentationRunsEditor();
    expect(runsEditor).not.toBeNull();
    const runWrappers = getPresentationRunWrappers();
    const lastRun = runWrappers[runWrappers.length - 1];
    expect(lastRun).toBeTruthy();
    expect(runWrappers.map((node) => node.textContent)).toEqual([
      "CodingNS ",
      "=",
      " 把工作流带走"
    ]);
    const lastInput = getPresentationRunInputs()[runWrappers.length - 1];
    expect(lastInput).toBeTruthy();
    await user.type(lastInput!, "1");

    const frame = screen.getByTestId("static-html-presentation-frame");
    const srcdoc = frame.getAttribute("srcdoc") ?? "";

    expect(srcdoc).toContain("CodingNS");
    expect(srcdoc).toContain("把工作流带走1");
    expect(srcdoc).toContain('class="gradient-text"');
    expect((srcdoc.match(/CodingNS/g) ?? []).length).toBe(1);
    expect((srcdoc.match(/把工作流带走1/g) ?? []).length).toBe(1);
  });

  it("演示文档视图顶部 runs 编辑器会把富文本拆成独立片段分别编辑", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/runs-switch-isolation.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell">
                    <div class="fade-up slide-title">CodingNS <span class="gradient-text">=</span> 把工作流带走</div>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-runs-switch-v1",
        previewPath: "/preview/files/preview-token/slides/runs-switch-isolation.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/runs-switch-isolation.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/runs-switch-isolation.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));
    await user.click(await screen.findByRole("button", { name: /CodingNS/ }));

    const runsEditor = getPresentationRunsEditor();
    expect(runsEditor).not.toBeNull();
    const runWrappers = Array.from(
      runsEditor!.querySelectorAll<HTMLElement>("[data-static-html-run-wrapper='true']")
    );
    expect(runWrappers).toHaveLength(3);

    const runInputs = getPresentationRunInputs();
    expect(runInputs).toHaveLength(3);
    await user.type(runInputs[0]!, "1");
    await user.type(runInputs[2]!, "2");

    const frame = screen.getByTestId("static-html-presentation-frame");
    const srcdoc = frame.getAttribute("srcdoc") ?? "";

    expect(srcdoc).toContain("CodingNS 1");
    expect(srcdoc).toContain("把工作流带走2");
    expect(srcdoc).toContain('class="gradient-text"');
    expect((srcdoc.match(/CodingNS 1/g) ?? []).length).toBe(1);
    expect((srcdoc.match(/把工作流带走2/g) ?? []).length).toBe(1);
    expect(srcdoc).toContain('<span class="gradient-text">=</span>');
  });

  it("演示文档视图顶部 runs 编辑器会把首段文本限制在当前 run 内编辑", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/runs-merged-wrapper.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell">
                    <div class="fade-up slide-title">CodingNS <span class="gradient-text">=</span> 把工作流带走</div>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-runs-merged-v1",
        previewPath: "/preview/files/preview-token/slides/runs-merged-wrapper.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/runs-merged-wrapper.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/runs-merged-wrapper.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));
    await user.click(await screen.findByRole("button", { name: /CodingNS/ }));

    const runsEditor = getPresentationRunsEditor();
    expect(runsEditor).not.toBeNull();
    const runWrappers = getPresentationRunWrappers();
    expect(runWrappers).toHaveLength(3);
    const runInputs = getPresentationRunInputs();
    expect(runInputs).toHaveLength(3);
    await user.type(runInputs[0]!, "12");

    const frame = screen.getByTestId("static-html-presentation-frame");
    const srcdoc = frame.getAttribute("srcdoc") ?? "";

    expect(srcdoc).toContain("CodingNS 12");
    expect(srcdoc).toContain("把工作流带走");
    expect(srcdoc).toContain('class="gradient-text"');
    expect((srcdoc.match(/CodingNS 12/g) ?? []).length).toBe(1);
    expect((srcdoc.match(/把工作流带走/g) ?? []).length).toBe(1);
  });

  it("演示文档视图顶部 runs 编辑器会按当前光标位置插入文本，而不是整块重算", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/runs-caret-insert.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell">
                    <div class="fade-up slide-title">CodingNS <span class="gradient-text">=</span> 把工作流带走</div>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-runs-caret-insert-v1",
        previewPath: "/preview/files/preview-token/slides/runs-caret-insert.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/runs-caret-insert.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/runs-caret-insert.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));
    await user.click(await screen.findByRole("button", { name: /CodingNS/ }));

    const runsEditor = getPresentationRunsEditor();
    expect(runsEditor).not.toBeNull();

    const runWrappers = Array.from(
      runsEditor!.querySelectorAll<HTMLElement>("[data-static-html-run-wrapper='true']")
    );
    expect(runWrappers[runWrappers.length - 1]).toBeTruthy();
    const lastInput = getPresentationRunInputs()[runWrappers.length - 1];
    expect(lastInput).toBeTruthy();
    await user.type(lastInput!, "1");

    const frame = screen.getByTestId("static-html-presentation-frame");
    const srcdoc = frame.getAttribute("srcdoc") ?? "";

    expect(srcdoc).toContain("把工作流带走1");
    expect(srcdoc).toContain('class="gradient-text"');
    expect((srcdoc.match(/CodingNS/g) ?? []).length).toBe(1);
  });

  it("演示文档视图顶部 runs 编辑器会按当前光标位置退格删除，而不是整段回推", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/runs-caret-delete.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell">
                    <div class="fade-up slide-title">CodingNS <span class="gradient-text">=</span> 把工作流带走</div>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-runs-caret-delete-v1",
        previewPath: "/preview/files/preview-token/slides/runs-caret-delete.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/runs-caret-delete.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/runs-caret-delete.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));
    await user.click(await screen.findByRole("button", { name: /CodingNS/ }));

    const runsEditor = getPresentationRunsEditor();
    expect(runsEditor).not.toBeNull();

    const runWrappers = Array.from(
      runsEditor!.querySelectorAll<HTMLElement>("[data-static-html-run-wrapper='true']")
    );
    expect(runWrappers[runWrappers.length - 1]).toBeTruthy();
    const lastInput = getPresentationRunInputs()[runWrappers.length - 1];
    expect(lastInput).toBeTruthy();
    await user.type(lastInput!, "{backspace}");

    const frame = screen.getByTestId("static-html-presentation-frame");
    const srcdoc = frame.getAttribute("srcdoc") ?? "";

    expect(srcdoc).toContain("把工作流带");
    expect(srcdoc).not.toContain("把工作流带走</div>");
    expect(srcdoc).toContain('class="gradient-text"');
    expect((srcdoc.match(/CodingNS/g) ?? []).length).toBe(1);
  });

  it("演示文档视图支持双击文本组件后直接原位编辑", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/inline-edit.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell">
                    <h1>原位标题</h1>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-inline-v1",
        previewPath: "/preview/files/preview-token/slides/inline-edit.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/inline-edit.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/inline-edit.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "codingns-static-html-node-select",
        nodeId: "page-1-root-node-0-0",
        eventType: "dblclick",
        rect: {
          left: 48,
          top: 72,
          width: 240,
          height: 64
        },
        appearance: {
          fontFamily: "\"PingFang SC\", sans-serif",
          fontSize: "42px",
          fontWeight: "600",
          lineHeight: "1.3",
          color: "rgb(255, 255, 255)",
          textAlign: "left",
          whiteSpace: "normal",
          padding: "0px"
        }
      }
    }));

    const inlineEditor = await screen.findByTestId("static-html-presentation-inline-editor");
    expect(inlineEditor).toHaveTextContent("原位标题");
    await waitFor(() => {
      expect(inlineEditor).toHaveFocus();
    });
    expect(inlineEditor).toHaveStyle({
      fontSize: "42px",
      fontWeight: "600",
      color: "rgb(255, 255, 255)",
      lineHeight: "1.3"
    });

    inlineEditor.textContent = "画布内改字";
    fireEvent.input(inlineEditor);

    await waitFor(() => {
      expect(screen.getByTestId("static-html-presentation-frame")).toHaveAttribute(
        "srcdoc",
        expect.stringContaining("画布内改字")
      );
    });
  });

  it("演示文档视图双击带底板的文本组件时，原位编辑区只覆盖文字内容区域", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/inline-card-edit.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell">
                    <div style="padding: 24px; background: #ffffff; border-radius: 18px;">
                      白底卡片里的文字
                    </div>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-inline-card-v1",
        previewPath: "/preview/files/preview-token/slides/inline-card-edit.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/inline-card-edit.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/inline-card-edit.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "codingns-static-html-node-select",
        nodeId: "page-1-root-node-0-0",
        eventType: "dblclick",
        rect: {
          left: 48,
          top: 72,
          width: 300,
          height: 120
        },
        appearance: {
          fontSize: "28px",
          color: "rgb(34, 34, 34)",
          padding: "0px",
          whiteSpace: "normal"
        }
      }
    }));

    const inlineEditor = await screen.findByTestId("static-html-presentation-inline-editor");
    expect(inlineEditor).toHaveStyle({
      background: "transparent",
      padding: "0px"
    });
  });

  it("演示文档视图保存时会把草稿项目回写成 HTML 再提交", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/save-presentation.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <head>
              <style>:root { --deck-width: 1600px; --deck-height: 900px; }</style>
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
        `,
        version: "ppt-save-v1",
        previewPath: "/preview/files/preview-token/slides/save-presentation.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/save-presentation.html"
      })
    );
    fileApiMock.saveFileContent.mockResolvedValue({
      version: "ppt-save-v2",
      updatedAt: "2026-05-15T10:50:00.000Z"
    });

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/save-presentation.html"
          open
          onClose={vi.fn()}
          onSaved={onSaved}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));
    await user.click(await screen.findByRole("button", { name: /原始标题/ }));

    const runsEditor = getPresentationRunsEditor();
    expect(runsEditor).not.toBeNull();
    await replaceSingleRunText(user, "保存后的标题");

    const saveButton = screen.getByRole("button", { name: t("conversation.filePanelSave") });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    await waitFor(() => {
      expect(fileApiMock.saveFileContent).toHaveBeenCalledTimes(1);
    });

    const saveArgs = fileApiMock.saveFileContent.mock.calls[0];
    expect(saveArgs?.[0]).toBe("workspace-1");
    expect(saveArgs?.[1]).toBe("slides/save-presentation.html");
    expect(saveArgs?.[2]).toContain("保存后的标题");
    expect(saveArgs?.[2]).toContain("data-title=\"封面\"");
    expect(saveArgs?.[2]).toContain(">保存后的标题<");
    expect(saveArgs?.[3]).toBe("ppt-save-v1");
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith("slides/save-presentation.html");
    });
  });

  it("演示文档视图支持新增、删除并调整页面顺序后再保存", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/manage-pages.html",
        kind: "html",
        content: `
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
        `,
        version: "ppt-pages-v1",
        previewPath: "/preview/files/preview-token/slides/manage-pages.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/manage-pages.html"
      })
    );
    fileApiMock.saveFileContent.mockResolvedValue({
      version: "ppt-pages-v2",
      updatedAt: "2026-05-15T11:00:00.000Z"
    });

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/manage-pages.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));

    await user.click(screen.getByRole("button", { name: /方案页/ }));
    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerPresentationAddPage") }));

    const pageItems = Array.from(document.querySelectorAll<HTMLElement>(".static-html-presentation-page-item"));
    expect(pageItems).toHaveLength(3);
    const transferStore = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "move",
      dropEffect: "move",
      setData: (type: string, value: string) => {
        transferStore.set(type, value);
      },
      getData: (type: string) => transferStore.get(type) ?? ""
    };

    fireEvent.dragStart(pageItems[2]!, { dataTransfer });
    fireEvent.dragOver(pageItems[0]!, { dataTransfer, clientY: 1 });
    expect(pageItems[0]).toHaveAttribute("data-drop-target", "true");
    expect(document.querySelector('[data-position="before"]')).not.toBeNull();
    fireEvent.drop(pageItems[0]!, { dataTransfer });
    fireEvent.dragEnd(pageItems[2]!, { dataTransfer });

    const deleteButtons = screen.getAllByRole("button", {
      name: t("conversation.fileViewerPresentationDeletePage")
    });
    await user.click(deleteButtons[1]!);

    await user.click(screen.getByRole("button", { name: t("conversation.filePanelSave") }));

    await waitFor(() => {
      expect(fileApiMock.saveFileContent).toHaveBeenCalledTimes(1);
    });

    const saveArgs = fileApiMock.saveFileContent.mock.calls[0];
    const untitledLabel = t("conversation.fileViewerPresentationUntitled");
    expect(saveArgs?.[2]).toContain(`data-title="${untitledLabel}"`);
    expect(saveArgs?.[2]).not.toContain('data-title="封面"');
    expect(saveArgs?.[2].indexOf(`data-title="${untitledLabel}"`)).toBeLessThan(
      saveArgs?.[2].indexOf('data-title="方案页"')
    );
  });

  it("演示文档视图支持从左侧页面列表复制整页，并插入到下一页", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/duplicate-page.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <body>
              <div class="deck">
                <section class="slide" data-title="第一页">
                  <div class="slide-shell">
                    <h1>第一页标题</h1>
                    <p>第一页说明</p>
                  </div>
                </section>
                <section class="slide" data-title="第二页">
                  <div class="slide-shell"><h1>第二页标题</h1></div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-duplicate-page-v1",
        previewPath: "/preview/files/preview-token/slides/duplicate-page.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/duplicate-page.html"
      })
    );
    fileApiMock.saveFileContent.mockResolvedValue({
      version: "ppt-duplicate-page-v2",
      updatedAt: "2026-05-15T12:00:00.000Z"
    });

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/duplicate-page.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));

    const duplicateButtons = screen.getAllByRole("button", {
      name: t("conversation.fileViewerPresentationDuplicatePage")
    });
    await user.click(duplicateButtons[0]!);

    const pageTitles = Array.from(document.querySelectorAll(".static-html-presentation-page-title"))
      .map((node) => node.textContent?.trim());
    expect(pageTitles).toEqual(["第一页", "第一页", "第二页"]);

    await user.click(screen.getByRole("button", { name: t("conversation.filePanelSave") }));

    await waitFor(() => {
      expect(fileApiMock.saveFileContent).toHaveBeenCalledTimes(1);
    });

    const saveArgs = fileApiMock.saveFileContent.mock.calls[0];
    expect(saveArgs?.[2].match(/第一页标题/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(saveArgs?.[2].match(/第一页说明/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("演示文档视图支持撤销最近一次编辑，最多回退最近操作", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/undo.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell">
                    <h1>原始标题</h1>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-undo-v1",
        previewPath: "/preview/files/preview-token/slides/undo.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/undo.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/undo.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));
    await user.click(await screen.findByRole("button", { name: /原始标题/ }));

    const runsEditor = getPresentationRunsEditor();
    expect(runsEditor).not.toBeNull();
    await replaceSingleRunText(user, "第一次修改");

    expect(screen.getByTestId("static-html-presentation-frame")).toHaveAttribute(
      "srcdoc",
      expect.stringContaining("第一次修改")
    );
  });

  it("演示文档视图支持进入布局编辑并对多个组件做左右对齐", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/layout-align.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell">
                    <div style="position: absolute; left: 40px; top: 60px; width: 160px; height: 60px;">卡片一</div>
                    <div style="position: absolute; left: 220px; top: 180px; width: 120px; height: 56px;">卡片二</div>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-layout-align-v1",
        previewPath: "/preview/files/preview-token/slides/layout-align.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/layout-align.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/layout-align.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));
    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerPresentationLayoutMode") }));

    const nodeButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".static-html-presentation-node-chip")
    );
    const firstNodeButton = nodeButtons.find((button) => button.textContent?.includes("卡片一"));
    const secondNodeButton = nodeButtons.find((button) => button.textContent?.includes("卡片二"));

    expect(firstNodeButton).toBeTruthy();
    expect(secondNodeButton).toBeTruthy();

    await user.click(firstNodeButton!);
    fireEvent.click(secondNodeButton!, { metaKey: true });

    const alignLeftButton = screen.getByRole("button", { name: t("conversation.fileViewerPresentationLayoutAlignLeft") });
    expect(alignLeftButton).toBeEnabled();
    await user.click(alignLeftButton);

    const positionInputs = Array.from(document.querySelectorAll<HTMLInputElement>(".static-html-presentation-layout-field input"));
    expect(positionInputs[0]?.value).toBe("40");
    expect(screen.getByText("已选中 2 个组件")).toBeInTheDocument();
  });

  it("演示文档视图保存布局编辑结果时，会把几何信息写回 HTML", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/layout-save.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell">
                    <div style="position: absolute; left: 40px; top: 60px; width: 160px; height: 60px;">布局组件</div>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-layout-save-v1",
        previewPath: "/preview/files/preview-token/slides/layout-save.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/layout-save.html"
      })
    );
    fileApiMock.saveFileContent.mockResolvedValue({
      version: "ppt-layout-save-v2",
      updatedAt: "2026-05-16T10:50:00.000Z"
    });

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/layout-save.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));
    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerPresentationLayoutMode") }));

    const nodeButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".static-html-presentation-node-chip")
    );
    const targetNodeButton = nodeButtons.find((button) => button.textContent?.includes("布局组件"));
    expect(targetNodeButton).toBeTruthy();
    await user.click(targetNodeButton!);

    const positionInputs = Array.from(document.querySelectorAll<HTMLInputElement>(".static-html-presentation-layout-field input"));
    expect(positionInputs).toHaveLength(4);
    await user.clear(positionInputs[0]!);
    await user.type(positionInputs[0]!, "180");
    await user.clear(positionInputs[1]!);
    await user.type(positionInputs[1]!, "220");
    await user.clear(positionInputs[2]!);
    await user.type(positionInputs[2]!, "260");
    await user.clear(positionInputs[3]!);
    await user.type(positionInputs[3]!, "110");

    await user.click(screen.getByRole("button", { name: t("conversation.filePanelSave") }));

    await waitFor(() => {
      expect(fileApiMock.saveFileContent).toHaveBeenCalledTimes(1);
    });

    const saveArgs = fileApiMock.saveFileContent.mock.calls[0];
    expect(saveArgs?.[2]).toContain("left: 180px");
    expect(saveArgs?.[2]).toContain("top: 220px");
    expect(saveArgs?.[2]).toContain("width: 260px");
    expect(saveArgs?.[2]).toContain("height: 110px");
  });

  it("演示文档视图在布局模式下单击选中组件时，不会误写入跳变后的几何位置", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/layout-click-stable.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell" style="position: relative; left: 120px; top: 80px; width: 800px; height: 400px;">
                    <div style="position: absolute; left: 40px; top: 60px; width: 160px; height: 60px;">布局组件</div>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-layout-click-stable-v1",
        previewPath: "/preview/files/preview-token/slides/layout-click-stable.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/layout-click-stable.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/layout-click-stable.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));
    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerPresentationLayoutMode") }));

    const nodeButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".static-html-presentation-node-chip")
    );
    const targetNodeButton = nodeButtons.find((button) => button.textContent?.includes("布局组件"));
    expect(targetNodeButton).toBeTruthy();

    await user.click(targetNodeButton!);

    const positionInputs = Array.from(document.querySelectorAll<HTMLInputElement>(".static-html-presentation-layout-field input"));
    expect(positionInputs[0]?.value).toBe("40");
    expect(positionInputs[1]?.value).toBe("60");
  });

  it("演示文档视图会锁定流式布局节点，并支持把当前容器转换为自由布局", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/layout-freeze-container.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell" style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px;">
                    <div style="padding: 12px; background: #f5f5f5;">卡片一</div>
                    <div style="padding: 12px; background: #f5f5f5;">卡片二</div>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-layout-freeze-container-v1",
        previewPath: "/preview/files/preview-token/slides/layout-freeze-container.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/layout-freeze-container.html"
      })
    );
    fileApiMock.saveFileContent.mockResolvedValue({
      version: "ppt-layout-freeze-container-v2",
      updatedAt: "2026-05-16T11:20:00.000Z"
    });

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/layout-freeze-container.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));
    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerPresentationLayoutMode") }));

    const nodeButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".static-html-presentation-node-chip")
    );
    const targetNodeButton = nodeButtons.find((button) => button.textContent?.includes("卡片一"));
    expect(targetNodeButton).toBeTruthy();
    await user.click(targetNodeButton!);

    const freezeButton = await screen.findByRole("button", { name: t("conversation.fileViewerPresentationLayoutFreezeContainer") });
    expect(freezeButton).toBeInTheDocument();
    await waitFor(() => {
      expect(freezeButton).toBeEnabled();
    });
    await user.click(freezeButton);

    await waitFor(() => {
      const positionInputs = Array.from(document.querySelectorAll<HTMLInputElement>(".static-html-presentation-layout-field input"));
      expect(positionInputs[0]).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: t("conversation.filePanelSave") }));

    await waitFor(() => {
      expect(fileApiMock.saveFileContent).toHaveBeenCalledTimes(1);
    });

    const saveArgs = fileApiMock.saveFileContent.mock.calls[0];
    expect(saveArgs?.[2]).toContain("data-cns-layout-freeze=\"true\"");
    expect(saveArgs?.[2]).toContain("position: absolute");
  });

  it("复杂静态 HTML 在演示文档模式下会把第一页内容写进 iframe，而不是空白 srcdoc", async () => {
    const user = userEvent.setup();
    const html = readFileSync(
      "/Users/jackson/Code/CodingNS/tmp/20260426-AI模型贴脸对战.html",
      "utf8"
    );

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "tmp/20260426-AI模型贴脸对战.html",
        kind: "html",
        content: html,
        version: "ppt-real-preview-v1",
        previewPath: "/preview/files/preview-token/tmp/20260426-AI模型贴脸对战.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/tmp/20260426-AI模型贴脸对战.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="tmp/20260426-AI模型贴脸对战.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));

    const frame = await screen.findByTestId("static-html-presentation-frame");
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("AI 贴脸对战"));
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("DeepSeek-V4"));
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("model-pill"));
  });

  it("演示文档画布会按页面基准尺寸缩放展示，而不是只显示左上角局部", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/fit-stage.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <head>
              <style>:root { --deck-width: 1600px; --deck-height: 900px; }</style>
            </head>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell"><h1>整页适配</h1></div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-fit-stage-v1",
        previewPath: "/preview/files/preview-token/slides/fit-stage.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/fit-stage.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/fit-stage.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));

    const frame = await screen.findByTestId("static-html-presentation-frame");
    expect(frame.getAttribute("style")).toContain("width: 1600px");
    expect(frame.getAttribute("style")).toContain("height: 900px");
    expect(frame.getAttribute("style")).toContain("transform: scale(");
  });

  it("演示文档视图单纯切换选中组件时，不会重新生成 iframe srcdoc", async () => {
    const user = userEvent.setup();
    const html = readFileSync(
      "/Users/jackson/Code/CodingNS/tmp/codingns-presentation.html",
      "utf8"
    );

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "tmp/codingns-presentation.html",
        kind: "html",
        content: html,
        version: "ppt-selection-stable-v1",
        previewPath: "/preview/files/preview-token/tmp/codingns-presentation.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/tmp/codingns-presentation.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="tmp/codingns-presentation.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));

    const frame = await screen.findByTestId("static-html-presentation-frame");
    const initialSrcdoc = frame.getAttribute("srcdoc");
    const nodeButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".static-html-presentation-node-chip")
    );
    const codingNsNodeButton = nodeButtons.find((button) =>
      button.textContent?.includes("CodingNS")
    );
    const deviceNodeButton = nodeButtons.find((button) =>
      button.textContent?.includes("任意设备接续")
    );

    expect(codingNsNodeButton).toBeTruthy();
    expect(deviceNodeButton).toBeTruthy();

    await user.click(codingNsNodeButton!);
    expect(frame.getAttribute("srcdoc")).toBe(initialSrcdoc);

    await user.click(deviceNodeButton!);
    expect(frame.getAttribute("srcdoc")).toBe(initialSrcdoc);
  });

  it("演示文档视图在布局模式下修改几何输入前，不会因为选中节点而反复重建 iframe srcdoc", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/layout-drag-stable.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell">
                    <div style="position: absolute; left: 40px; top: 60px; width: 160px; height: 60px;">布局组件</div>
                    <div style="position: absolute; left: 320px; top: 60px; width: 180px; height: 60px;">参考组件</div>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-layout-drag-stable-v1",
        previewPath: "/preview/files/preview-token/slides/layout-drag-stable.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/layout-drag-stable.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/layout-drag-stable.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));
    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerPresentationLayoutMode") }));

    const frame = await screen.findByTestId("static-html-presentation-frame");
    const initialSrcdoc = frame.getAttribute("srcdoc");
    const nodeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".static-html-presentation-node-chip"));
    const targetNodeButton = nodeButtons.find((button) => button.textContent?.includes("布局组件"));
    expect(targetNodeButton).toBeTruthy();
    await user.click(targetNodeButton!);

    expect(frame.getAttribute("srcdoc")).toBe(initialSrcdoc);

    const positionInputs = Array.from(document.querySelectorAll<HTMLInputElement>(".static-html-presentation-layout-field input"));
    expect(positionInputs).toHaveLength(4);
    await user.click(positionInputs[0]!);
    expect(frame.getAttribute("srcdoc")).toBe(initialSrcdoc);
  });

  it("演示文档视图支持导出 PDF", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/export-presentation.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <head>
              <style>:root { --deck-width: 1600px; --deck-height: 900px; }</style>
            </head>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <div class="slide-shell">
                    <div class="hero-card">
                      <h1 style="font-size: 32px; color: #111111;">导出标题</h1>
                    </div>
                  </div>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-export-v1",
        previewPath: "/preview/files/preview-token/slides/export-presentation.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/export-presentation.html"
      })
    );
    presentationExportApiMock.createPresentationExportTask.mockResolvedValue({
      taskId: "presentation-export-task-1",
      workspaceId: "workspace-1",
      sourcePath: "slides/export-presentation.html",
      format: "pdf",
      status: "queued",
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      outputPath: "/tmp/export-presentation.pdf"
    });
    presentationExportApiMock.getPresentationExportTask
      .mockResolvedValueOnce({
        taskId: "presentation-export-task-1",
        workspaceId: "workspace-1",
        sourcePath: "slides/export-presentation.html",
        format: "pdf",
        status: "succeeded",
        startedAt: "2026-05-15T10:00:00.000Z",
        finishedAt: "2026-05-15T10:00:01.000Z",
        errorMessage: null,
        outputPath: "/tmp/export-presentation.pdf"
      });

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/export-presentation.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));
    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerExportPdf") }));

    await waitFor(() => {
      expect(presentationExportApiMock.createPresentationExportTask).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        path: "slides/export-presentation.html",
        format: "pdf",
        htmlContent: expect.stringContaining("导出标题")
      });
    });
    await waitFor(() => {
      expect(presentationExportApiMock.getPresentationExportTask).toHaveBeenCalledWith(
        "presentation-export-task-1"
      );
    });
    await waitFor(() => {
      expect(presentationExportApiMock.downloadPresentationExportTask).toHaveBeenCalledWith(
        "presentation-export-task-1"
      );
    });
    expect(downloadAnchorClickMock).toHaveBeenCalled();
  });

  it("演示文档视图支持导出 PPTX", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "slides/export-presentation-pptx.html",
        kind: "html",
        content: `
          <!doctype html>
          <html>
            <body>
              <div class="deck">
                <section class="slide" data-title="封面">
                  <h1>导出到 PPTX</h1>
                </section>
              </div>
            </body>
          </html>
        `,
        version: "ppt-export-pptx-v1",
        previewPath: "/preview/files/preview-token/slides/export-presentation-pptx.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/slides/export-presentation-pptx.html"
      })
    );
    presentationExportApiMock.createPresentationExportTask.mockResolvedValue({
      taskId: "presentation-export-task-pptx-1",
      workspaceId: "workspace-1",
      sourcePath: "slides/export-presentation-pptx.html",
      format: "pptx",
      status: "queued",
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      outputPath: "/tmp/export-presentation-pptx.pptx"
    });
    presentationExportApiMock.getPresentationExportTask.mockResolvedValueOnce({
      taskId: "presentation-export-task-pptx-1",
      workspaceId: "workspace-1",
      sourcePath: "slides/export-presentation-pptx.html",
      format: "pptx",
      status: "succeeded",
      startedAt: "2026-05-15T10:00:00.000Z",
      finishedAt: "2026-05-15T10:00:01.000Z",
      errorMessage: null,
      outputPath: "/tmp/export-presentation-pptx.pptx"
    });

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="slides/export-presentation-pptx.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await user.click(await screen.findByRole("tab", { name: t("conversation.fileViewerPresentation") }));
    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerExportPptx") }));

    await waitFor(() => {
      expect(presentationExportApiMock.createPresentationExportTask).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        path: "slides/export-presentation-pptx.html",
        format: "pptx",
        htmlContent: expect.stringContaining("导出到 PPTX")
      });
    });
    await waitFor(() => {
      expect(presentationExportApiMock.downloadPresentationExportTask).toHaveBeenCalledWith(
        "presentation-export-task-pptx-1"
      );
    });
  });

  it("桌面端内置 HTML 预览也使用当前 Host 连接地址，而不是后端返回的 127 预览地址", async () => {
    clientConfigStore.hydrate(createRuntimeConfigSnapshot("http://10.10.1.8:4100"));

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "site/index.html",
        kind: "html",
        content: "<!doctype html><html><body>preview</body></html>",
        version: "html-v1",
        previewPath: "/preview/files/preview-token/site/index.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/site/index.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="site/index.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    const previewFrame = await screen.findByTestId("file-viewer-html-preview");
    expect(previewFrame).toHaveAttribute(
      "src",
      expect.stringContaining("http://10.10.1.8:4100/preview/files/preview-token/site/index.html?_preview=0")
    );
  });

  it("桌面端外部打开使用当前 Host 连接地址，而不是后端返回的 127 预览地址", async () => {
    const user = userEvent.setup();
    clientConfigStore.hydrate(createRuntimeConfigSnapshot("http://10.10.1.8:4100"));

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "site/index.html",
        kind: "html",
        content: "<!doctype html><html><body>preview</body></html>",
        version: "html-v1",
        previewPath: "/preview/files/preview-token/site/index.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/site/index.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="site/index.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await screen.findByTestId("file-viewer-html-preview");
    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerOpenExternal") }));

    expect(platformMock.openExternal).toHaveBeenCalledWith(
      "http://10.10.1.8:4100/preview/files/preview-token/site/index.html"
    );
  });

  it("桌面端内置图片预览使用当前 Host 连接地址，而不是后端返回的 127 预览地址", async () => {
    clientConfigStore.hydrate(createRuntimeConfigSnapshot("http://10.10.1.8:4100"));

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "assets/diagram.png",
        kind: "image",
        content: null,
        version: null,
        previewPath: "/preview/files/preview-token/assets/diagram.png",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/assets/diagram.png",
        capabilities: {
          canEdit: false,
          canRefresh: true,
          canResize: true,
          canZoom: true,
          canPaginate: false
        }
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="assets/diagram.png"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    const previewImage = await screen.findByTestId("file-viewer-image-preview");
    expect(previewImage).toHaveAttribute(
      "src",
      expect.stringContaining("http://10.10.1.8:4100/preview/files/preview-token/assets/diagram.png?_preview=0")
    );
  });

  it("桌面端内置 PDF 预览使用当前 Host 连接地址，而不是后端返回的 127 预览地址", async () => {
    clientConfigStore.hydrate(createRuntimeConfigSnapshot("http://10.10.1.8:4100"));

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "docs/spec.pdf",
        kind: "pdf",
        content: null,
        version: null,
        previewPath: "/preview/files/preview-token/docs/spec.pdf",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/docs/spec.pdf",
        capabilities: {
          canEdit: false,
          canRefresh: true,
          canResize: true,
          canZoom: true,
          canPaginate: true
        }
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="docs/spec.pdf"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    const previewFrame = await screen.findByTestId("file-viewer-pdf-preview");
    expect(previewFrame).toHaveAttribute(
      "src",
      expect.stringContaining("http://10.10.1.8:4100/preview/files/preview-token/docs/spec.pdf?_preview=0#page=1&zoom=page-width")
    );
  });

  it("图片文件使用内置 viewer，并支持缩放与外部打开", async () => {
    const user = userEvent.setup();

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "assets/diagram.png",
        kind: "image",
        content: null,
        version: null,
        previewPath: "/preview/files/preview-token/assets/diagram.png",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/assets/diagram.png",
        capabilities: {
          canEdit: false,
          canRefresh: true,
          canResize: true,
          canZoom: true,
          canPaginate: false
        }
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="assets/diagram.png"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    const previewImage = await screen.findByTestId("file-viewer-image-preview");
    expect(previewImage).toHaveAttribute(
      "src",
      expect.stringContaining("/preview/files/preview-token/assets/diagram.png?_preview=0")
    );

    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerActualSize") }));
    expect(previewImage).toHaveAttribute("data-mode", "actual");

    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerOpenExternal") }));
    expect(platformMock.openExternal).toHaveBeenCalledWith(
      "http://127.0.0.1:3002/preview/files/preview-token/assets/diagram.png"
    );
  });

  it("PDF 文件使用内置 viewer，并移除与内嵌查看器重复的顶部按钮", async () => {
    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "docs/spec.pdf",
        kind: "pdf",
        content: null,
        version: null,
        previewPath: "/preview/files/preview-token/docs/spec.pdf",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/docs/spec.pdf",
        capabilities: {
          canEdit: false,
          canRefresh: true,
          canResize: true,
          canZoom: true,
          canPaginate: true
        }
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="docs/spec.pdf"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    const previewFrame = await screen.findByTestId("file-viewer-pdf-preview");
    expect(previewFrame).toHaveAttribute(
      "src",
      expect.stringContaining("docs/spec.pdf?_preview=0")
    );
    expect(previewFrame).toHaveAttribute("src", expect.stringContaining("#page=1&zoom=page-width"));
    expect(screen.queryByRole("button", { name: t("conversation.fileViewerPreviousPage") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("conversation.fileViewerNextPage") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("conversation.fileViewerZoomOut") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("conversation.fileViewerZoomIn") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("conversation.fileViewerFitWidth") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /第\s*1\s*页/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("conversation.fileViewerRefreshPreview") })).toBeInTheDocument();
  });

  it("PDF 预览时由查看器内容区自己承接滚动，不让模态框 body 抢滚动", async () => {
    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "docs/spec.pdf",
        kind: "pdf",
        content: null,
        version: null,
        previewPath: "/preview/files/preview-token/docs/spec.pdf",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/docs/spec.pdf",
        capabilities: {
          canEdit: false,
          canRefresh: true,
          canResize: true,
          canZoom: true,
          canPaginate: true
        }
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="docs/spec.pdf"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    await screen.findByTestId("file-viewer-pdf-preview");

    const modalBody = document.querySelector(".file-viewer-modal-body");
    const viewerBody = document.querySelector(".file-viewer-body");
    const pdfShell = document.querySelector(".file-viewer-pdf-shell");

    expect(modalBody).not.toBeNull();
    expect(viewerBody).not.toBeNull();
    expect(pdfShell).not.toBeNull();

    expect(getComputedStyle(modalBody as Element).overflowY).toBe("hidden");
    expect(getComputedStyle(viewerBody as Element).display).toBe("flex");
    expect(getComputedStyle(pdfShell as Element).overflowY).toBe("auto");
  });

  it("Web 代理场景下，外部打开优先使用当前 origin 加 previewPath", async () => {
    const user = userEvent.setup();
    platformMock.isDesktop = false;

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "docs/spec.pdf",
        kind: "pdf",
        content: null,
        version: null,
        previewPath: "/preview/files/preview-token/docs/spec.pdf",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/docs/spec.pdf",
        capabilities: {
          canEdit: false,
          canRefresh: true,
          canResize: true,
          canZoom: true,
          canPaginate: true
        }
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="docs/spec.pdf"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    const previewFrame = await screen.findByTestId("file-viewer-pdf-preview");
    expect(previewFrame).toHaveAttribute(
      "src",
      expect.stringContaining("http://localhost:3000/preview/files/preview-token/docs/spec.pdf?_preview=0")
    );

    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerOpenExternal") }));

    expect(platformMock.openExternal).toHaveBeenCalledWith(
      "http://localhost:3000/preview/files/preview-token/docs/spec.pdf"
    );
  });

  it("Web 受控 HTML 预览会保留同源身份，保证 Workspace HTTP bridge 可用", async () => {
    platformMock.isDesktop = false;

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "site/index.html",
        kind: "html",
        content: "<!doctype html><html><body>preview</body></html>",
        version: "html-v1",
        previewPath: "/preview/files/preview-token/site/index.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/site/index.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="site/index.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    const previewFrame = await screen.findByTestId("file-viewer-html-preview");
    expect(previewFrame).toHaveAttribute(
      "src",
      expect.stringContaining("http://localhost:3000/preview/files/preview-token/site/index.html?_preview=0")
    );
    expect(previewFrame).toHaveAttribute(
      "sandbox",
      "allow-forms allow-modals allow-scripts allow-same-origin"
    );
  });

  it("HTML 预览容器默认使用拉伸布局，避免桌面端把 iframe 挤成中间一条", async () => {
    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "site/index.html",
        kind: "html",
        content: "<!doctype html><html><body>preview</body></html>",
        version: "html-v1",
        previewPath: "/preview/files/preview-token/site/index.html",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/site/index.html"
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="site/index.html"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    const previewFrame = await screen.findByTestId("file-viewer-html-preview");
    const previewShell = previewFrame.closest(".file-viewer-html-frame-shell");

    expect(previewShell).not.toBeNull();
    expect(getComputedStyle(previewShell as Element).alignItems).toBe("stretch");
    expect(getComputedStyle(previewShell as Element).justifyContent).toBe("stretch");
    expect(getComputedStyle(previewFrame).display).toBe("block");
    expect(getComputedStyle(previewFrame).flexGrow).toBe("1");
  });
});

function createPreviewResponse(overrides: Partial<FilePreviewDto> = {}): FilePreviewDto {
  return {
    workspaceId: "workspace-1",
    path: "notes.txt",
    supported: true,
    kind: "text",
    reason: null,
    content: "hello",
    version: "v1",
    size: 5,
    updatedAt: "2026-03-31T00:00:00.000Z",
    previewPath: null,
    previewUrl: null,
    onlyOffice: null,
    capabilities: {
      canEdit: true,
      canRefresh: true,
      canResize: true,
      canZoom: false,
      canPaginate: false
    },
    ...overrides
  };
}

function createRuntimeConfigSnapshot(baseUrl: string) {
  return {
    platform: "desktop" as const,
    activeHostId: "host-1",
    hosts: [
      {
        id: "host-1",
        name: "Host 1",
        baseUrl,
        kind: "lan" as const,
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z",
        lastConnectedAt: null,
        lastUserId: null,
        lastUsername: null
      }
    ],
    discoveredHosts: [],
    activeDiscoveredHostId: null,
    localHostDiscovery: {
      status: "idle" as const,
      lastScannedAt: null,
      cooldownUntil: null,
      errorCode: null,
      errorDetail: null
    },
    releaseChannel: "stable" as const,
    autoReconnect: true,
    autoCheckUpdate: true,
    language: "zh-CN" as const,
    defaultPermissionMode: "default" as const
  };
}
