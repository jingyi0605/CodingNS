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

  it("refresh 会在旧地址失效后切到新的 serve 端口", async () => {
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

  it("手工配置 baseUrl 时会直接使用配置值", async () => {
    const resolver = new OpenCodeBaseUrlResolver({
      configuredBaseUrl: "http://127.0.0.1:5001"
    });

    await expect(resolver.resolve()).resolves.toBe("http://127.0.0.1:5001");
  });

  it("找不到健康的 opencode serve 进程时不会回落默认端口", async () => {
    const resolver = new OpenCodeBaseUrlResolver({
      inspectProcessList: () =>
        "79133 node /opt/homebrew/bin/opencode serve --print-logs",
      inspectListeningSockets: () => [{ hostname: "127.0.0.1", port: 41827 }],
      probeBaseUrl: async () => false
    });

    await expect(resolver.resolve()).rejects.toThrow("SERVER_UNAVAILABLE");
  });
});
