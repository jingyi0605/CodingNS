import { describe, expect, it } from "vitest";

import {
  SESSION_PROVIDER_PICKER_IDS,
  createDraftCapabilities,
  getDraftTitle
} from "./provider-ui";

describe("provider-ui", () => {
  it("会把 gemini 暴露为会话创建入口", () => {
    expect(SESSION_PROVIDER_PICKER_IDS.includes("gemini")).toBe(true);
  });

  it("会把 kimi 暴露为会话创建入口", () => {
    expect(SESSION_PROVIDER_PICKER_IDS.includes("kimi")).toBe(true);
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
});
