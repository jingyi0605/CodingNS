import { describe, expect, it } from "vitest";

import { resolveSubagentDisplayLabel } from "./session-fork-display";
import { t } from "../../shared/i18n";

describe("resolveSubagentDisplayLabel", () => {
  it("只显示子 Agent 昵称，不显示 agent 类型", () => {
    expect(resolveSubagentDisplayLabel({ subagentLabel: "default · Planck" })).toBe("Planck");
  });

  it("保留没有类型前缀的昵称", () => {
    expect(resolveSubagentDisplayLabel({ subagentLabel: "Planck" })).toBe("Planck");
  });

  it("没有昵称时使用默认子 Agent 标签", () => {
    expect(resolveSubagentDisplayLabel({ subagentLabel: " " })).toBe(t("shell.subagentBadge"));
  });
});
