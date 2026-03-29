import { describe, expect, it, vi } from "vitest";

import { OpenCodeBaseUrlResolver } from "../../src/config/opencode-base-url-resolver.js";

describe("OpenCodeBaseUrlResolver", () => {
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

    const spawnSync = vi.fn((command: string) => {
      if (command === "powershell") {
        return {
          status: 0,
          stdout:
            "8124 \"C:\\Program Files\\nodejs\\node.exe\" \"C:\\Users\\jackson\\AppData\\Roaming\\npm\\node_modules\\opencode-ai\\bin\\opencode.js\" serve --print-logs"
        };
      }

      if (command === "netstat") {
        return {
          status: 0,
          stdout: "  TCP    127.0.0.1:41827    0.0.0.0:0    LISTENING    8124"
        };
      }

      return {
        status: 1,
        stdout: ""
      };
    });

    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawnSync
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
      expect(spawnSync).toHaveBeenCalledWith(
        "powershell",
        expect.any(Array),
        expect.objectContaining({
          encoding: "utf8",
          windowsHide: true
        })
      );
      expect(spawnSync).toHaveBeenCalledWith(
        "netstat",
        ["-ano", "-p", "tcp"],
        expect.objectContaining({
          encoding: "utf8",
          windowsHide: true
        })
      );
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
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
    const spawnSync = vi.fn((command: string) => {
      if (command === "powershell") {
        return {
          status: 0,
          stdout:
            "8124 \"C:\\Users\\jackson\\AppData\\Local\\OpenCode\\opencode-cli.exe\" --print-logs serve --hostname 127.0.0.1 --port 57546"
        };
      }

      if (command === "netstat") {
        return {
          status: 0,
          stdout: "  TCP    127.0.0.1:57546    0.0.0.0:0    LISTENING    8124"
        };
      }

      return {
        status: 1,
        stdout: ""
      };
    });
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
      spawn,
      spawnSync
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
      vi.doUnmock("node:child_process");
      vi.resetModules();
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

    try {
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
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });
});
