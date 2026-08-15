import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { createTaskManager } from "../../src/modules/tasks/task-manager.js";
import { DeepSeekHarnessSidecarManager } from "../../src/modules/sessions/deepseek-harness/deepseek-harness-sidecar-manager.js";

const FAKE_HARNESS_SCRIPT = [
  "const http=require('node:http');",
  "http.createServer((req,res)=>{let body='';req.on('data',x=>body+=x);req.on('end',()=>{const m=JSON.parse(body||'{}');res.setHeader('content-type','application/json');res.end(JSON.stringify({type:'server-response',rpcId:m.rpcId,result:{ok:true,value:{version:'0.1.0-rc.5',dshHome:process.env.DSH_HOME||null}}}))})}).listen(process.env.PORT,'127.0.0.1');"
].join("");

const FAKE_DSH_SCRIPT = [
  "import http from 'node:http';",
  "const args=process.argv.slice(2);",
  "if(args.includes('--version')){console.log('0.1.0-rc.5');process.exit(0)}",
  "if(args[0] !== 'web'){process.exit(1)}",
  "const host=args[args.indexOf('--host')+1];",
  "if(host!=='127.0.0.1'&&host!=='0.0.0.0'){process.exit(1)}",
  "const port=Number(args[args.indexOf('--port')+1]);",
  "http.createServer((req,res)=>{let body='';req.on('data',x=>body+=x);req.on('end',()=>{const m=JSON.parse(body||'{}');res.setHeader('content-type','application/json');res.end(JSON.stringify({type:'server-response',rpcId:m.rpcId,result:{ok:true,value:{version:'0.0.1'}}}))})}).listen(port,host);"
].join("");

describe("DeepSeekHarnessSidecarManager", () => {
  it("按需启动 loopback sidecar，并在 shutdown 时只回收自有进程", async () => {
    const manager = new DeepSeekHarnessSidecarManager({
      taskManager: createTaskManager(),
      commandPath: process.execPath,
      commandArgs: ["-e", FAKE_HARNESS_SCRIPT],
      startupTimeoutMs: 5_000
    });
    const ready = await manager.ensureReady();
    expect(ready.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(manager.getState()).toMatchObject({ status: "ready", harnessVersion: "0.1.0-rc.5" });
    await manager.shutdown();
    expect(manager.getState().status).toBe("stopped");
  });

  it("启动 sidecar 时会传入配置的 DSH_HOME", async () => {
    const manager = new DeepSeekHarnessSidecarManager({
      taskManager: createTaskManager(),
      commandPath: process.execPath,
      commandArgs: ["-e", FAKE_HARNESS_SCRIPT],
      env: { DSH_HOME: "/tmp/codingns-dsh-home" },
      startupTimeoutMs: 5_000
    });

    try {
      const client = await manager.createClient();
      await expect(client.describe()).resolves.toMatchObject({ dshHome: "/tmp/codingns-dsh-home" });
    } finally {
      await manager.shutdown();
    }
  });

  it("拒绝 DSH 不支持的绑定地址", async () => {
    const manager = new DeepSeekHarnessSidecarManager({
      taskManager: createTaskManager(),
      commandPath: process.execPath,
      commandArgs: ["--host=192.0.2.10"]
    });
    await expect(manager.ensureReady()).rejects.toThrow("HARNESS_BIND_HOST_UNSUPPORTED");
  });

  it("以全接口模式通过 dsh web 启动，并从 CLI 而非 host.describe 校验版本", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "codingns-dsh-"));
    const commandPath = path.join(tempDir, "dsh.mjs");
    writeFileSync(commandPath, FAKE_DSH_SCRIPT, "utf8");
    const manager = new DeepSeekHarnessSidecarManager({
      taskManager: createTaskManager(),
      commandPath,
      bindHost: "0.0.0.0",
      startupTimeoutMs: 5_000
    });

    try {
      await expect(manager.ensureReady()).resolves.toMatchObject({ harnessVersion: "0.1.0-rc.5" });
    } finally {
      await manager.shutdown();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
