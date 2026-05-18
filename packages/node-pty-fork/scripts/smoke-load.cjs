"use strict";

const mod = require("../lib/index.js");

if (!mod || typeof mod.spawn !== "function") {
  console.error("[codingns-node-pty] smoke test 失败：未导出 spawn。");
  process.exit(1);
}

console.log("[codingns-node-pty] smoke load 通过。");
