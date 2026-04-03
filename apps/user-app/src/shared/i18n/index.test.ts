import { afterEach, describe, expect, it } from "vitest";

import { userPreferenceStore } from "../../preferences/user-preference-store";
import { t } from "./index";

function createPreferenceState(language: "zh-CN" | "en-US") {
  return {
    initialized: true,
    profile: {
      language,
      theme: "light" as const,
      defaultPermissionMode: "default" as const
    },
    providers: {
      "claude-code": {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      codex: {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      opencode: {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      gemini: {
        defaultModel: null,
        defaultReasoningLevel: null
      },
      kimi: {
        defaultModel: null,
        defaultReasoningLevel: null
      }
    },
    updatedAt: null,
    source: "default" as const
  };
}

const initialState = userPreferenceStore.getState();

afterEach(() => {
  userPreferenceStore.hydrate(initialState);
});

describe("i18n", () => {
  it("根据当前语言返回设置和登录页文案", () => {
    userPreferenceStore.hydrate(createPreferenceState("zh-CN"));
    expect(t("common.language")).toBe("语言");
    expect(t("settings.language")).toBe("语言");
    expect(t("shell.butlerEntry")).toBe("助手");
    expect(t("shell.butlerProjectsTitle")).toBe("项目");
    expect(t("shell.butlerNewSessionAction")).toBe("新建会话");
    expect(t("shell.butlerConversationTitle")).toBe("与助手对话");

    userPreferenceStore.hydrate(createPreferenceState("en-US"));
    expect(t("common.language")).toBe("Language");
    expect(t("settings.language")).toBe("Language");
    expect(t("auth.serverSettings")).toBe("Server Settings");
    expect(t("shell.butlerEntry")).toBe("Butler");
    expect(t("shell.butlerProjectsTitle")).toBe("Projects");
    expect(t("shell.butlerNewSessionAction")).toBe("New Session");
    expect(t("shell.butlerConversationTitle")).toBe("Talk to Butler");
  });

  it("英文词典缺失时回退到中文，而不是返回 key", () => {
    userPreferenceStore.hydrate(createPreferenceState("en-US"));

    expect(t("conversation.headerCapability")).toBe("Capability Summary");
    expect(t("conversation.fileViewerHint")).toBe("Opened in {language} mode. Preview and save after editing are supported.");
    expect(t("nonexistent.key")).toBe("nonexistent.key");
  });

  it("提交占位文案应该按当前语言返回", () => {
    userPreferenceStore.hydrate(createPreferenceState("zh-CN"));
    expect(t("git.commitSubjectPlaceholder")).toBe("在这里输入提交信息");

    userPreferenceStore.hydrate(createPreferenceState("en-US"));
    expect(t("git.commitSubjectPlaceholder")).toBe("Enter the commit message here");
  });
});
