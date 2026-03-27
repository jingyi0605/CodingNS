export type MobileConversationPreviewMode = "preview" | "immersive";

const MOBILE_CONVERSATION_PREVIEW_MODE_KEY = "mobile.conversation.preview.mode";

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
