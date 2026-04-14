import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  isCommandAvailable,
  resolveAvailableCommandPath
} from "../../src/shared/utils/command-availability.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("command-availability", () => {
  it("在 PATH 里找不到命令时，仍然可以解析回退候选路径", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-command-availability-"));
    tempDirs.push(tempDir);
    const commandPath = path.join(tempDir, "mock-tailscale");

    writeFileSync(commandPath, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(commandPath, 0o755);

    expect(isCommandAvailable("definitely-missing-command")).toBe(false);
    expect(
      resolveAvailableCommandPath("tailscale", [commandPath])
    ).toBe(commandPath);
  });
});
