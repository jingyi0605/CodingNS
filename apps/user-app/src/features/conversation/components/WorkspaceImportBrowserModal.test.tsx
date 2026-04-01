import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import type { WorkspaceDto } from "../api/conversation-api";
import { WorkspaceImportBrowserModal } from "./WorkspaceImportBrowserModal";

const conversationApiMock = vi.hoisted(() => ({
  browseWorkspaceDirectories: vi.fn(),
  createWorkspaceDirectory: vi.fn(),
  importWorkspace: vi.fn()
}));

const toastMock = vi.hoisted(() => ({
  showToast: vi.fn()
}));

vi.mock("../api/conversation-api", async () => {
  const actual = await vi.importActual<typeof import("../api/conversation-api")>(
    "../api/conversation-api"
  );

  return {
    ...actual,
    browseWorkspaceDirectories: (...args: unknown[]) =>
      conversationApiMock.browseWorkspaceDirectories(...args),
    createWorkspaceDirectory: (...args: unknown[]) =>
      conversationApiMock.createWorkspaceDirectory(...args),
    importWorkspace: (...args: unknown[]) => conversationApiMock.importWorkspace(...args)
  };
});

vi.mock("../../../shared/toast", () => ({
  useToast: () => toastMock
}));

describe("WorkspaceImportBrowserModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationApiMock.browseWorkspaceDirectories.mockResolvedValue({
      currentPath: "/srv/projects/demo",
      parentPath: "/srv/projects",
      roots: [{ path: "/", name: "/" }],
      items: []
    });
    conversationApiMock.importWorkspace.mockResolvedValue({
      id: "workspace-demo",
      name: "Demo",
      path: "/srv/projects/demo",
      repoRoot: "/srv/projects/demo"
    } satisfies WorkspaceDto);
  });

  it("导入成功后不会被父层的异步回调卡在添加中", async () => {
    const user = userEvent.setup();
    const onImported = vi.fn(
      () =>
        new Promise<void>(() => {
          // 故意保持 pending，用来验证弹窗不会被父层异步流程卡住
        })
    );

    render(<TestHost onImported={onImported} />);

    const dialog = await screen.findByRole("dialog", { name: t("shell.importBrowserTitle") });

    await user.click(within(dialog).getByRole("button", { name: t("shell.importBrowserSubmit") }));

    await waitFor(() => {
      expect(conversationApiMock.importWorkspace).toHaveBeenCalledWith({
        path: "/srv/projects/demo"
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: t("shell.importBrowserTitle") })).not.toBeInTheDocument();
    });

    expect(onImported).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "workspace-demo"
      })
    );
    expect(toastMock.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: t("shell.importSuccess"),
        description: "/srv/projects/demo",
        tone: "success"
      })
    );
  });
});

function TestHost({
  onImported
}: {
  readonly onImported?: (workspace: WorkspaceDto) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <WorkspaceImportBrowserModal
      open={open}
      onClose={() => setOpen(false)}
      onImported={onImported}
    />
  );
}
