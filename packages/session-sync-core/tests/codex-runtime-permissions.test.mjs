import test from "node:test";
import assert from "node:assert/strict";

import {
  createCodexThreadPermissionOptions,
  resolveCodexPermissionResolution
} from "../dist/runtime/codex-permissions.js";

test("Codex 默认权限模式会跟随 CLI 配置，不再额外注入 sandbox 参数", () => {
  const options = createCodexThreadPermissionOptions(null);

  assert.equal("sandboxMode" in options, false);
  assert.equal("approvalPolicy" in options, false);
});

test("Codex acceptEdits 会切到 workspace-write 并关闭审批", () => {
  const options = createCodexThreadPermissionOptions("acceptEdits");

  assert.equal(options.approvalPolicy, "never");
  assert.equal(options.sandboxMode, "workspace-write");
  assert.equal(options.sandbox, "workspace-write");
  assert.deepEqual(options.sandboxPolicy, { type: "workspaceWrite" });
});

test("Codex bypassPermissions 会切到 danger-full-access 并关闭审批", () => {
  const options = createCodexThreadPermissionOptions("bypassPermissions");

  assert.equal(options.approvalPolicy, "never");
  assert.equal(options.sandboxMode, "danger-full-access");
  assert.equal(options.sandbox, "danger-full-access");
  assert.deepEqual(options.sandboxPolicy, { type: "dangerFullAccess" });
});

test("Codex 权限解析会返回面向状态页的解释", () => {
  const resolution = resolveCodexPermissionResolution("default");

  assert.equal(resolution.effectivePermissionMode, "default");
  assert.equal(resolution.approvalPolicy, null);
  assert.equal(resolution.sandboxMode, null);
  assert.match(resolution.reasoning, /CLI 默认权限配置/);
});
