import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../../app/styles.css";
import { t } from "../../../shared/i18n";
import { ToastProvider } from "../../../shared/toast";
import type { FilePreviewDto } from "../api/file-context-api";
import { FileViewerModal } from "./FileViewerModal";

const fileApiMock = vi.hoisted(() => ({
  getFilePreview: vi.fn(),
  saveFileContent: vi.fn()
}));
const platformMock = vi.hoisted(() => ({
  openExternal: vi.fn(),
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
      openExternal: platformMock.openExternal
    }
  })
}));

describe("FileViewerModal", () => {
  beforeEach(() => {
    platformMock.isDesktop = true;
    fileApiMock.getFilePreview.mockResolvedValue(createPreviewResponse());
    fileApiMock.saveFileContent.mockReset();
    platformMock.openExternal.mockReset();
    platformMock.openExternal.mockResolvedValue({ ok: true });
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
