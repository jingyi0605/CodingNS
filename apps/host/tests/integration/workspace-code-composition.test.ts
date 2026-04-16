import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readWorkspaceCodeCompositionWithSignal } from "../../src/modules/workspace/workspace-code-composition.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("workspace code composition", () => {
  it("helper 扫描会尊重已中止的 AbortSignal", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-code-composition-"));
    tempDirs.push(tempDir);
    const controller = new AbortController();
    controller.abort(new Error("manual abort"));

    await expect(
      readWorkspaceCodeCompositionWithSignal(tempDir, controller.signal)
    ).rejects.toThrow("manual abort");
  });
});
