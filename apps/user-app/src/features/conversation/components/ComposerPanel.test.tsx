import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { ComposerPanel } from "./ComposerPanel";

function createDeferred() {
  let resolve: (() => void) | null = null;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });

  return {
    promise,
    resolve: resolve!
  };
}

function createCapabilities(options?: {
  supportsAttachments?: boolean;
}) {
  return {
    provider: "codex" as const,
    canStartSession: true,
    canResumeSession: true,
    canSendMessage: true,
    supportsSubagents: false,
    supportsInterrupt: true,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: false,
    supportsAttachments: options?.supportsAttachments ?? false,
    supportsPermissionPrompt: true,
    supportsCheckpoint: false,
    limitations: []
  };
}

class MockFileReader {
  result: string | ArrayBuffer | null = null;
  error: Error | null = null;
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;

  readAsDataURL() {
    this.result = "data:image/png;base64,ZmFrZQ==";
    this.onload?.();
  }
}

describe("ComposerPanel", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      writable: true,
      value: vi.fn(() => "blob:preview")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      writable: true,
      value: vi.fn(() => {})
    });
    vi.stubGlobal("FileReader", MockFileReader);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("连续提交两次时只会发送一次", async () => {
    const deferred = createDeferred();
    const onSend = vi.fn(() => deferred.promise);

    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        isSubmitting={false}
        onSend={onSend}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: {
        value: "请整理这次修改，并输出一条中文提交信息"
      }
    });

    const form = document.querySelector(".composer-form");
    expect(form).not.toBeNull();

    fireEvent.submit(form!);
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    deferred.resolve();
    await deferred.promise;
  });

  it("提交后会立刻清空输入框，并切换到发送中按钮", () => {
    const deferred = createDeferred();

    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        isSubmitting={false}
        onSend={vi.fn(() => deferred.promise)}
      />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: {
        value: "继续整理这一轮会话的下一步。"
      }
    });

    fireEvent.submit(document.querySelector(".composer-form")!);

    expect(textarea.value).toBe("");
    expect(screen.queryByLabelText(t("conversation.sendButton"))).not.toBeInTheDocument();
    expect(screen.getByLabelText(t("conversation.sendingState"))).toBeInTheDocument();

    deferred.resolve();
  });

  it("运行中时只显示中断按钮", () => {
    render(
      <ComposerPanel
        capabilities={createCapabilities()}
        isSubmitting={false}
        isRunning
        onInterrupt={vi.fn()}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.queryByLabelText(t("conversation.sendButton"))).not.toBeInTheDocument();
    expect(screen.getByLabelText(t("conversation.capabilityInterrupt"))).toBeInTheDocument();
  });

  it("粘贴图片后会显示预览卡片", async () => {
    render(
      <ComposerPanel
        capabilities={createCapabilities({ supportsAttachments: true })}
        isSubmitting={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const textarea = screen.getByRole("textbox");
    const file = new File(["demo"], "demo.png", { type: "image/png" });

    fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => file
          }
        ]
      }
    });

    await waitFor(() => {
      expect(screen.getByText("demo.png")).toBeInTheDocument();
    });
    expect(screen.getByAltText(t("conversation.attachmentPreviewAlt"))).toBeInTheDocument();
  });

  it("只有图片附件时也允许提交，并把附件一起传出去", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);

    const { container } = render(
      <ComposerPanel
        capabilities={createCapabilities({ supportsAttachments: true })}
        isSubmitting={false}
        onSend={onSend}
      />
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["demo"], "demo.png", { type: "image/png" });

    fireEvent.change(input, {
      target: {
        files: [file]
      }
    });
    fireEvent.submit(container.querySelector(".composer-form")!);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(onSend).toHaveBeenCalledWith("", {
      model: "gpt-5.4",
      reasoningLevel: "medium",
      attachments: [
        {
          fileName: "demo.png",
          mimeType: "image/png",
          fileSize: 4,
          contentBase64: "ZmFrZQ=="
        }
      ],
      attachmentMeta: [
        expect.objectContaining({
          kind: "image",
          fileName: "demo.png",
          mimeType: "image/png",
          fileSize: 4
        })
      ]
    });
  });
});
