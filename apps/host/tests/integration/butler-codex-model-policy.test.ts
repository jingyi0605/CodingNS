import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveButlerCodexBackgroundModel } from "../../src/modules/butler/butler-codex-model-policy.js";

describe("resolveButlerCodexBackgroundModel", () => {
  it("当前 Codex provider 是 api 时，不再强制 gpt-5.1-codex-mini", () => {
    const homeDir = createCodexHome(`model_provider = "api"\nmodel = "gpt-5.4"\n`);

    expect(resolveButlerCodexBackgroundModel("gpt-5.1-codex-mini", homeDir)).toBeNull();
  });

  it("非 api provider 时仍保留轻量后台模型", () => {
    const homeDir = createCodexHome(`model_provider = "gmn"\nmodel = "gpt-5.4"\n`);

    expect(resolveButlerCodexBackgroundModel("gpt-5.1-codex-mini", homeDir)).toBe(
      "gpt-5.1-codex-mini"
    );
  });
});

function createCodexHome(configContent: string): string {
  const homeDir = mkdtempSync(join(tmpdir(), "butler-codex-model-policy-"));
  mkdirSync(homeDir, { recursive: true });
  writeFileSync(join(homeDir, "config.toml"), configContent, "utf8");
  return homeDir;
}
