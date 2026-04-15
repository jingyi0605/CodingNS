export type MobileConversationPreviewMode = "preview" | "immersive";
export type MobileConversationToolPanel = "files" | "git" | "processes";

const MOBILE_CONVERSATION_PREVIEW_MODE_KEY = "mobile.conversation.preview.mode";
const MOBILE_CONVERSATION_TOOL_PANEL_KEY = "mobile.conversation.tool.panel";

export function readMobileConversationPreviewMode(): MobileConversationPreviewMode {
  if (typeof window === "undefined") {
    return "preview";
  }

  try {
    return window.localStorage.getItem(MOBILE_CONVERSATION_PREVIEW_MODE_KEY) === "immersive"
      ? "immersive"
      : "preview";
  } catch {
    return "preview";
  }
}

export function writeMobileConversationPreviewMode(mode: MobileConversationPreviewMode) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(MOBILE_CONVERSATION_PREVIEW_MODE_KEY, mode);
  } catch {
    // 忽略隐私模式或测试环境里的存储失败。
  }
}

export function readMobileConversationToolPanel(): MobileConversationToolPanel {
  if (typeof window === "undefined") {
    return "files";
  }

  try {
    const value = window.localStorage.getItem(MOBILE_CONVERSATION_TOOL_PANEL_KEY);

    if (value === "git" || value === "processes") {
      return value;
    }

    return "files";
  } catch {
    return "files";
  }
}

export function writeMobileConversationToolPanel(panel: MobileConversationToolPanel) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(MOBILE_CONVERSATION_TOOL_PANEL_KEY, panel);
  } catch {
    // 忽略隐私模式或测试环境里的存储失败。
  }
}
