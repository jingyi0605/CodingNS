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
});
