import { describe, expect, it } from "vitest";

import { createTaskManager } from "../../src/modules/tasks/task-manager.js";
import { DeepSeekHarnessSidecarManager } from "../../src/modules/sessions/deepseek-harness/deepseek-harness-sidecar-manager.js";

const FAKE_HARNESS_SCRIPT = [
  "const http=require('node:http');",
  "http.createServer((req,res)=>{let body='';req.on('data',x=>body+=x);req.on('end',()=>{const m=JSON.parse(body||'{}');res.setHeader('content-type','application/json');res.end(JSON.stringify({type:'server-response',rpcId:m.rpcId,result:{ok:true,value:{version:'0.1.0-rc.5'}}}))})}).listen(process.env.PORT,'127.0.0.1');"
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

  it("拒绝非 loopback host 参数", async () => {
    const manager = new DeepSeekHarnessSidecarManager({
      taskManager: createTaskManager(),
      commandPath: process.execPath,
      commandArgs: ["--host=0.0.0.0"]
    });
    await expect(manager.ensureReady()).rejects.toThrow("HARNESS_LOOPBACK_ONLY");
  });
});
