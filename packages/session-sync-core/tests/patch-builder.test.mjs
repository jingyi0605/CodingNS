import test from "node:test";
import assert from "node:assert/strict";

import { buildApplyPatchFromCodexCommandLikeValue } from "../dist/patch-builder.js";

test("Codex 命令式 Python replace 编辑会还原行级 diff", () => {
  const editCommand = [
    "python3 - <<'PY'",
    "from pathlib import Path",
    "path = Path('src/runtime/codex-runtime.ts')",
    "text = path.read_text()",
    "old = '''const normalized = value.trim().toLowerCase();'''",
    "new = '''const normalized = value.trim().toLowerCase();\\nreturn normalized;'''",
    "text = text.replace(old, new, 1)",
    "path.write_text(text)",
    "PY"
  ].join("\\n");

  const patchText = buildApplyPatchFromCodexCommandLikeValue(JSON.stringify({ cmd: editCommand }));

  assert.match(patchText ?? "", /^\*\*\* Begin Patch/m);
  assert.match(patchText ?? "", /\*\*\* Update File: src\/runtime\/codex-runtime\.ts/);
  assert.match(patchText ?? "", /@@ -1,1 \+1,2 @@/);
  assert.match(patchText ?? "", /-const normalized = value\.trim\(\)\.toLowerCase\(\);/);
  assert.match(patchText ?? "", /\+const normalized = value\.trim\(\)\.toLowerCase\(\);/);
  assert.match(patchText ?? "", /\+return normalized;/);
});
