import test from "node:test";
import assert from "node:assert/strict";

import { createCodexThreadPermissionOptions } from "../dist/runtime/codex-permissions.js";

test("Codex 默认权限模式会跟随 CLI 配置，而不是强制改成 untrusted", () => {
  const options = createCodexThreadPermissionOptions(null);

  assert.equal("sandboxMode" in options, false);
  assert.equal("approvalPolicy" in options, false);
});

test("Codex acceptEdits 会显式启用 workspace-write 且关闭审批", () => {
  const options = createCodexThreadPermissionOptions("acceptEdits");

  assert.equal(options.sandboxMode, "workspace-write");
  assert.equal(options.approvalPolicy, "never");
});

test("Codex bypassPermissions 会显式启用完整权限且关闭审批", () => {
  const options = createCodexThreadPermissionOptions("bypassPermissions");

  assert.equal(options.sandboxMode, "danger-full-access");
  assert.equal(options.approvalPolicy, "never");
});
