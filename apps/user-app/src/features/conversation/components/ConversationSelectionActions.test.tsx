import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { ConversationSelectionActions } from "./ConversationSelectionActions";

const {
  mockGetProviderCapabilities,
  mockListProviderCapabilities
} = vi.hoisted(() => ({
  mockGetProviderCapabilities: vi.fn(),
  mockListProviderCapabilities: vi.fn()
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn()
}));

vi.mock("../../../preferences/preferences-store", () => ({
  usePreferencesSelector: (selector: (state: unknown) => unknown) =>
    selector({
      profile: {
        providers: {
          codex: {
            defaultModel: "provider-default"
          }
        }
      }
    })
}));

vi.mock("../../../platform/platform-provider", () => ({
  usePlatform: () => ({
    isDesktop: false,
    isMobile: false,
    bridge: {
      writeClipboardText: vi.fn()
    }
  })
}));

vi.mock("../../../shared/toast", () => ({
  useToast: () => ({
    showToast: vi.fn(),
    dismissToast: vi.fn()
  })
}));

vi.mock("../api/conversation-api", () => ({
  forkSession: vi.fn(),
  getProviderCapabilities: mockGetProviderCapabilities,
  listProviderCapabilities: mockListProviderCapabilities,
  getSessionDetail: vi.fn(),
  startLiveSession: vi.fn(),
  sendLiveMessage: vi.fn()
}));

vi.mock("../capability/provider-ui", () => ({
  SESSION_PROVIDER_PICKER_IDS: ["codex"],
  createDraftCapabilities: () => ({
    canStartSession: true,
    limitations: [],
    modelOptions: [
      {
        id: "provider-default",
        name: "默认模型"
      }
    ]
  }),
  getProviderDisplayName: () => "Codex"
}));

vi.mock("./WorkbenchLayout", () => ({
  useWorkbenchShell: () => ({
    shellMode: "desktop",
    requestNavigationRefresh: vi.fn(),
    selectWorkspace: vi.fn(),
    upsertNavigationSession: vi.fn()
  })
}));

vi.mock("./WorkspaceInboxModal", () => ({
  WorkspaceInboxModal: () => null
}));

describe("ConversationSelectionActions", () => {
  let currentSelection: Selection | null;

  beforeEach(() => {
    vi.useFakeTimers();
    currentSelection = null;
    mockGetProviderCapabilities.mockResolvedValue({
      canStartSession: true,
      limitations: [],
      modelOptions: [{ id: "provider-default", name: "默认模型" }]
    });
    mockListProviderCapabilities.mockResolvedValue({
      codex: {
        canStartSession: true,
        limitations: [],
        modelOptions: [{ id: "provider-default", name: "默认模型" }]
      }
    });
    Object.defineProperty(window, "getSelection", {
      configurable: true,
      value: vi.fn(() => currentSelection)
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("拖拽过程中不会提前弹出选区工具条，松手后才显示", () => {
    render(<TestHarness />);

    const messageText = screen.getByTestId("message-text");
    const textNode = messageText.firstChild;

    expect(textNode).not.toBeNull();

    currentSelection = createSelection(textNode!, "选中文本", {
      left: 120,
      top: 180,
      width: 96,
      height: 24
    });

    fireEvent.pointerDown(messageText);
    document.dispatchEvent(new Event("selectionchange"));

    expect(
      screen.queryByRole("button", { name: t("conversation.copyAction") })
    ).not.toBeInTheDocument();

    fireEvent.pointerUp(window);

    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(
      screen.getByRole("button", { name: t("conversation.copyAction") })
    ).toBeInTheDocument();
  });

  it("滚动时会重算工具条位置，而不是直接把选区清空", () => {
    render(<TestHarness />);

    const messageText = screen.getByTestId("message-text");
    const textNode = messageText.firstChild;

    expect(textNode).not.toBeNull();

    currentSelection = createSelection(textNode!, "滚动后仍然保留", {
      left: 140,
      top: 260,
      width: 120,
      height: 24
    });

    document.dispatchEvent(new Event("selectionchange"));

    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(
      screen.getByRole("button", { name: t("conversation.copyAction") })
    ).toBeInTheDocument();

    currentSelection = createSelection(textNode!, "滚动后仍然保留", {
      left: 140,
      top: 200,
      width: 120,
      height: 24
    });

    fireEvent.scroll(window);

    expect(
      screen.getByRole("button", { name: t("conversation.copyAction") })
    ).toBeInTheDocument();
  });

  it("点击操作会打开对话框，不会因为选区被清掉而失效", async () => {
    render(<TestHarness />);

    const messageText = screen.getByTestId("message-text");
    const textNode = messageText.firstChild;

    expect(textNode).not.toBeNull();

    currentSelection = createSelection(textNode!, "保留这段文字", {
      left: 160,
      top: 220,
      width: 112,
      height: 22
    });

    document.dispatchEvent(new Event("selectionchange"));

    act(() => {
      vi.advanceTimersByTime(60);
    });

    const actionButton = screen.getByRole("button", {
      name: t("conversation.selectionActionButton")
    });

    fireEvent.mouseDown(actionButton);
    fireEvent.click(actionButton);
    currentSelection = null;
    document.dispatchEvent(new Event("selectionchange"));

    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(
      screen.getByRole("dialog", { name: t("conversation.selectionActionButton") })
    ).toBeInTheDocument();
  });

  it("没有 click 事件时，pointerup 仍然会打开对话框", () => {
    render(<TestHarness />);

    const messageText = screen.getByTestId("message-text");
    const textNode = messageText.firstChild;

    expect(textNode).not.toBeNull();

    currentSelection = createSelection(textNode!, "WebView 里也得能打开", {
      left: 150,
      top: 210,
      width: 132,
      height: 22
    });

    document.dispatchEvent(new Event("selectionchange"));

    act(() => {
      vi.advanceTimersByTime(60);
    });

    const actionButton = screen.getByRole("button", {
      name: t("conversation.selectionActionButton")
    });

    fireEvent.pointerDown(actionButton);
    fireEvent.pointerUp(actionButton);
    currentSelection = null;
    document.dispatchEvent(new Event("selectionchange"));

    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(
      screen.getByRole("dialog", { name: t("conversation.selectionActionButton") })
    ).toBeInTheDocument();
  });
});

function TestHarness() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div ref={containerRef}>
      <article data-message-id="message-1">
    expect(
      screen.queryByRole("button", { name: t("conversation.copyAction") })
    ).not.toBeInTheDocument();
        <p data-testid="message-text">这是一段用于拖拽选中的聊天消息。</p>
      </article>
      <ConversationSelectionActions
        containerRef={containerRef}
        session={
          {
            sessionId: "session-1",
            workspaceId: "workspace-1",
            provider: "codex"
          } as never
        }
        currentCapabilities={null}
      />
    </div>
  );
}

function createSelection(
  textNode: Node,
  text: string,
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  }
) {
  return {
    rangeCount: 1,
    isCollapsed: false,
    toString: () => text,
    getRangeAt: () => ({
      startContainer: textNode,
      endContainer: textNode,
      getBoundingClientRect: () => ({
        left: rect.left,
        top: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        width: rect.width,
        height: rect.height
      })
    })
  } as unknown as Selection;
}

  it("点击复制后会收起选区工具条", async () => {
    render(<TestHarness />);

    const messageText = screen.getByTestId("message-text");
    const textNode = messageText.firstChild;

    expect(textNode).not.toBeNull();

    currentSelection = createSelection(textNode!, "复制后要收起", {
      left: 160,
      top: 220,
      width: 112,
      height: 22
    });

    document.dispatchEvent(new Event("selectionchange"));

    act(() => {
      vi.advanceTimersByTime(60);
    });

    fireEvent.click(screen.getByRole("button", { name: t("conversation.copyAction") }));

    expect(
      screen.queryByRole("button", { name: t("conversation.copyAction") })
    ).not.toBeInTheDocument();
  });
