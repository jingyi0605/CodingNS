import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenCodeBaseUrlResolver } from "../../src/config/opencode-base-url-resolver.js";

describe("OpenCodeBaseUrlResolver", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const target = tempDirs.pop();

      if (target) {
        rmSync(target, { recursive: true, force: true });
      }
    }

    vi.doUnmock("node:child_process");
    vi.doUnmock("../../src/config/opencode-system-probe-helper-client.js");
    vi.resetModules();
  });

  it("会自动发现本机可用的 opencode serve 地址", async () => {
    const inspectProcessList = vi.fn(
      () =>
        [
          "79133 node /opt/homebrew/bin/opencode serve --print-logs",
          "79333 /opt/homebrew/lib/node_modules/opencode-ai/bin/.opencode serve --print-logs"
        ].join("\n")
    );
    const inspectListeningSockets = vi.fn((pid: number) => {
      if (pid === 79133) {
        return [{ hostname: "127.0.0.1", port: 41827 }];
      }

      if (pid === 79333) {
        return [{ hostname: "127.0.0.1", port: 4098 }];
      }

      return [];
    });
    const probeBaseUrl = vi.fn(async (baseUrl: string) => baseUrl === "http://127.0.0.1:41827");
    const resolver = new OpenCodeBaseUrlResolver({
      inspectProcessList,
      inspectListeningSockets,
      probeBaseUrl
    });

    await expect(resolver.resolve()).resolves.toBe("http://127.0.0.1:41827");
    await expect(resolver.resolve()).resolves.toBe("http://127.0.0.1:41827");

    expect(inspectProcessList).toHaveBeenCalledTimes(1);
    expect(inspectListeningSockets).toHaveBeenCalledTimes(2);
  });

  it("refresh 会在旧地址失效后切换到新的 serve 端口", async () => {
    let processList = "100 /opt/homebrew/bin/.opencode serve --print-logs";
    let healthyUrl = "http://127.0.0.1:4098";
    const resolver = new OpenCodeBaseUrlResolver({
      inspectProcessList: () => processList,
      inspectListeningSockets: (pid) => {
        if (pid === 100) {
          return [{ hostname: "127.0.0.1", port: 4098 }];
        }

        if (pid === 200) {
          return [{ hostname: "127.0.0.1", port: 41827 }];
        }

        return [];
      },
      probeBaseUrl: async (baseUrl: string) => baseUrl === healthyUrl
    });

    await expect(resolver.resolve()).resolves.toBe("http://127.0.0.1:4098");

    processList = "200 /opt/homebrew/bin/.opencode serve --print-logs";
    healthyUrl = "http://127.0.0.1:41827";

    await expect(resolver.resolve({ refresh: true })).resolves.toBe("http://127.0.0.1:41827");
  });

  it("指定 workspacePath 时只会复用 cwd 匹配的 opencode serve 进程", async () => {
    const resolver = new OpenCodeBaseUrlResolver({
      inspectProcessList: () =>
        [
          "79133 node /opt/homebrew/bin/opencode serve --print-logs",
          "79333 /opt/homebrew/lib/node_modules/opencode-ai/bin/.opencode serve --print-logs"
        ].join("\n"),
      inspectListeningSockets: (pid) => {
        if (pid === 79133) {
          return [{ hostname: "127.0.0.1", port: 41827 }];
        }

        if (pid === 79333) {
          return [{ hostname: "127.0.0.1", port: 4098 }];
        }

        return [];
      },
      inspectProcessCwd: (pid) => {
        if (pid === 79133) {
          return "/Users/jackson/Code/CodingNS";
        }

        if (pid === 79333) {
          return "/Users/jackson/Code/MDG-BussInfo";
        }

        return null;
      },
      probeBaseUrl: async () => true
    });

    await expect(
      resolver.resolve({ workspacePath: "/Users/jackson/Code/MDG-BussInfo" })
    ).resolves.toBe("http://127.0.0.1:4098");
  });

  it("Windows 鎸囧畾 workspacePath 浣嗘棤娉曡幏鍙?cwd 鏃朵粛浼氬垪鍑哄仴搴风殑 serve 鍦板潃", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32"
    });

    const resolver = new OpenCodeBaseUrlResolver({
      inspectProcessList: () =>
        [
          "8124 C:\\Users\\jackson\\AppData\\Local\\OpenCode\\opencode-cli.exe serve --hostname 127.0.0.1 --port 0 --print-logs",
          "9216 C:\\Users\\jackson\\AppData\\Local\\OpenCode\\opencode-cli.exe serve --hostname 127.0.0.1 --port 0 --print-logs"
        ].join("\n"),
      inspectListeningSockets: (pid) => {
        if (pid === 8124) {
          return [{ hostname: "127.0.0.1", port: 4096 }];
        }

        if (pid === 9216) {
          return [{ hostname: "127.0.0.1", port: 51575 }];
        }

        return [];
      },
      inspectProcessCwd: () => null,
      probeBaseUrl: async (baseUrl) => {
        return baseUrl === "http://127.0.0.1:4096" || baseUrl === "http://127.0.0.1:51575";
      }
    });

    try {
      await expect(
        resolver.listReachableBaseUrls({ workspacePath: "C:\\Users\\jackson\\TEST02" })
      ).resolves.toEqual([
        "http://127.0.0.1:51575",
        "http://127.0.0.1:4096"
      ]);
    } finally {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: originalPlatform
      });
    }
  });

  it("手工配置 baseUrl 时会直接使用配置值", async () => {
    const resolver = new OpenCodeBaseUrlResolver({
      configuredBaseUrl: "http://127.0.0.1:5001"
    });

    await expect(resolver.resolve()).resolves.toBe("http://127.0.0.1:5001");
  });

  it("找不到健康的 opencode serve 进程时不会回落到默认端口", async () => {
    const resolver = new OpenCodeBaseUrlResolver({
      inspectProcessList: () =>
        "79133 node /opt/homebrew/bin/opencode serve --print-logs",
      inspectListeningSockets: () => [{ hostname: "127.0.0.1", port: 41827 }],
      probeBaseUrl: async () => false
    });

    await expect(resolver.resolve()).rejects.toThrow("SERVER_UNAVAILABLE");
  });

  it("在 Windows 下会通过 powershell 和 netstat 自动发现 opencode serve 地址", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32"
    });

    vi.resetModules();
    const readProcessList = vi.fn(async () => {
      return "8124 \"C:\\Program Files\\nodejs\\node.exe\" \"C:\\Users\\jackson\\AppData\\Roaming\\npm\\node_modules\\opencode-ai\\bin\\opencode.js\" serve --print-logs";
    });
    const readListeningSockets = vi.fn(async (pid: number) => {
      if (pid === 8124) {
        return [{ hostname: "127.0.0.1", port: 41827 }];
      }

      return [];
    });
    const readProcessCwd = vi.fn(async () => null);
    vi.doMock("../../src/config/opencode-system-probe-helper-client.js", () => ({
      getSharedOpenCodeSystemProbeHelperClient: () => ({
        readProcessList,
        readListeningSockets,
        readProcessCwd
      })
    }));

    try {
      const { OpenCodeBaseUrlResolver: WindowsResolver } = await import(
        "../../src/config/opencode-base-url-resolver.js"
      );
      const probeBaseUrl = vi.fn(async (baseUrl: string) => {
        return baseUrl === "http://127.0.0.1:41827";
      });
      const resolver = new WindowsResolver({
        probeBaseUrl
      });

      await expect(resolver.resolve()).resolves.toBe("http://127.0.0.1:41827");
      expect(readProcessList).toHaveBeenCalledTimes(1);
      expect(readListeningSockets).toHaveBeenCalledWith(8124);
      expect(readProcessCwd).toHaveBeenCalledWith(8124);
    } finally {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: originalPlatform
      });
    }
  });

  it("在 Windows 下现有 OpenCode server 不可访问时会拉起托管 serve 兜底", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32"
    });

    vi.resetModules();

    const stdoutHandlers: Array<(chunk: string) => void> = [];
    const stderrHandlers: Array<(chunk: string) => void> = [];
    const exitHandlers: Array<() => void> = [];
    const errorHandlers: Array<() => void> = [];
    const spawn = vi.fn(() => {
      const child = {
        killed: false,
        stdout: {
          on: (event: string, handler: (chunk: string) => void) => {
            if (event === "data") {
              stdoutHandlers.push(handler);
            }
          },
          off: vi.fn()
        },
        stderr: {
          on: (event: string, handler: (chunk: string) => void) => {
            if (event === "data") {
              stderrHandlers.push(handler);
            }
          },
          off: vi.fn()
        },
        once: (event: string, handler: () => void) => {
          if (event === "exit") {
            exitHandlers.push(handler);
          }

          if (event === "error") {
            errorHandlers.push(handler);
          }
        },
        off: vi.fn(),
        kill: vi.fn(() => {
          child.killed = true;
        })
      };

      queueMicrotask(() => {
        for (const handler of stdoutHandlers) {
          handler("opencode server listening on http://127.0.0.1:4096\n");
        }
      });

      return child;
    });

    vi.doMock("node:child_process", () => ({
      spawn
    }));

    try {
      const { OpenCodeBaseUrlResolver: WindowsResolver } = await import(
        "../../src/config/opencode-base-url-resolver.js"
      );
      const probeBaseUrl = vi.fn(async (baseUrl: string) => {
        return baseUrl === "http://127.0.0.1:4096";
      });
      const resolver = new WindowsResolver({
        commandPath: "C:\\Users\\jackson\\AppData\\Local\\OpenCode\\opencode-cli.exe",
        inspectProcessList: async () => {
          return "8124 \"C:\\Users\\jackson\\AppData\\Local\\OpenCode\\opencode-cli.exe\" --print-logs serve --hostname 127.0.0.1 --port 57546";
        },
        inspectListeningSockets: async () => [{ hostname: "127.0.0.1", port: 57546 }],
        inspectProcessCwd: async () => null,
        probeBaseUrl
      });

      await expect(resolver.resolve()).resolves.toBe("http://127.0.0.1:4096");
      expect(spawn).toHaveBeenCalledWith(
        "C:\\Users\\jackson\\AppData\\Local\\OpenCode\\opencode-cli.exe",
        ["serve", "--hostname", "127.0.0.1", "--port", "0", "--print-logs"],
        expect.objectContaining({
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true
        })
      );
    } finally {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: originalPlatform
      });
    }
  });

  it("在非 Windows 下发现不到匹配工作区的 server 时，会按目标工作区 cwd 拉起托管 serve", async () => {
    vi.resetModules();

    const stdoutHandlers: Array<(chunk: string) => void> = [];
    const stderrHandlers: Array<(chunk: string) => void> = [];
    const exitHandlers: Array<() => void> = [];
    const errorHandlers: Array<() => void> = [];
    const spawnSync = vi.fn(() => ({
      status: 0,
      stdout: ""
    }));
    const spawn = vi.fn(() => {
      const child = {
        killed: false,
        stdout: {
          on: (event: string, handler: (chunk: string) => void) => {
            if (event === "data") {
              stdoutHandlers.push(handler);
            }
          },
          off: vi.fn()
        },
        stderr: {
          on: (event: string, handler: (chunk: string) => void) => {
            if (event === "data") {
              stderrHandlers.push(handler);
            }
          },
          off: vi.fn()
        },
        once: (event: string, handler: () => void) => {
          if (event === "exit") {
            exitHandlers.push(handler);
          }

          if (event === "error") {
            errorHandlers.push(handler);
          }
        },
        off: vi.fn(),
        kill: vi.fn(() => {
          child.killed = true;
        })
      };

      queueMicrotask(() => {
        for (const handler of stdoutHandlers) {
          handler("opencode server listening on http://127.0.0.1:4312\n");
        }
      });

      return child;
    });

    vi.doMock("node:child_process", () => ({
      spawn,
      spawnSync
    }));

    const { OpenCodeBaseUrlResolver: DarwinResolver } = await import(
      "../../src/config/opencode-base-url-resolver.js"
    );
    const resolver = new DarwinResolver({
      commandPath: "/opt/homebrew/bin/opencode",
      inspectProcessList: () => "79133 node /opt/homebrew/bin/opencode serve --print-logs",
      inspectListeningSockets: () => [{ hostname: "127.0.0.1", port: 41827 }],
      inspectProcessCwd: () => "/Users/jackson/Code/CodingNS",
      probeBaseUrl: async (baseUrl: string) => baseUrl === "http://127.0.0.1:4312"
    });

    await expect(
      resolver.resolve({ workspacePath: "/Users/jackson/Code/MDG-BussInfo" })
    ).resolves.toBe("http://127.0.0.1:4312");
    expect(spawn).toHaveBeenCalledWith(
      "/opt/homebrew/bin/opencode",
      ["serve", "--hostname", "127.0.0.1", "--port", "0", "--print-logs"],
      expect.objectContaining({
        cwd: "/Users/jackson/Code/MDG-BussInfo",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      })
    );
  });

  it("工作区 runtimeHomeDir 存在 opencode 配置时，会把 MCP 配置注入托管 serve 进程环境", async () => {
    vi.resetModules();

    const runtimeHomeDir = mkdtempSync(path.join(tmpdir(), "codingns-opencode-runtime-"));
    tempDirs.push(runtimeHomeDir);
    writeFileSync(
      path.join(runtimeHomeDir, "opencode.json"),
      JSON.stringify({
        mcp: {
          "codingns-workspace-office": {
            type: "local",
            enabled: true,
            command: [
              process.execPath,
              "/mock/codingns.mjs",
              "mcp",
              "workspace-office",
              "serve",
              "--auth-file",
              "/tmp/workspace-auth.json"
            ],
            environment: {
              CODINGNS_OFFICE_MCP_AUTH_FILE: "/tmp/workspace-auth.json"
            }
          }
        }
      }, null, 2),
      "utf8"
    );

    const stdoutHandlers: Array<(chunk: string) => void> = [];
    const spawn = vi.fn((_command: string, _args: string[], options: { env?: Record<string, string> }) => {
      const child = {
        killed: false,
        stdout: {
          on: (event: string, handler: (chunk: string) => void) => {
            if (event === "data") {
              stdoutHandlers.push(handler);
            }
          },
          off: vi.fn()
        },
        stderr: {
          on: vi.fn(),
          off: vi.fn()
        },
        once: vi.fn(),
        off: vi.fn(),
        kill: vi.fn(() => {
          child.killed = true;
        })
      };

      expect(options.env?.OPENCODE_CONFIG_CONTENT).toBeTruthy();
      const parsed = JSON.parse(options.env?.OPENCODE_CONFIG_CONTENT ?? "{}") as {
        mcp?: Record<string, { command?: string[] }>;
      };
      expect(parsed.mcp?.["codingns-workspace-office"]?.command).toEqual([
        process.execPath,
        "/mock/codingns.mjs",
        "mcp",
        "workspace-office",
        "serve",
        "--auth-file",
        "/tmp/workspace-auth.json"
      ]);

      queueMicrotask(() => {
        for (const handler of stdoutHandlers) {
          handler("opencode server listening on http://127.0.0.1:4321\n");
        }
      });

      return child;
    });

    vi.doMock("node:child_process", () => ({
      spawn
    }));

    const { OpenCodeBaseUrlResolver: Resolver } = await import(
      "../../src/config/opencode-base-url-resolver.js"
    );
    const resolver = new Resolver({
      commandPath: "/opt/homebrew/bin/opencode",
      inspectProcessList: () => "",
      inspectListeningSockets: () => [],
      inspectProcessCwd: () => null,
      probeBaseUrl: async (baseUrl) => baseUrl === "http://127.0.0.1:4321"
    });

    await expect(
      resolver.resolve({
        workspacePath: "/Users/jackson/Code/CodingNS",
        runtimeHomeDir
      })
    ).resolves.toBe("http://127.0.0.1:4321");
  });

  it("dispose 会终止托管 serve，并阻止后续继续 resolve", async () => {
    vi.resetModules();

    const stdoutHandlers: Array<(chunk: string) => void> = [];
    const kill = vi.fn(() => {
      child.killed = true;
    });
    const child = {
      killed: false,
      stdout: {
        on: (event: string, handler: (chunk: string) => void) => {
          if (event === "data") {
            stdoutHandlers.push(handler);
          }
        },
        off: vi.fn()
      },
      stderr: {
        on: vi.fn(),
        off: vi.fn()
      },
      once: vi.fn(),
      off: vi.fn(),
      kill
    };
    const spawn = vi.fn(() => {
      queueMicrotask(() => {
        for (const handler of stdoutHandlers) {
          handler("opencode server listening on http://127.0.0.1:4312\n");
        }
      });

      return child;
    });

    vi.doMock("node:child_process", () => ({
      spawn
    }));

    const { OpenCodeBaseUrlResolver: Resolver } = await import(
      "../../src/config/opencode-base-url-resolver.js"
    );
    const resolver = new Resolver({
      commandPath: "/opt/homebrew/bin/opencode",
      inspectProcessList: () => "",
      inspectListeningSockets: () => [],
      inspectProcessCwd: () => null,
      probeBaseUrl: async (baseUrl: string) => baseUrl === "http://127.0.0.1:4312"
    });

    await expect(
      resolver.resolve({ workspacePath: "/Users/jackson/Code/CodingNS" })
    ).resolves.toBe("http://127.0.0.1:4312");

    resolver.dispose();

    expect(kill).toHaveBeenCalledWith("SIGTERM");
    await expect(
      resolver.resolve({ workspacePath: "/Users/jackson/Code/CodingNS", refresh: true })
    ).rejects.toThrow("SERVER_UNAVAILABLE");
  });

  it("空闲超时后会优先调用官方 instance/dispose 回收托管 serve", async () => {
    vi.resetModules();

    const stdoutHandlers: Array<(chunk: string) => void> = [];
    const kill = vi.fn(() => {
      child.killed = true;
    });
    const child = {
      pid: 4312,
      killed: false,
      stdout: {
        on: (event: string, handler: (chunk: string) => void) => {
          if (event === "data") {
            stdoutHandlers.push(handler);
          }
        },
        off: vi.fn()
      },
      stderr: {
        on: vi.fn(),
        off: vi.fn()
      },
      once: vi.fn(),
      off: vi.fn(),
      kill
    };
    const spawn = vi.fn(() => {
      queueMicrotask(() => {
        for (const handler of stdoutHandlers) {
          handler("opencode server listening on http://127.0.0.1:4312\n");
        }
      });

      return child;
    });

    vi.doMock("node:child_process", () => ({
      spawn
    }));

    const disposeManagedServerInstance = vi.fn(async () => {
      child.killed = true;
    });
    const { OpenCodeBaseUrlResolver: Resolver } = await import(
      "../../src/config/opencode-base-url-resolver.js"
    );
    const resolver = new Resolver({
      commandPath: "/opt/homebrew/bin/opencode",
      inspectProcessList: () => "",
      inspectListeningSockets: () => [],
      inspectProcessCwd: () => null,
      probeBaseUrl: async (baseUrl) => baseUrl === "http://127.0.0.1:4312",
      disposeManagedServerInstance,
      managedServerIdleTimeoutMs: 10,
      managedServerDisposeGraceMs: 0
    });

    await expect(
      resolver.resolve({ workspacePath: "/Users/jackson/Code/CodingNS" })
    ).resolves.toBe("http://127.0.0.1:4312");

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(disposeManagedServerInstance).toHaveBeenCalledWith("http://127.0.0.1:4312");
    expect(kill).not.toHaveBeenCalled();
  });

  it("官方 instance/dispose 失败时会降级 SIGTERM 回收托管 serve", async () => {
    vi.resetModules();

    const stdoutHandlers: Array<(chunk: string) => void> = [];
    const kill = vi.fn(() => {
      child.killed = true;
    });
    const child = {
      pid: 4313,
      killed: false,
      stdout: {
        on: (event: string, handler: (chunk: string) => void) => {
          if (event === "data") {
            stdoutHandlers.push(handler);
          }
        },
        off: vi.fn()
      },
      stderr: {
        on: vi.fn(),
        off: vi.fn()
      },
      once: vi.fn(),
      off: vi.fn(),
      kill
    };
    const spawn = vi.fn(() => {
      queueMicrotask(() => {
        for (const handler of stdoutHandlers) {
          handler("opencode server listening on http://127.0.0.1:4313\n");
        }
      });

      return child;
    });

    vi.doMock("node:child_process", () => ({
      spawn
    }));

    const disposeManagedServerInstance = vi.fn(async () => {
      throw new Error("dispose failed");
    });
    const { OpenCodeBaseUrlResolver: Resolver } = await import(
      "../../src/config/opencode-base-url-resolver.js"
    );
    const resolver = new Resolver({
      commandPath: "/opt/homebrew/bin/opencode",
      inspectProcessList: () => "",
      inspectListeningSockets: () => [],
      inspectProcessCwd: () => null,
      probeBaseUrl: async (baseUrl) => baseUrl === "http://127.0.0.1:4313",
      disposeManagedServerInstance,
      managedServerIdleTimeoutMs: 10,
      managedServerDisposeGraceMs: 0
    });

    await expect(
      resolver.resolve({ workspacePath: "/Users/jackson/Code/CodingNS" })
    ).resolves.toBe("http://127.0.0.1:4313");

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(disposeManagedServerInstance).toHaveBeenCalledWith("http://127.0.0.1:4313");
    expect(kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("托管 serve 持有租约时不会因为空闲超时被回收，释放后才会进入回收", async () => {
    vi.resetModules();

    const stdoutHandlers: Array<(chunk: string) => void> = [];
    const kill = vi.fn(() => {
      child.killed = true;
    });
    const child = {
      pid: 4314,
      killed: false,
      stdout: {
        on: (event: string, handler: (chunk: string) => void) => {
          if (event === "data") {
            stdoutHandlers.push(handler);
          }
        },
        off: vi.fn()
      },
      stderr: {
        on: vi.fn(),
        off: vi.fn()
      },
      once: vi.fn(),
      off: vi.fn(),
      kill
    };
    const spawn = vi.fn(() => {
      queueMicrotask(() => {
        for (const handler of stdoutHandlers) {
          handler("opencode server listening on http://127.0.0.1:4314\n");
        }
      });

      return child;
    });

    vi.doMock("node:child_process", () => ({
      spawn
    }));

    const disposeManagedServerInstance = vi.fn(async () => {
      child.killed = true;
    });
    const { OpenCodeBaseUrlResolver: Resolver } = await import(
      "../../src/config/opencode-base-url-resolver.js"
    );
    const resolver = new Resolver({
      commandPath: "/opt/homebrew/bin/opencode",
      inspectProcessList: () => "",
      inspectListeningSockets: () => [],
      inspectProcessCwd: () => null,
      probeBaseUrl: async (baseUrl) => baseUrl === "http://127.0.0.1:4314",
      disposeManagedServerInstance,
      managedServerIdleTimeoutMs: 10,
      managedServerDisposeGraceMs: 0
    });

    await expect(
      resolver.resolve({ workspacePath: "/Users/jackson/Code/CodingNS" })
    ).resolves.toBe("http://127.0.0.1:4314");

    const leaseId = resolver.acquireManagedServerLease("/Users/jackson/Code/CodingNS");
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(disposeManagedServerInstance).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();

    resolver.releaseManagedServerLease("/Users/jackson/Code/CodingNS", leaseId);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(disposeManagedServerInstance).toHaveBeenCalledWith("http://127.0.0.1:4314");
  });
});
