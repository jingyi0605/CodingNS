import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

const { pptxAddImageMock } = vi.hoisted(() => ({
  pptxAddImageMock: vi.fn()
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");

  return {
    ...actual,
    spawn: ((command: string, ...args: unknown[]) => {
      const commandArgs = Array.isArray(args[0]) ? args[0] : [];
      const isPm2RestartHelper =
        command === process.execPath
        && commandArgs[0] === "-e";

      if (
        command === "npm" ||
        command === "npm.cmd" ||
        command === "pm2" ||
        command === "pm2.cmd" ||
        command === "ssh" ||
        isPm2RestartHelper
      ) {
        return spawnMock(command, ...args);
      }

      return (actual.spawn as (...input: unknown[]) => unknown)(command, ...args);
    }) as typeof actual.spawn
  };
});

vi.mock("playwright-core", () => {
  const pdfMock = vi.fn(async ({ path: outputPath }: { path: string }) => {
    writeFileSync(outputPath, "mock pdf", "utf8");
  });
  const screenshotMock = vi.fn(async () => Buffer.from("mock png"));
  let currentUrl = "about:blank";
  const gotoMock = vi.fn(async (url: string) => {
    currentUrl = url;
  });
  const innerTextMock = vi.fn(async () => "mock page body");
  const clickMock = vi.fn(async () => undefined);
  const fillMock = vi.fn(async () => undefined);
  const pressMock = vi.fn(async () => undefined);
  const selectOptionMock = vi.fn(async () => undefined);
  const setInputFilesMock = vi.fn(async () => undefined);
  const waitForEventMock = vi.fn(async () => ({
    suggestedFilename: vi.fn(async () => "download.txt"),
    saveAs: vi.fn(async (outputPath: string) => {
      writeFileSync(outputPath, "downloaded", "utf8");
    })
  }));
  const waitForTimeoutMock = vi.fn(async () => undefined);
  const evaluateMock = vi.fn(async (_callback: unknown, selectors?: unknown) => {
    if (selectors) {
      return {
        width: 1600,
        height: 900,
        pageCount: 2
      };
    }

    return [
      {
        index: 0,
        backgroundColor: "rgb(255, 255, 255)",
        elements: [
          {
            type: "text",
            box: {
              x: 120,
              y: 100,
              width: 600,
              height: 120
            },
            text: "封面",
            style: {
              fontFamily: "Arial",
              fontSizePx: 48,
              fontWeight: "700",
              fontStyle: "normal",
              color: "rgb(17, 17, 17)",
              textAlign: "center",
              backgroundColor: null
            }
          }
        ]
      },
      {
        index: 1,
        backgroundColor: "rgb(255, 255, 255)",
        elements: [
          {
            type: "text",
            box: {
              x: 120,
              y: 100,
              width: 600,
              height: 120
            },
            text: "第二页",
            style: {
              fontFamily: "Arial",
              fontSizePx: 36,
              fontWeight: "400",
              fontStyle: "normal",
              color: "rgb(17, 17, 17)",
              textAlign: "left",
              backgroundColor: null
            }
          }
        ]
      }
    ];
  });
  const waitForLoadStateMock = vi.fn(async () => undefined);
  const emulateMediaMock = vi.fn(async () => undefined);
  const setContentMock = vi.fn(async () => undefined);
  const closePageMock = vi.fn(async () => undefined);
  const locatorMock = vi.fn(() => ({
    screenshot: screenshotMock,
    click: clickMock,
    fill: fillMock,
    press: pressMock,
    selectOption: selectOptionMock,
    setInputFiles: setInputFilesMock,
    innerText: innerTextMock
  }));
  const pageMock = {
    goto: gotoMock,
    url: () => currentUrl,
    emulateMedia: emulateMediaMock,
    setContent: setContentMock,
    waitForLoadState: waitForLoadStateMock,
    waitForEvent: waitForEventMock,
    waitForTimeout: waitForTimeoutMock,
    evaluate: evaluateMock,
    pdf: pdfMock,
    locator: locatorMock,
    close: closePageMock,
    screenshot: screenshotMock,
    keyboard: {
      press: pressMock
    }
  };
  const newPageMock = vi.fn(async () => pageMock);
  const contextCloseMock = vi.fn(async () => undefined);
  const contextMock = {
    pages: vi.fn(() => []),
    newPage: newPageMock,
    close: contextCloseMock
  };
  const closeBrowserMock = vi.fn(async () => undefined);
  const launchMock = vi.fn(async () => ({
    newPage: newPageMock,
    close: closeBrowserMock
  }));
  const launchPersistentContextMock = vi.fn(async () => contextMock);
  const connectOverCDPMock = vi.fn(async () => ({
    contexts: () => [contextMock],
    newContext: vi.fn(async () => contextMock),
    close: closeBrowserMock
  }));

  return {
    chromium: {
      launch: launchMock,
      launchPersistentContext: launchPersistentContextMock,
      connectOverCDP: connectOverCDPMock
    }
  };
});

vi.mock("pptxgenjs", () => {
  class MockPptxGenJS {
    layout = "LAYOUT_WIDE";
    author = "";
    company = "";
    subject = "";
    title = "";
    lang = "";

    defineLayout(): void {}

    addSlide() {
      return {
        background: undefined as { color: string } | undefined,
        addImage: pptxAddImageMock
      };
    }

    async writeFile(options: { fileName: string }): Promise<void> {
      writeFileSync(options.fileName, "mock pptx", "utf8");
    }
  }

  return {
    default: MockPptxGenJS
  };
});

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: EmptyFixture[] = [];
const originalFetch = globalThis.fetch;
const SLOW_TEST_TIMEOUT_MS = 15_000;

beforeEach(() => {
  pptxAddImageMock.mockClear();

  vi.spyOn(os, "networkInterfaces").mockReturnValue({
    lo0: [
      {
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: true,
        cidr: "127.0.0.1/8"
      }
    ],
    en0: [
      {
        address: "192.168.50.8",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:11:22:33:44:55",
        internal: false,
        cidr: "192.168.50.8/24"
      }
    ]
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;

  while (activeServers.length > 0) {
    const server = activeServers.pop();

    if (server) {
      server.app.server.closeAllConnections?.();
      await server.app.close();
    }
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("client routes", () => {
  it("未登录时拒绝读取运行时配置", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const setupResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/public/setup",
      payload: {
        username: "admin",
        password: "admin1234"
      }
    });

    expect(setupResponse.statusCode).toBe(201);

    const response = await hosted.app.inject({
      method: "GET",
      url: "/api/client/runtime-config?platform=desktop"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error_code: "UNAUTHORIZED"
    });
  }, SLOW_TEST_TIMEOUT_MS);

  it("返回桌面端运行时配置与发布清单", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const releaseRoot = path.join(fixture.rootDir, "releases");
    const stableDir = path.join(releaseRoot, "stable");
    mkdirSync(stableDir, { recursive: true });
    writeFileSync(
      path.join(stableDir, "windows-x64.json"),
      JSON.stringify(
        {
          channel: "stable",
          platform: "windows-x64",
          version: "1.2.3",
          notes: "桌面端联调用清单",
          packageUrl: "https://example.invalid/codingns-desktop-1.2.3.msi",
          signature: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          publishedAt: "2026-03-25T10:00:00.000Z"
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(
      path.join(stableDir, "android-apk.json"),
      JSON.stringify(
        {
          channel: "stable",
          version: "1.2.3",
          versionCode: 1230,
          packageName: "com.codingns.userapp",
          fileName: "app-universal-release.apk",
          downloadUrl: "https://example.invalid/app-universal-release.apk",
          sha256: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          publishedAt: "2026-03-25T10:00:00.000Z",
          notes: "Android 直装清单"
        },
        null,
        2
      ),
      "utf8"
    );

    const hosted = createTestApp(fixture, {
      host: "127.0.0.1",
      port: 3002,
      releaseChannel: "stable",
      releaseManifestRoot: releaseRoot
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);

    await hosted.app.inject({
      method: "PUT",
      url: "/api/system/relay-tunnel/config",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        relayBaseUrl: "wss://relay.codingns.example",
        controlBaseUrl: "https://control.codingns.example",
        localTargetBaseUrl: "http://127.0.0.1:4312"
      }
    });
    await hosted.app.inject({
      method: "POST",
      url: "/api/system/relay-tunnel/bind",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        accountId: "acct_demo",
        bindingId: "binding_demo",
        tunnelDomain: "demo.codingns.example"
      }
    });

    const runtimeConfigResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/client/runtime-config?platform=desktop",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(runtimeConfigResponse.statusCode).toBe(200);
    expect(runtimeConfigResponse.json()).toEqual({
      platform: "desktop",
      hostBaseUrl: "http://127.0.0.1:3002",
      releaseChannel: "stable",
      autoReconnect: true,
      autoCheckUpdate: true,
      relayTunnel: {
        provider: "codingns_relay",
        enabled: false,
        controlBaseUrl: "https://control.codingns.example",
        tunnelDomain: "demo.codingns.example",
        bindingId: "binding_demo",
        hostFingerprint: expect.stringMatching(/^SHA256:/),
        candidateEndpoints: [
          {
            endpointId: "host_reported:http://127.0.0.1:4312",
            kind: "loopback",
            url: "http://127.0.0.1:4312",
            priority: 100,
            expiresAt: null,
            source: "host_reported"
          },
          {
            endpointId: "host_reported:http://192.168.50.8:4312",
            kind: "lan",
            url: "http://192.168.50.8:4312",
            priority: 200,
            expiresAt: null,
            source: "host_reported"
          },
          {
            endpointId: "relay:https://demo.codingns.example",
            kind: "relay",
            url: "https://demo.codingns.example",
            priority: 400,
            expiresAt: null,
            source: "host_reported"
          }
        ]
      }
    });

    const releaseManifestResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/client/release-manifest?channel=stable&platform=windows-x64",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(releaseManifestResponse.statusCode).toBe(200);
    expect(releaseManifestResponse.json()).toMatchObject({
      channel: "stable",
      platform: "windows-x64",
      version: "1.2.3"
    });

    const androidManifestResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/client/release-manifest?channel=stable&platform=android-apk",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(androidManifestResponse.statusCode).toBe(200);
    expect(androidManifestResponse.json()).toMatchObject({
      channel: "stable",
      version: "1.2.3",
      versionCode: 1230,
      packageName: "com.codingns.userapp"
    });
  }, SLOW_TEST_TIMEOUT_MS);

  it("返回服务端更新信息", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          "dist-tags": {
            latest: "0.2.0",
            beta: "0.3.0-beta.1"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    ) as typeof fetch;

    const hosted = createTestApp(fixture, {
      serverUpdatePackageName: "placeholder-server-package",
      npmRegistryBaseUrl: "https://registry.npmjs.org",
      accessTokenTtlSeconds: 30
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);
    const response = await hosted.app.inject({
      method: "GET",
      url: "/api/client/service-update?channel=stable",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      channel: "stable",
      packages: [
        expect.objectContaining({
          packageName: "placeholder-server-package",
          latestVersion: "0.2.0",
          hasUpdate: false,
          checkStatus: "up_to_date"
        })
      ]
    });
  }, SLOW_TEST_TIMEOUT_MS);

  it("开发版通道会把更高的稳定版当成服务端更新目标", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          "dist-tags": {
            latest: "1.0.0",
            beta: "1.0.0-beta.2"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    ) as typeof fetch;

    const hosted = createTestApp(fixture, {
      serverUpdatePackageName: "placeholder-server-package",
      npmRegistryBaseUrl: "https://registry.npmjs.org",
      accessTokenTtlSeconds: 30
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);
    const response = await hosted.app.inject({
      method: "GET",
      url: "/api/client/service-update?channel=beta",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      channel: "beta",
      packages: [
        expect.objectContaining({
          packageName: "placeholder-server-package",
          currentVersion: "1.0.0-beta.1",
          latestVersion: "1.0.0",
          hasUpdate: true,
          checkStatus: "ready"
        })
      ]
    });
  }, SLOW_TEST_TIMEOUT_MS);

  it("支持触发服务端全局 npm 安装任务，并调度 PM2 自动重启", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          "dist-tags": {
            latest: "1.0.1",
            beta: "1.0.1-beta.1"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    ) as typeof fetch;
    spawnMock.mockImplementation(() => createSuccessfulChildProcess("updated"));

    const hosted = createTestApp(fixture, {
      serverUpdatePackageName: "placeholder-server-package",
      npmRegistryBaseUrl: "https://registry.npmjs.org",
      accessTokenTtlSeconds: 30
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);
    const installResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/client/service-update/install",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        packageName: "placeholder-server-package",
        channel: "stable"
      }
    });

    expect(installResponse.statusCode).toBe(200);
    const task = installResponse.json() as {
      taskId: string;
      packageName: string;
      status: string;
    };
    expect(task.packageName).toBe("placeholder-server-package");

    await flushAsyncWork();

    const taskResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/client/service-update/tasks/${task.taskId}`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(taskResponse.statusCode).toBe(200);
    expect(taskResponse.json()).toMatchObject({
      taskId: task.taskId,
      packageName: "placeholder-server-package",
      targetVersion: "1.0.1",
      status: "succeeded",
      restartRequired: false,
      restartScheduled: true,
      restartDelayMs: 3000
    });

    const listResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/client/service-update?channel=stable",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      packages: [
        expect.objectContaining({
          packageName: "placeholder-server-package",
          latestVersion: "1.0.1",
          hasUpdate: true,
          restartRequired: false,
          installTask: expect.objectContaining({
            taskId: task.taskId,
            status: "succeeded",
            restartRequired: false,
            restartScheduled: true,
            restartDelayMs: 3000
          })
        })
      ]
    });
    expect(spawnMock).toHaveBeenCalledWith(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["install", "-g", "placeholder-server-package@latest"],
      expect.objectContaining({
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      })
    );
    expect(spawnMock).toHaveBeenCalledWith(
      process.platform === "win32" ? "pm2.cmd" : "pm2",
      ["describe", "codingns"],
      expect.objectContaining({
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      })
    );
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([
        "-e",
        expect.any(String),
        "3000",
        process.platform === "win32" ? "pm2.cmd" : "pm2",
        "codingns"
      ]),
      expect.objectContaining({
        stdio: "ignore",
        windowsHide: true,
        detached: true
      })
    );
  });

  it("开发版通道安装服务端更新时会优先安装更高的稳定版", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          "dist-tags": {
            latest: "1.0.0",
            beta: "1.0.0-beta.2"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    ) as typeof fetch;
    spawnMock.mockImplementation(() => createSuccessfulChildProcess("updated"));

    const hosted = createTestApp(fixture, {
      serverUpdatePackageName: "placeholder-server-package",
      npmRegistryBaseUrl: "https://registry.npmjs.org",
      accessTokenTtlSeconds: 30
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);
    const installResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/client/service-update/install",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        packageName: "placeholder-server-package",
        channel: "beta"
      }
    });

    expect(installResponse.statusCode).toBe(200);
    const task = installResponse.json() as {
      taskId: string;
      packageName: string;
      status: string;
    };
    expect(task.packageName).toBe("placeholder-server-package");

    await flushAsyncWork();

    const taskResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/client/service-update/tasks/${task.taskId}`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(taskResponse.statusCode).toBe(200);
    expect(taskResponse.json()).toMatchObject({
      taskId: task.taskId,
      packageName: "placeholder-server-package",
      channel: "beta",
      targetVersion: "1.0.0",
      status: "succeeded",
      restartRequired: false,
      restartScheduled: true,
      restartDelayMs: 3000
    });

    expect(spawnMock).toHaveBeenCalledWith(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["install", "-g", "placeholder-server-package@latest"],
      expect.objectContaining({
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      })
    );
  });

  it("支持注册并读取文档模板", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);
    const createResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/office/document-templates",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        templateKey: "team.doct.memo",
        displayName: "团队备忘录模板",
        templateVersion: "v1",
        schema: {
          requiredFields: ["title", "body"],
          optionalFields: ["summary", "references"]
        },
        mapping: {
          title: "document.title",
          summary: "revision.summary",
          sections: "content.blocks",
          references: "content.references"
        },
        outputFormats: ["docx", "md"]
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toMatchObject({
      id: "team.doct.memo@v1",
      templateKey: "team.doct.memo",
      displayName: "团队备忘录模板",
      templateVersion: "v1"
    });

    const getResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/office/document-templates/team.doct.memo@v1",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({
      id: "team.doct.memo@v1",
      templateKey: "team.doct.memo",
      displayName: "团队备忘录模板"
    });

    const listResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/office/document-templates",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "team.doct.memo@v1",
          templateKey: "team.doct.memo"
        })
      ])
    );
  });

  it("拒绝重复注册同 key 同版本的文档模板", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);
    const payload = {
      templateKey: "dup.doct.memo",
      displayName: "重复模板",
      templateVersion: "v1",
      schema: {
        requiredFields: ["title", "body"],
        optionalFields: []
      },
      mapping: {
        title: "document.title",
        sections: "content.blocks"
      },
      outputFormats: ["docx"]
    };

    const firstResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/office/document-templates",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload
    });

    expect(firstResponse.statusCode).toBe(201);

    const secondResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/office/document-templates",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload
    });

    expect(secondResponse.statusCode).toBe(409);
    expect(secondResponse.json()).toMatchObject({
      error_code: "DOCUMENT_TEMPLATE_VERSION_EXISTS"
    });
  });

  it("拒绝缺少必填映射的文档模板", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);
    const response = await hosted.app.inject({
      method: "POST",
      url: "/api/office/document-templates",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        templateKey: "invalid.doct.memo",
        displayName: "坏模板",
        templateVersion: "v1",
        schema: {
          requiredFields: ["title", "body"],
          optionalFields: []
        },
        mapping: {
          title: "document.title"
        },
        outputFormats: ["docx"]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error_code: "DOCUMENT_TEMPLATE_MAPPING_REQUIRED_FIELD_MISSING"
    });
  }, SLOW_TEST_TIMEOUT_MS);

  it("支持更新文档模板并立即读取新配置", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);
    const createResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/office/document-templates",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        templateKey: "update.doct.memo",
        displayName: "更新前模板",
        templateVersion: "v1",
        schema: {
          requiredFields: ["title", "body"],
          optionalFields: ["summary"]
        },
        mapping: {
          title: "document.title",
          sections: "content.blocks"
        },
        outputFormats: ["docx"]
      }
    });

    expect(createResponse.statusCode).toBe(201);

    const updateResponse = await hosted.app.inject({
      method: "PATCH",
      url: "/api/office/document-templates/update.doct.memo@v1",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        displayName: "更新后模板",
        schema: {
          requiredFields: ["title", "body", "summary"],
          optionalFields: []
        },
        mapping: {
          title: "content.exportTitle",
          summary: "content.exportSummary",
          sections: "content.customSections"
        },
        outputFormats: ["docx", "md"],
        status: "deprecated"
      }
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      id: "update.doct.memo@v1",
      displayName: "更新后模板",
      status: "deprecated"
    });

    const getResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/office/document-templates/update.doct.memo@v1",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(getResponse.statusCode).toBe(200);
    const updated = getResponse.json() as {
      displayName: string;
      schemaJson: string;
      mappingJson: string;
      outputFormatsJson: string;
      status: string;
    };
    expect(updated.displayName).toBe("更新后模板");
    expect(updated.status).toBe("deprecated");
    expect(updated.schemaJson).toContain("\"summary\"");
    expect(updated.mappingJson).toContain("content.customSections");
    expect(updated.outputFormatsJson).toContain("\"md\"");
  }, SLOW_TEST_TIMEOUT_MS);

  it("拒绝使用 deprecated 模板创建新文档", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);
    const createTemplateResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/office/document-templates",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        templateKey: "deprecated.doct.memo",
        displayName: "废弃模板",
        templateVersion: "v1",
        schema: {
          requiredFields: ["title", "body"],
          optionalFields: []
        },
        mapping: {
          title: "document.title",
          sections: "content.blocks"
        },
        outputFormats: ["docx"]
      }
    });

    expect(createTemplateResponse.statusCode).toBe(201);

    const deprecateResponse = await hosted.app.inject({
      method: "PATCH",
      url: "/api/office/document-templates/deprecated.doct.memo@v1",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        status: "deprecated"
      }
    });

    expect(deprecateResponse.statusCode).toBe(200);

    const createDocumentResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/office/documents",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        title: "不能创建",
        templateId: "deprecated.doct.memo@v1",
        content: {
          blocks: [
            {
              heading: "正文",
              body: "正文"
            }
          ]
        }
      }
    });

    expect(createDocumentResponse.statusCode).toBe(409);
    expect(createDocumentResponse.json()).toMatchObject({
      error_code: "DOCUMENT_TEMPLATE_NOT_ACTIVE"
    });
  });

  it("支持按 templateKey 选择最新模板版本，并允许同 key 切换版本", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);
    const commonHeaders = {
      authorization: `Bearer ${tokens.accessToken}`
    };

    const registerTemplate = async (payload: {
      templateKey: string;
      displayName: string;
      templateVersion: string;
    }) => hosted.app.inject({
      method: "POST",
      url: "/api/office/document-templates",
      headers: commonHeaders,
      payload: {
        ...payload,
        schema: {
          requiredFields: ["title", "body"],
          optionalFields: ["summary"]
        },
        mapping: {
          title: "document.title",
          sections: "content.blocks"
        },
        outputFormats: ["docx"]
      }
    });

    expect((await registerTemplate({
      templateKey: "switch.doct.memo",
      displayName: "切版模板 v1",
      templateVersion: "v1"
    })).statusCode).toBe(201);

    expect((await registerTemplate({
      templateKey: "switch.doct.memo",
      displayName: "切版模板 v2",
      templateVersion: "v2"
    })).statusCode).toBe(201);

    expect((await registerTemplate({
      templateKey: "other.doct.memo",
      displayName: "其他模板 v1",
      templateVersion: "v1"
    })).statusCode).toBe(201);

    const createDocumentResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/office/documents",
      headers: commonHeaders,
      payload: {
        title: "按 key 创建的文档",
        templateKey: "switch.doct.memo",
        content: {
          blocks: [
            {
              heading: "正文",
              body: "正文内容"
            }
          ]
        }
      }
    });

    expect(createDocumentResponse.statusCode).toBe(200);
    expect(createDocumentResponse.json()).toMatchObject({
      document: {
        title: "按 key 创建的文档",
        templateId: "switch.doct.memo@v2"
      },
      template: {
        id: "switch.doct.memo@v2",
        templateKey: "switch.doct.memo",
        templateVersion: "v2"
      }
    });

    const documentId = createDocumentResponse.json().document.id as string;

    const switchVersionResponse = await hosted.app.inject({
      method: "PATCH",
      url: `/api/office/documents/${documentId}`,
      headers: commonHeaders,
      payload: {
        templateId: "switch.doct.memo@v1"
      }
    });

    expect(switchVersionResponse.statusCode).toBe(200);
    expect(switchVersionResponse.json()).toMatchObject({
      document: {
        id: documentId,
        templateId: "switch.doct.memo@v1"
      },
      template: {
        id: "switch.doct.memo@v1",
        templateKey: "switch.doct.memo",
        templateVersion: "v1"
      }
    });

    const switchKeyResponse = await hosted.app.inject({
      method: "PATCH",
      url: `/api/office/documents/${documentId}`,
      headers: commonHeaders,
      payload: {
        templateId: "other.doct.memo@v1"
      }
    });

    expect(switchKeyResponse.statusCode).toBe(409);
    expect(switchKeyResponse.json()).toMatchObject({
      error_code: "DOCUMENT_TEMPLATE_KEY_SWITCH_NOT_ALLOWED"
    });
  });

  it("按 templateKey 创建文档时会跳过已废弃的最新版本", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);
    const headers = {
      authorization: `Bearer ${tokens.accessToken}`
    };

    const createTemplateV1 = await hosted.app.inject({
      method: "POST",
      url: "/api/office/document-templates",
      headers,
      payload: {
        templateKey: "fallback-active.doct.memo",
        displayName: "可用模板 v1",
        templateVersion: "v1",
        schema: {
          requiredFields: ["title", "body"],
          optionalFields: []
        },
        mapping: {
          title: "document.title",
          sections: "content.blocks"
        },
        outputFormats: ["docx"]
      }
    });

    expect(createTemplateV1.statusCode).toBe(201);

    const createTemplateV2 = await hosted.app.inject({
      method: "POST",
      url: "/api/office/document-templates",
      headers,
      payload: {
        templateKey: "fallback-active.doct.memo",
        displayName: "废弃模板 v2",
        templateVersion: "v2",
        schema: {
          requiredFields: ["title", "body"],
          optionalFields: []
        },
        mapping: {
          title: "document.title",
          sections: "content.blocks"
        },
        outputFormats: ["docx"],
        status: "deprecated"
      }
    });

    expect(createTemplateV2.statusCode).toBe(201);

    const createDocumentResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/office/documents",
      headers,
      payload: {
        title: "应命中可用旧版本",
        templateKey: "fallback-active.doct.memo",
        content: {
          blocks: [
            {
              heading: "正文",
              body: "内容"
            }
          ]
        }
      }
    });

    expect(createDocumentResponse.statusCode).toBe(200);
    expect(createDocumentResponse.json()).toMatchObject({
      document: {
        templateId: "fallback-active.doct.memo@v1"
      },
      template: {
        id: "fallback-active.doct.memo@v1",
        status: "active"
      }
    });
  });

  it("按 templateKey 选择模板时会按真实版本顺序处理 v10 和 v2", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);
    const headers = {
      authorization: `Bearer ${tokens.accessToken}`
    };

    const registerTemplate = async (templateVersion: string) => hosted.app.inject({
      method: "POST",
      url: "/api/office/document-templates",
      headers,
      payload: {
        templateKey: "semver.doct.memo",
        displayName: `版本 ${templateVersion}`,
        templateVersion,
        schema: {
          requiredFields: ["title", "body"],
          optionalFields: []
        },
        mapping: {
          title: "document.title",
          sections: "content.blocks"
        },
        outputFormats: ["docx"]
      }
    });

    expect((await registerTemplate("v2")).statusCode).toBe(201);
    expect((await registerTemplate("v10")).statusCode).toBe(201);

    const listResponse = await hosted.app.inject({
      method: "GET",
      url: "/api/office/document-templates",
      headers
    });

    expect(listResponse.statusCode).toBe(200);
    const semverTemplates = (listResponse.json().items as Array<{
      id: string;
      templateKey: string;
      templateVersion: string;
    }>).filter((item) => item.templateKey === "semver.doct.memo");
    expect(semverTemplates.map((item) => item.templateVersion)).toEqual(["v10", "v2"]);

    const createDocumentResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/office/documents",
      headers,
      payload: {
        title: "版本排序文档",
        templateKey: "semver.doct.memo",
        content: {
          blocks: [
            {
              heading: "正文",
              body: "版本选择正文"
            }
          ]
        }
      }
    });

    expect(createDocumentResponse.statusCode).toBe(200);
    expect(createDocumentResponse.json()).toMatchObject({
      document: {
        templateId: "semver.doct.memo@v10"
      },
      template: {
        templateVersion: "v10"
      }
    });
  });

  it("发布清单缺失时返回 MANIFEST_NOT_FOUND", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture, {
      releaseManifestRoot: path.join(fixture.rootDir, "releases")
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);

    const response = await hosted.app.inject({
      method: "GET",
      url: "/api/client/release-manifest?channel=stable&platform=windows-x64",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error_code).toBe("MANIFEST_NOT_FOUND");
  });

  it("可以创建并查询静态 HTML 演示文档 PDF 导出任务", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    writeFileSync(
      path.join(fixture.workspaceDir, "slides.html"),
      "<!doctype html><html><body><section class=\"slide\">封面</section><section class=\"slide\">第二页</section></body></html>",
      "utf8"
    );

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);
    const importResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Presentation Workspace"
      }
    });

    expect(importResponse.statusCode).toBe(201);
    const workspaceId = importResponse.json().id as string;

    const createResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/presentation-exports",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        workspaceId,
        path: "slides.html",
        htmlContent: "<!doctype html><html><body><section class=\"slide\">封面</section><section class=\"slide\">第二页</section></body></html>"
      }
    });

    expect(createResponse.statusCode).toBe(202);
    const createdTask = createResponse.json() as {
      taskId: string;
      status: string;
      outputPath: string | null;
    };
    expect(createdTask.status === "queued" || createdTask.status === "running" || createdTask.status === "succeeded").toBe(true);

    await flushAsyncWork();

    const taskResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/presentation-exports/${createdTask.taskId}`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(taskResponse.statusCode).toBe(200);
    expect(taskResponse.json()).toMatchObject({
      taskId: createdTask.taskId,
      workspaceId,
      sourcePath: "slides.html",
      format: "pdf",
      status: "succeeded",
      outputPath: expect.stringContaining("slides.pdf")
    });

    const downloadResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/presentation-exports/${createdTask.taskId}/download`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(downloadResponse.statusCode).toBe(200);
    expect(downloadResponse.headers["content-disposition"]).toContain("attachment");
    expect(downloadResponse.headers["content-disposition"]).toContain("slides.pdf");
  }, SLOW_TEST_TIMEOUT_MS);

  it("可以创建并查询静态 HTML 演示文档 PPTX 导出任务", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    writeFileSync(
      path.join(fixture.workspaceDir, "slides-pptx.html"),
      "<!doctype html><html><body><section class=\"slide\">封面</section><section class=\"slide\">第二页</section></body></html>",
      "utf8"
    );

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);
    const importResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        path: fixture.workspaceDir,
        name: "Presentation PPTX Workspace"
      }
    });

    expect(importResponse.statusCode).toBe(201);
    const workspaceId = importResponse.json().id as string;

    const createResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/presentation-exports",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        workspaceId,
        path: "slides-pptx.html",
        format: "pptx",
        htmlContent: "<!doctype html><html><body><section class=\"slide\">封面</section><section class=\"slide\">第二页</section></body></html>"
      }
    });

    expect(createResponse.statusCode).toBe(202);
    const createdTask = createResponse.json() as {
      taskId: string;
      status: string;
    };
    expect(createdTask.status === "queued" || createdTask.status === "running" || createdTask.status === "succeeded").toBe(true);

    await flushAsyncWork();

    const taskResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/presentation-exports/${createdTask.taskId}`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(taskResponse.statusCode).toBe(200);
    expect(taskResponse.json()).toMatchObject({
      taskId: createdTask.taskId,
      workspaceId,
      sourcePath: "slides-pptx.html",
      format: "pptx",
      status: "succeeded",
      outputPath: expect.stringContaining("slides-pptx.pptx")
    });
    expect(pptxAddImageMock).not.toHaveBeenCalled();

    const downloadResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/presentation-exports/${createdTask.taskId}/download`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(downloadResponse.statusCode).toBe(200);
    expect(downloadResponse.headers["content-disposition"]).toContain("attachment");
    expect(downloadResponse.headers["content-disposition"]).toContain("slides-pptx.pptx");
  }, SLOW_TEST_TIMEOUT_MS);

  it("在没有 doct 时仍然可以导出真实 docx 文档", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture, {
      doctCliPath: "definitely-missing-doct"
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);

    const documentResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/office/documents",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        title: "导出测试文档",
        templateId: "default.doct.standard@v1",
        summary: "这是导出摘要",
        content: {
          references: [
            {
              title: "OpenAI API 文档",
              sourceRef: "https://platform.openai.com/docs/api-reference",
              quoteText: "Responses API 支持结构化输出。",
              targetAnchorKey: "section-1"
            }
          ],
          blocks: [
            {
              heading: "第一节",
              body: "第一段正文。\n\n第二段正文。"
            }
          ]
        }
      }
    });

    expect(documentResponse.statusCode).toBe(200);
    const documentId = documentResponse.json().document.id as string;

    const commentResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/office/documents/${documentId}/comments`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        anchorType: "section",
        anchorKey: "section-1",
        body: "这里需要保留原始引用。"
      }
    });

    expect(commentResponse.statusCode).toBe(200);

    const deprecateTemplateResponse = await hosted.app.inject({
      method: "PATCH",
      url: "/api/office/document-templates/default.doct.standard@v1",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        status: "deprecated"
      }
    });

    expect(deprecateTemplateResponse.statusCode).toBe(200);

    const createTaskResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/office/documents/${documentId}/export`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        format: "docx"
      }
    });

    expect(createTaskResponse.statusCode).toBe(200);
    const exportTaskId = createTaskResponse.json().task.id as string;

    const executeResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/office/document-tasks/${exportTaskId}/execute`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(executeResponse.statusCode).toBe(200);

    const taskDetail = await waitForOfficeTask(hosted, tokens.accessToken, exportTaskId);

    expect(taskDetail.task.status).toBe("succeeded");
    expect(taskDetail.artifacts).toHaveLength(1);
    expect(taskDetail.artifacts[0]?.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(taskDetail.artifacts[0]?.metadataJson).toContain("\"engine\":\"python-docx-fallback\"");
    expect(taskDetail.artifacts[0]?.metadataJson).toContain("\"proofVersion\":1");
    expect(taskDetail.artifacts[0]?.metadataJson).toContain("\"templateId\":\"default.doct.standard@v1\"");
    expect(taskDetail.artifacts[0]?.metadataJson).toContain("\"revisionSeq\":1");
    expect(taskDetail.artifacts[0]?.metadataJson).toContain("\"payloadSha256\":");
    expect(taskDetail.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          receiptType: "document_export",
          payloadJson: expect.stringContaining("\"templateId\":\"default.doct.standard@v1\"")
        })
      ])
    );
    expect(taskDetail.receipts[0]?.payloadJson).toContain("\"artifactId\":");
    expect(taskDetail.receipts[0]?.payloadJson).toContain("\"engine\":\"python-docx-fallback\"");
    expect(taskDetail.receipts[0]?.payloadJson).toContain("\"payloadSha256\":");

    const artifactPath = taskDetail.artifacts[0]!.storagePath;
    const artifactBytes = readFileSync(artifactPath);
    expect(artifactBytes.subarray(0, 2).toString("utf8")).toBe("PK");
    const documentXml = await readDocxDocumentXml(artifactPath);
    expect(documentXml).toContain("OpenAI API 文档");
    expect(documentXml).toContain("这里需要保留原始引用");
  });

  it("会按模板 mappingJson 生成导出 payload", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture, {
      doctCliPath: "definitely-missing-doct"
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    hosted.services.repositories.documentTemplateRepository.create({
      id: "mapped.doct.custom@v1",
      templateKey: "mapped.doct.custom",
      displayName: "映射测试模板",
      engine: "doct",
      templateVersion: "v1",
      schemaJson: JSON.stringify({
        requiredFields: ["title", "body"],
        optionalFields: ["summary"]
      }),
      mappingJson: JSON.stringify({
        title: "content.exportTitle",
        summary: "content.exportSummary",
        sections: "content.customSections"
      }),
      outputFormatsJson: JSON.stringify(["docx", "md"]),
      status: "active",
      createdAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:00:00.000Z"
    });

    const tokens = await bootstrapAndLogin(hosted);
    const documentResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/office/documents",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        title: "原始标题",
        templateId: "mapped.doct.custom@v1",
        summary: "不会直接导出这段 summary",
        content: {
          exportTitle: "映射后的标题",
          exportSummary: "映射后的摘要",
          customSections: [
            {
              heading: "映射章节",
              body: "来自 customSections 的正文。"
            }
          ]
        }
      }
    });

    expect(documentResponse.statusCode).toBe(200);
    const documentId = documentResponse.json().document.id as string;

    const createTaskResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/office/documents/${documentId}/export`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        format: "docx"
      }
    });

    expect(createTaskResponse.statusCode).toBe(200);
    const exportTaskId = createTaskResponse.json().task.id as string;

    const executeResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/office/document-tasks/${exportTaskId}/execute`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(executeResponse.statusCode).toBe(200);

    const taskDetail = await waitForOfficeTask(hosted, tokens.accessToken, exportTaskId);
    expect(taskDetail.task.status).toBe("succeeded");
    expect(taskDetail.artifacts[0]?.metadataJson).toContain("\"templateId\":\"mapped.doct.custom@v1\"");
    expect(taskDetail.artifacts[0]?.metadataJson).toContain("\"payloadSummary\"");
    expect(taskDetail.receipts[0]?.payloadJson).toContain("\"templateKey\":\"mapped.doct.custom\"");
    expect(taskDetail.receipts[0]?.payloadJson).toContain("\"payloadSha256\":");

    const documentXml = await readDocxDocumentXml(taskDetail.artifacts[0]!.storagePath);
    expect(documentXml).toContain("映射后的标题");
    expect(documentXml).toContain("映射后的摘要");
    expect(documentXml).toContain("映射章节");
    expect(documentXml).toContain("来自 customSections 的正文");
    expect(documentXml).not.toContain("原始标题");
  }, SLOW_TEST_TIMEOUT_MS);

  it("配置 templateSourcePath 且存在 doct 时，会优先走真实 doct 模板文件导出", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const templateFilePath = path.join(fixture.rootDir, "weekly-report.doct");
    writeFileSync(templateFilePath, "fake doct template", "utf8");

    const doctScriptPath = path.join(fixture.rootDir, "fake-doct");
    writeFileSync(
      doctScriptPath,
      `#!/bin/sh
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then
    shift
    output="$1"
  fi
  shift
done
printf 'doct generated docx' > "$output"
`,
      "utf8"
    );
    chmodSync(doctScriptPath, 0o755);

    const hosted = createTestApp(fixture, {
      doctCliPath: doctScriptPath
    });
    activeServers.push(hosted);
    await hosted.app.ready();

    const tokens = await bootstrapAndLogin(hosted);

    const createTemplateResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/office/document-templates",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        templateKey: "file-backed.doct.memo",
        displayName: "文件模板",
        templateVersion: "v1",
        templateSourcePath: templateFilePath,
        schema: {
          requiredFields: ["title", "body"],
          optionalFields: []
        },
        mapping: {
          title: "document.title",
          sections: "content.blocks"
        },
        outputFormats: ["docx"]
      }
    });

    expect(createTemplateResponse.statusCode).toBe(201);
    expect(createTemplateResponse.json()).toMatchObject({
      templateSourcePath: templateFilePath
    });

    const documentResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/office/documents",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        title: "真实 doct 导出",
        templateId: "file-backed.doct.memo@v1",
        content: {
          blocks: [
            {
              heading: "正文",
              body: "来自 doct 的正文"
            }
          ]
        }
      }
    });

    expect(documentResponse.statusCode).toBe(200);
    const documentId = documentResponse.json().document.id as string;

    const createTaskResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/office/documents/${documentId}/export`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      },
      payload: {
        format: "docx"
      }
    });

    expect(createTaskResponse.statusCode).toBe(200);
    const exportTaskId = createTaskResponse.json().task.id as string;

    const executeResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/office/document-tasks/${exportTaskId}/execute`,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`
      }
    });

    expect(executeResponse.statusCode).toBe(200);

    const taskDetail = await waitForOfficeTask(hosted, tokens.accessToken, exportTaskId);
    expect(taskDetail.task.status).toBe("succeeded");
    expect(taskDetail.artifacts[0]?.metadataJson).toContain("\"engine\":\"doct\"");
    expect(taskDetail.artifacts[0]?.metadataJson).toContain("\"templateId\":\"file-backed.doct.memo@v1\"");

    expect(taskDetail.artifacts[0]?.storagePath).toContain(".docx");
    const artifactBytes = readFileSync(taskDetail.artifacts[0]!.storagePath);
    expect(artifactBytes.toString("utf8")).toContain("doct generated docx");
    expect(taskDetail.receipts[0]?.payloadJson).toContain("\"engine\":\"doct\"");
  }, SLOW_TEST_TIMEOUT_MS);

});

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>) {
  const setupResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  expect(setupResponse.statusCode).toBe(201);

  const loginResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  expect(loginResponse.statusCode).toBe(200);
  return loginResponse.json() as { accessToken: string };
}

function createSuccessfulChildProcess(output: string): ChildProcessWithoutNullStreams {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const child = Object.assign(emitter, {
    stdout,
    stderr,
    stdin,
    unref: vi.fn()
  }) as unknown as ChildProcessWithoutNullStreams;

  queueMicrotask(() => {
    emitter.emit("spawn");
    stdout.write(output);
    stdout.end();
    stderr.end();
    emitter.emit("close", 0, null);
  });

  return child;
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createMockChildProcess(output = ""): ChildProcessWithoutNullStreams {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const emitter = new EventEmitter();

  const child = {
    stdout,
    stderr,
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    emit: emitter.emit.bind(emitter),
    kill: vi.fn(),
    pid: 1234
  } as unknown as ChildProcessWithoutNullStreams;

  queueMicrotask(() => {
    emitter.emit("spawn");
    stdout.write(output);
    stdout.end();
    stderr.end();
    emitter.emit("close", 0, null);
  });

  return child;
}

async function waitForOfficeTask(
  hosted: ReturnType<typeof createTestApp>,
  accessToken: string,
  taskId: string
): Promise<{
  task: { status: string };
  artifacts: Array<{
    id: string;
    storagePath: string;
    previewPath?: string | null;
    previewUrl?: string | null;
    contentType: string;
    metadataJson: string;
  }>;
  receipts: Array<{ receiptType: string; payloadJson: string }>;
}> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await hosted.app.inject({
      method: "GET",
      url: `/api/office/tasks/${taskId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    const detail = response.json() as {
      task: { status: string };
      artifacts: Array<{
        id: string;
        storagePath: string;
        previewPath?: string | null;
        previewUrl?: string | null;
        contentType: string;
        metadataJson: string;
      }>;
      receipts: Array<{ receiptType: string; payloadJson: string }>;
    };

    if (detail.task.status === "succeeded" || detail.task.status === "failed" || detail.task.status === "cancelled") {
      return detail;
    }

    await flushAsyncWork();
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error(`等待办公任务完成超时: ${taskId}`);
}

async function readDocxDocumentXml(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile("unzip", ["-p", filePath, "word/document.xml"], { encoding: "utf8" }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(stdout);
    });
  });
}
