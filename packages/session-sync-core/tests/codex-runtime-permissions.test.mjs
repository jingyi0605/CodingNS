import test from "node:test";
import assert from "node:assert/strict";

import { createCodexThreadPermissionOptions } from "../dist/runtime/codex-permissions.js";

test("Codex 默认权限模式会跟随 CLI 配置，不再额外注入 sandbox 参数", () => {
  const options = createCodexThreadPermissionOptions(null);

  assert.equal("sandboxMode" in options, false);
  assert.equal("approvalPolicy" in options, false);
});

test("Codex acceptEdits 只显式关闭审批", () => {
  const options = createCodexThreadPermissionOptions("acceptEdits");

  assert.equal("sandboxMode" in options, false);
  assert.equal(options.approvalPolicy, "never");
});

test("Codex bypassPermissions 只显式关闭审批", () => {
  const options = createCodexThreadPermissionOptions("bypassPermissions");

  assert.equal("sandboxMode" in options, false);
  assert.equal(options.approvalPolicy, "never");
});
