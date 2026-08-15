import { describe, expect, it } from "vitest";

import {
  SESSION_PROVIDER_PICKER_IDS,
  createDraftCapabilities,
  getDraftTitle,
  getProviderIcon,
  shouldPersistReasoningLevel,
  shouldFoldRulesMessages,
  warmProviderIconCache
} from "./provider-ui";

describe("provider-ui", () => {
  it("会把 gemini 暴露为会话创建入口", () => {
    expect(SESSION_PROVIDER_PICKER_IDS.includes("gemini")).toBe(true);
  });

  it("会把 kimi 暴露为会话创建入口", () => {
    expect(SESSION_PROVIDER_PICKER_IDS.includes("kimi")).toBe(true);
  });

  it("会把 DeepSeek Harness 暴露为会话创建入口", () => {
    expect(SESSION_PROVIDER_PICKER_IDS.includes("deepseek-harness")).toBe(true);
    expect(getDraftTitle("deepseek-harness")).toContain("DeepSeek Harness");
    expect(shouldPersistReasoningLevel("deepseek-harness")).toBe(true);
    expect(createDraftCapabilities("deepseek-harness").supportsSessionDelete).toBe(true);
  });

  it("会把 legna-code 排在 kimi 之后", () => {
    expect(SESSION_PROVIDER_PICKER_IDS.indexOf("legna-code")).toBeGreaterThan(
      SESSION_PROVIDER_PICKER_IDS.indexOf("kimi")
    );
  });

  it("会给 gemini 草稿能力输出可中断且禁用附件的默认值", () => {
    const capabilities = createDraftCapabilities("gemini");

    expect(capabilities.provider).toBe("gemini");
    expect(capabilities.supportsInterrupt).toBe(true);
    expect(capabilities.supportsAttachments).toBe(false);
    expect(capabilities.supportsPermissionPrompt).toBe(false);
    expect(getDraftTitle("gemini").length > 0).toBe(true);
  });

  it("会给 kimi 草稿能力输出可中断且禁用附件的默认值", () => {
    const capabilities = createDraftCapabilities("kimi");

    expect(capabilities.provider).toBe("kimi");
    expect(capabilities.canStartSession).toBe(true);
    expect(capabilities.canResumeSession).toBe(true);
    expect(capabilities.canSendMessage).toBe(true);
    expect(capabilities.supportsInterrupt).toBe(true);
    expect(capabilities.supportsAttachments).toBe(false);
    expect(capabilities.supportsPermissionPrompt).toBe(false);
    expect(capabilities.modelOptions?.[0]?.id).toBe("provider-default");
    expect(getDraftTitle("kimi").length > 0).toBe(true);
  });

  it("会默认折叠 Kimi 会话的启动提示词", () => {
    expect(shouldFoldRulesMessages(null, "kimi")).toBe(true);
  });

  it("供应商图标保持本地资源，不依赖远程地址", () => {
    SESSION_PROVIDER_PICKER_IDS.forEach((provider) => {
      const icon = getProviderIcon(provider);
      expect(icon.length).toBeGreaterThan(0);
      expect(icon.startsWith("http://")).toBe(false);
      expect(icon.startsWith("https://")).toBe(false);
    });
  });

  it("图标预热缓存可以重复调用而不报错", () => {
    expect(() => warmProviderIconCache()).not.toThrow();
    expect(() => warmProviderIconCache()).not.toThrow();
  });
});
