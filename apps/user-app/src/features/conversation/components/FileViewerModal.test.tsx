import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../../app/styles.css";
import { clientConfigStore } from "../../../config/client-config-store";
import { t } from "../../../shared/i18n";
import { ToastProvider } from "../../../shared/toast";
import type { FilePreviewDto } from "../api/file-context-api";
import { FileViewerModal } from "./FileViewerModal";

const fileApiMock = vi.hoisted(() => ({
  getFilePreview: vi.fn(),
  saveFileContent: vi.fn()
}));
const clipboardWriteTextMock = vi.hoisted(() => vi.fn());
const platformMock = vi.hoisted(() => ({
  openExternal: vi.fn(),
  writeClipboardText: vi.fn(),
  isDesktop: true
}));

vi.mock("../api/file-context-api", () => ({
  getFilePreview: fileApiMock.getFilePreview,
  saveFileContent: fileApiMock.saveFileContent
}));

vi.mock("../../../platform/platform-provider", () => ({
  usePlatform: () => ({
    isDesktop: platformMock.isDesktop,
    bridge: {
      openExternal: platformMock.openExternal,
      writeClipboardText: platformMock.writeClipboardText
    }
  })
}));

describe("FileViewerModal", () => {
  beforeEach(() => {
    platformMock.isDesktop = true;
    clientConfigStore.hydrate(createRuntimeConfigSnapshot("http://127.0.0.1:3002"));
    fileApiMock.getFilePreview.mockResolvedValue(createPreviewResponse());
    fileApiMock.saveFileContent.mockReset();
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

    const dialog = await screen.findByRole("dialog", { name: "notes.ts" });

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

  it("配置文件在编辑态保持单栏，并跟随输入实时更新渲染", async () => {
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
    expect(screen.queryByTestId("file-viewer-live-render")).not.toBeInTheDocument();
    expect(liveRender).toHaveTextContent("NODE_ENV");
    expect(liveRender).toHaveTextContent("3000");

    await user.clear(editor);
    await user.type(editor, 'NODE_ENV="production"\nPORT=3100\n');

    await waitFor(() => {
      expect(liveRender).toHaveTextContent("production");
      expect(liveRender).toHaveTextContent("3100");
    });
  });

  it("Markdown 在编辑态保持原来的纯文本输入，不启用实时渲染层", async () => {
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

    await screen.findByRole("heading", { name: "标题" });
    await user.click(screen.getByRole("tab", { name: t("conversation.fileViewerEdit") }));

    expect(await screen.findByTestId("file-viewer-editor")).toHaveValue("# 标题\n\n内容\n");
    expect(screen.queryByTestId("file-viewer-inline-render")).not.toBeInTheDocument();
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

  it("HTML 文件支持刷新预览、尺寸切换，并支持外部打开", async () => {
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

    const dialog = await screen.findByRole("dialog", { name: "site/index.html" });
    const previewFrame = await screen.findByTestId("file-viewer-html-preview");
    expect(previewFrame).toHaveAttribute(
      "src",
      expect.stringContaining("/preview/files/preview-token/site/index.html?_preview=0")
    );
    expect(previewFrame).toHaveAttribute(
      "sandbox",
      "allow-forms allow-modals allow-scripts allow-same-origin"
    );
    expect(dialog).toHaveAttribute("data-size", "regular");

    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerSizeFull") }));
    expect(screen.getByRole("dialog", { name: "site/index.html" })).toHaveAttribute("data-size", "full");

    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerRefreshPreview") }));

    await waitFor(() => {
      expect(fileApiMock.getFilePreview).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId("file-viewer-html-preview")).toHaveAttribute(
      "src",
      expect.stringContaining("_preview=1")
    );

    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerOpenExternal") }));

    expect(platformMock.openExternal).toHaveBeenCalledWith(
      "http://127.0.0.1:3002/preview/files/preview-token/site/index.html"
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

  it("PDF 文件使用内置 viewer，并支持翻页和适宽", async () => {
    const user = userEvent.setup();

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
      expect.stringContaining("docs/spec.pdf?_preview=0#page=1&zoom=page-width")
    );

    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerNextPage") }));
    expect(screen.getByTestId("file-viewer-pdf-preview")).toHaveAttribute(
      "src",
      expect.stringContaining("#page=2&zoom=page-width")
    );

    await user.click(screen.getByRole("button", { name: t("conversation.fileViewerZoomIn") }));
    expect(screen.getByTestId("file-viewer-pdf-preview")).toHaveAttribute(
      "src",
      expect.stringContaining("#page=2&zoom=120")
    );
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

  it("Web 同源 HTML 预览不放宽 sandbox", async () => {
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
      "allow-forms allow-modals allow-scripts"
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
