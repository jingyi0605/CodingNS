import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCodexAppServerArgs,
  buildCodexAppServerInitializeParams,
  buildCodexAppServerNodeReplConfigOverrides,
  buildCodexAppServerRuntimeEnv,
  buildCodexTurnRequestMetadata
} from "../dist/runtime/codex-app-server-contract.js";

test("Codex App 启动参数启用 code mode host 和 analytics", () => {
  assert.deepEqual(
    buildCodexAppServerArgs(["mcp_servers.node_repl.command=\"node_repl\"", ""]),
    [
      "-c",
      "features.code_mode_host=true",
      "-c",
      "mcp_servers.node_repl.command=\"node_repl\"",
      "app-server",
      "--analytics-default-enabled"
    ]
  );
});

test("Codex App 运行环境绑定会话 home 和浏览器运行时资源", () => {
  const env = buildCodexAppServerRuntimeEnv({
    baseEnv: {
      CODEX_APP_VERSION: "test-version"
    },
    commandPath: "/Applications/ChatGPT.app/Contents/Resources/codex",
    homeDir: "/tmp/codingns-runtime-home"
  });

  assert.equal(env.CODEX_HOME, "/tmp/codingns-runtime-home");
  assert.equal(env.CODINGNS_CODEX_HOME, "/tmp/codingns-runtime-home");
  assert.equal(env.CODEX_CLI_PATH, "/Applications/ChatGPT.app/Contents/Resources/codex");
  assert.equal(env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE, "Codex");
  assert.equal(env.BROWSER_USE_AVAILABLE_BACKENDS, "chrome,iab");
  assert.equal(env.NODE_REPL_NODE_PATH, "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node");
  assert.equal(
    env.NODE_REPL_NODE_MODULE_DIRS,
    "/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules"
  );
  assert.match(env.NODE_REPL_TRUSTED_CODE_PATHS ?? "", /\/tmp\/codingns-runtime-home/);
});

test("Codex App 初始化和 turn 请求使用同一客户端契约", () => {
  assert.deepEqual(buildCodexAppServerInitializeParams({
    BROWSER_USE_CODEX_APP_VERSION: "26.test"
  }), {
    clientInfo: {
      name: "Codex Desktop",
      version: "26.test"
    },
    capabilities: {
      experimentalApi: true
    }
  });
  assert.deepEqual(buildCodexTurnRequestMetadata(), {
    responsesapiClientMetadata: {
      workspace_kind: "project"
    }
  });
});

test("node_repl 覆盖项包含 Codex App 的浏览器环境变量", () => {
  const overrides = buildCodexAppServerNodeReplConfigOverrides({
    NODE_REPL_NODE_PATH: "/opt/cua-node",
    NODE_REPL_NODE_MODULE_DIRS: "/opt/cua-node-modules",
    BROWSER_USE_AVAILABLE_BACKENDS: "chrome,iab",
    CODEX_CLI_PATH: "/opt/codex"
  }, "/opt/node_repl");

  assert.ok(overrides.includes('mcp_servers.node_repl.command="/opt/node_repl"'));
  assert.ok(overrides.includes('mcp_servers.node_repl.env.NODE_REPL_NODE_PATH="/opt/cua-node"'));
  assert.ok(overrides.includes('mcp_servers.node_repl.env.BROWSER_USE_AVAILABLE_BACKENDS="chrome,iab"'));
  assert.ok(overrides.includes('mcp_servers.node_repl.env.CODEX_CLI_PATH="/opt/codex"'));
});

test("运行时优先使用 CODEX_HOME 中 active native-host 的浏览器路径", () => {
  const env = buildCodexAppServerRuntimeEnv({
    baseEnv: {},
    commandPath: "/opt/codex",
    homeDir: "/Users/jackson/.codex"
  });

  assert.equal(
    env.NODE_REPL_COMMAND,
    "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl"
  );
  assert.equal(
    env.NODE_REPL_NODE_PATH,
    "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
  );
  assert.match(
    env.NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S ?? "",
    /e13fd947e846d3d306e9249dd3c73d14931b6494803dbafb16cef85e6add9506/
  );
});
