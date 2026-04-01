import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../../shared/toast";
import { t } from "../../../shared/i18n";
import { FileViewerModal } from "./FileViewerModal";

const fileApiMock = vi.hoisted(() => ({
  getFilePreview: vi.fn(),
  saveFileContent: vi.fn()
}));

vi.mock("../api/file-context-api", () => ({
  getFilePreview: fileApiMock.getFilePreview,
  saveFileContent: fileApiMock.saveFileContent
}));

describe("FileViewerModal", () => {
  beforeEach(() => {
    fileApiMock.getFilePreview.mockResolvedValue({
      workspaceId: "workspace-1",
      path: "notes.txt",
      supported: true,
      kind: "text",
      reason: null,
      content: "hello",
      version: "v1",
      size: 5,
      updatedAt: "2026-03-31T00:00:00.000Z"
    });
    fileApiMock.saveFileContent.mockReset();
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
    fileApiMock.getFilePreview.mockResolvedValue({
      workspaceId: "workspace-1",
      path: "notes.ts",
      supported: true,
      kind: "text",
      reason: null,
      content: [
        "const first = 1;",
        "const second = 2;",
        "const third = 3;",
        "const fourth = 4;"
      ].join("\n"),
      version: "v2",
      size: 64,
      updatedAt: "2026-03-31T00:00:00.000Z"
    });

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

    // 行内底色：第1行是 modify，第4行是 add，其余行无底色
    const codeLines = dialog.querySelectorAll(".file-viewer-code-line");
    expect(codeLines).toHaveLength(4);
    expect(codeLines[0]).toHaveClass("diff-line-modify");
    expect(codeLines[0]).not.toHaveClass("diff-line-add");
    expect(codeLines[1]).not.toHaveClass("diff-line-add");
    expect(codeLines[1]).not.toHaveClass("diff-line-modify");
    expect(codeLines[2]).not.toHaveClass("diff-line-add");
    expect(codeLines[2]).not.toHaveClass("diff-line-modify");
    expect(codeLines[3]).toHaveClass("diff-line-add");
    expect(codeLines[3]).not.toHaveClass("diff-line-modify");
  });
});
