import { describe, expect, it } from "vitest";

import {
  buildSessionTitleFromContent,
  normalizeRuntimePromptTitle,
  SESSION_TITLE_MAX_LENGTH
} from "../../src/modules/sessions/session-title-utils.js";

describe("session-title-utils", () => {
  it("会从 Codex 子 Agent 角色指令里提取真实任务", () => {
    const content = "你是 Agent F，负责 macOS 端 X-File 样式迁移收尾与回归验证";

    expect(buildSessionTitleFromContent(content, "继续对话")).toBe(
      "macOS 端 X-File 样式迁移收尾与回归验证"
    );
    expect(normalizeRuntimePromptTitle(content)).toBe(
      "macOS 端 X-File 样式迁移收尾与回归验证"
    );
  });

  it("普通新会话标题最多保留 72 个字符，不再按 48 个字符过早截断", () => {
    const content = "优化 Codex 新建会话名称生成逻辑，让标题包含具体对象动作范围和验证信息，避免过短";

    expect(buildSessionTitleFromContent(content, "继续对话")).toHaveLength(
      Math.min(content.length, SESSION_TITLE_MAX_LENGTH)
    );
    expect(buildSessionTitleFromContent(content, "继续对话")).toBe(content);
  });
});
