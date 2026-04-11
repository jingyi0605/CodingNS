import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readJsonLines, readTrailingJsonLines } from "../dist/providers/utils.js";

test("readJsonLines 能拆开同一行里粘连的多个 JSON 对象", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "session-sync-jsonl-"));

  try {
    const filePath = join(tempDir, "joined.jsonl");
    writeFileSync(filePath, "{\"type\":\"assistant\"}{\"type\":\"queue-operation\"}\n", "utf8");

    const records = readJsonLines(filePath);

    assert.equal(records.length, 2);
    assert.equal(records[0]?.lineNumber, 1);
    assert.equal(records[0]?.partIndex, 0);
    assert.equal(records[0]?.data.type, "assistant");
    assert.equal(records[1]?.lineNumber, 1);
    assert.equal(records[1]?.partIndex, 1);
    assert.equal(records[1]?.data.type, "queue-operation");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("readTrailingJsonLines 遇到坏行时会跳过，不会把整个文件读挂", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "session-sync-jsonl-"));

  try {
    const filePath = join(tempDir, "invalid.jsonl");
    writeFileSync(
      filePath,
      [
        "{\"type\":\"user\",\"message\":\"ok\"}",
        "not-json",
        "{\"type\":\"assistant\",\"message\":\"still-ok\"}"
      ].join("\n"),
      "utf8"
    );

    const records = readTrailingJsonLines(filePath, 1024);

    assert.equal(records.length, 2);
    assert.deepEqual(
      records.map((record) => record.data.type),
      ["user", "assistant"]
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
