import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: EmptyFixture[] = [];
const activePortLocks: net.Server[] = [];

afterEach(async () => {
  while (activePortLocks.length > 0) {
    const server = activePortLocks.pop();

    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  }

  while (activeServers.length > 0) {
    const hosted = activeServers.pop();

    if (hosted) {
      hosted.app.server.closeAllConnections?.();
      await hosted.app.close();
    }
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("debug target routes", () => {
  it("可以分析调试目标并读取框架分析结果", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const repoPath = path.join(fixture.rootDir, "demo-repo");

    mkdirSync(repoPath, { recursive: true });
    writeFileSync(
      path.join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "demo-repo",
          scripts: {
            dev: "vite"
          },
          devDependencies: {
            vite: "^5.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(path.join(repoPath, "vite.config.ts"), "export default {};\n", "utf8");

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const importResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: repoPath,
        name: "Demo Repo"
      }
    });

    expect(importResponse.statusCode).toBe(201);
    const workspace = importResponse.json() as { id: string };
    const analyzeResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/debug-targets/analyze",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId: workspace.id,
        rootPath: repoPath,
        commandHints: ["pnpm dev"]
      }
    });

    expect(analyzeResponse.statusCode).toBe(200);
    expect(analyzeResponse.json()).toMatchObject({
      target: {
        workspaceId: workspace.id,
        rootPath: repoPath,
        displayName: "demo-repo",
        sourceType: "repo"
      },
      services: [
        {
          role: "frontend",
          args: expect.arrayContaining(["dev"])
        }
      ],
      analyses: [
        {
          primaryFramework: "vite",
          confidence: "high",
          compatibilityLevel: "supported",
          recommendedInjectionMode: "cli",
          requiresServiceDiscoveryHandling: true,
          requiresHmrHandling: true,
          requiresCallbackHandling: false,
          aiFallbackPolicy: "conditional",
          detectedFiles: expect.arrayContaining(["package.json", "vite.config.ts"])
        }
      ],
      autoInjectionEligible: true
    });

    const targetId = analyzeResponse.json().target.id as string;
    const analysisListResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/debug-targets/${targetId}/framework-analysis`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(analysisListResponse.statusCode).toBe(200);
    expect(analysisListResponse.json()).toMatchObject({
      targetId,
      items: [
        expect.objectContaining({
          primaryFramework: "vite",
          compatibilityLevel: "supported"
        })
      ]
    });

    const refreshResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/debug-targets/${targetId}/framework-analysis/refresh`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(refreshResponse.statusCode).toBe(200);
    expect(refreshResponse.json()).toMatchObject({
      target: {
        id: targetId
      },
      autoInjectionEligible: true
    });

    const launchPlanResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/debug-targets/${targetId}/launch-plan`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(launchPlanResponse.statusCode).toBe(200);
    const launchPlan = launchPlanResponse.json();

    expect(launchPlan.targetId).toBe(targetId);
    expect(launchPlan.runtimeSession).toMatchObject({
      targetId,
      status: "PREPARING"
    });
    expect(launchPlan.autoStartAllowed).toBe(false);
    expect(launchPlan.services).toHaveLength(1);
    expect(launchPlan.services[0]).toMatchObject({
      adapterKind: "cli",
      injectionMode: "cli",
      expectedPort: 5173,
      autoStartAllowed: false
    });
    expect(launchPlan.services[0].serviceId).toEqual(expect.any(String));
    expect(launchPlan.services[0].leasedPort).toEqual(expect.any(Number));
    expect(launchPlan.services[0].missingRequirements).toEqual(
      expect.arrayContaining(["service_discovery", "hmr"])
    );
  }, 15000);

  it("可以返回框架兼容矩阵", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const response = await hosted.app.inject({
      method: "GET",
      url: "/api/framework-compatibility-matrix",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      version: "2026-04-13",
      items: expect.arrayContaining([
        expect.objectContaining({
          framework: "vite",
          compatibilityLevel: "supported",
          recommendedInjectionMode: "cli"
        }),
        expect.objectContaining({
          framework: "unknown",
          compatibilityLevel: "unknown",
          recommendedInjectionMode: "none"
        })
      ])
    });
  });

  it("可以识别 Remix 并返回条件支持", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const repoPath = path.join(fixture.rootDir, "remix-repo");

    mkdirSync(repoPath, { recursive: true });
    writeFileSync(
      path.join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "remix-repo",
          scripts: {
            dev: "remix dev"
          },
          dependencies: {
            "@remix-run/react": "^2.0.0"
          },
          devDependencies: {
            "@remix-run/dev": "^2.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(path.join(repoPath, "remix.config.js"), "module.exports = {};\n", "utf8");

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, repoPath, "Remix Repo");
    const response = await hosted.app.inject({
      method: "POST",
      url: "/api/debug-targets/analyze",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        rootPath: repoPath
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      analyses: [
        expect.objectContaining({
          primaryFramework: "remix",
          confidence: "high",
          compatibilityLevel: "conditional",
          recommendedInjectionMode: "env"
        })
      ]
    });
  }, 15000);

  it("可以识别 Tauri 并明确标成 unsupported", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const repoPath = path.join(fixture.rootDir, "tauri-repo");

    mkdirSync(path.join(repoPath, "src-tauri"), { recursive: true });
    writeFileSync(
      path.join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "tauri-repo",
          devDependencies: {
            "@tauri-apps/cli": "^2.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(path.join(repoPath, "src-tauri", "tauri.conf.json"), "{\n  \"productName\": \"demo\"\n}\n", "utf8");

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, repoPath, "Tauri Repo");
    const response = await hosted.app.inject({
      method: "POST",
      url: "/api/debug-targets/analyze",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        rootPath: repoPath
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      analyses: [
        expect.objectContaining({
          primaryFramework: "tauri",
          confidence: "high",
          compatibilityLevel: "unsupported",
          recommendedInjectionMode: "none"
        })
      ],
      autoInjectionEligible: false
    });
  }, 15000);

  it("monorepo 根目录会拆出前后端服务并返回相对明确的路径分析", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const repoPath = path.join(fixture.rootDir, "mono-repo");
    const userAppPath = path.join(repoPath, "apps", "user-app");
    const hostPath = path.join(repoPath, "apps", "host");

    mkdirSync(userAppPath, { recursive: true });
    mkdirSync(hostPath, { recursive: true });
    writeFileSync(path.join(repoPath, "pnpm-workspace.yaml"), "packages:\n  - \"apps/*\"\n", "utf8");
    writeFileSync(
      path.join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "mono-repo",
          private: true,
          scripts: {
            "dev:frontend": "pnpm --dir apps/user-app dev",
            "dev:host": "pnpm --dir apps/host dev"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(
      path.join(userAppPath, "package.json"),
      JSON.stringify(
        {
          name: "user-app",
          scripts: {
            dev: "vite"
          },
          devDependencies: {
            vite: "^6.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(path.join(userAppPath, "vite.config.ts"), "export default {};\n", "utf8");
    writeFileSync(
      path.join(hostPath, "package.json"),
      JSON.stringify(
        {
          name: "host",
          scripts: {
            dev: "tsx watch src/main.ts"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    mkdirSync(path.join(hostPath, "src"), { recursive: true });
    writeFileSync(path.join(hostPath, "src", "main.ts"), "console.log('host');\n", "utf8");

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, repoPath, "Mono Repo");
    const response = await hosted.app.inject({
      method: "POST",
      url: "/api/debug-targets/analyze",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        rootPath: repoPath
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      services: expect.arrayContaining([
        expect.objectContaining({
          role: "frontend",
          cwd: userAppPath,
          name: "user-app"
        }),
        expect.objectContaining({
          role: "backend",
          cwd: hostPath,
          name: "host"
        })
      ]),
      analyses: expect.arrayContaining([
        expect.objectContaining({
          primaryFramework: "vite",
          compatibilityLevel: "supported"
        }),
        expect.objectContaining({
          primaryFramework: "node-custom",
          compatibilityLevel: "conditional"
        })
      ])
    });
  }, 15000);

  it("可以按调试目标读取最新运行态，没有运行记录时返回 null", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const repoPath = path.join(fixture.rootDir, "runtime-latest-repo");

    mkdirSync(repoPath, { recursive: true });
    writeFileSync(
      path.join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "runtime-latest-repo",
          scripts: {
            dev: "node server.js"
          },
          dependencies: {
            express: "^4.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(
      path.join(repoPath, "server.js"),
      [
        "const express = require('express');",
        "const app = express();",
        "app.listen(process.env.PORT || 3000);"
      ].join("\n"),
      "utf8"
    );

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const importResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: repoPath,
        name: "Runtime Latest Repo"
      }
    });

    expect(importResponse.statusCode).toBe(201);
    const workspaceId = (importResponse.json() as { id: string }).id;
    const analyzeResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/debug-targets/analyze",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        rootPath: repoPath,
        commandHints: ["node server.js"]
      }
    });

    expect(analyzeResponse.statusCode).toBe(200);
    const targetId = analyzeResponse.json().target.id as string;
    const emptyRuntimeResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/debug-targets/${targetId}/runtime-latest`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(emptyRuntimeResponse.statusCode).toBe(200);
    expect(emptyRuntimeResponse.json()).toBeNull();

    const launchPlanResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/debug-targets/${targetId}/launch-plan`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(launchPlanResponse.statusCode).toBe(200);
    const latestRuntimeResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/debug-targets/${targetId}/runtime-latest`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(latestRuntimeResponse.statusCode).toBe(200);
    expect(latestRuntimeResponse.json()).toMatchObject({
      runtimeSession: {
        targetId,
        status: "PREPARING"
      },
      target: {
        id: targetId
      }
    });

    const runtimeHistoryResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/debug-targets/${targetId}/runtimes?limit=5`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(runtimeHistoryResponse.statusCode).toBe(200);
    expect(runtimeHistoryResponse.json()).toMatchObject({
      targetId,
      items: [
        expect.objectContaining({
          runtimeSession: expect.objectContaining({
            targetId,
            status: "PREPARING"
          })
        })
      ]
    });
  }, 15000);

  it("生成启动计划时会跳过已被宿主机占用的端口", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const repoPath = path.join(fixture.rootDir, "express-repo");

    mkdirSync(repoPath, { recursive: true });
    writeFileSync(
      path.join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "express-repo",
          scripts: {
            dev: "node server.js"
          },
          dependencies: {
            express: "^4.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const portLock = net.createServer();
    await new Promise<void>((resolve, reject) => {
      portLock.once("error", reject);
      portLock.listen(44000, "127.0.0.1", () => resolve());
    });
    activePortLocks.push(portLock);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const importResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: repoPath,
        name: "Express Repo"
      }
    });

    expect(importResponse.statusCode).toBe(201);
    const workspaceId = (importResponse.json() as { id: string }).id;
    const analyzeResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/debug-targets/analyze",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        rootPath: repoPath,
        commandHints: ["node server.js"]
      }
    });

    expect(analyzeResponse.statusCode).toBe(200);
    const targetId = analyzeResponse.json().target.id as string;
    const launchPlanResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/debug-targets/${targetId}/launch-plan`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(launchPlanResponse.statusCode).toBe(200);
    expect(launchPlanResponse.json().services[0]).toMatchObject({
      adapterKind: "env",
      injectionMode: "env",
      leasedPort: 44001
    });
  });

  it("可以把允许自动启动的调试目标接进现有终端执行链路", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const repoPath = path.join(fixture.rootDir, "express-run-repo");

    mkdirSync(repoPath, { recursive: true });
    writeFileSync(
      path.join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "express-run-repo",
          scripts: {
            dev: "node server.js"
          },
          dependencies: {
            express: "^4.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(
      path.join(repoPath, "server.js"),
      "console.log('port=' + (process.env.PORT || 'none')); setTimeout(() => process.exit(0), 50);\n",
      "utf8"
    );

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const importResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: repoPath,
        name: "Express Run Repo"
      }
    });

    expect(importResponse.statusCode).toBe(201);
    const workspaceId = (importResponse.json() as { id: string }).id;
    const analyzeResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/debug-targets/analyze",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        rootPath: repoPath,
        commandHints: ["node server.js"]
      }
    });

    expect(analyzeResponse.statusCode).toBe(200);
    const targetId = analyzeResponse.json().target.id as string;
    const runResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/debug-targets/${targetId}/run`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(runResponse.statusCode).toBe(200);
    expect(runResponse.json()).toMatchObject({
      runtimeSession: {
        targetId,
        status: "RUNNING"
      },
      services: [
        expect.objectContaining({
          serviceId: expect.any(String),
          processInstanceId: expect.any(String),
          terminalId: expect.any(String),
          leasedPort: expect.any(Number),
          runtimeBindingId: expect.any(String)
        })
      ]
    });

    const processInstanceId = runResponse.json().services[0].processInstanceId as string;
    const terminal = hosted.services.repositories.terminalInstanceRepository.findById(processInstanceId);

    expect(terminal).toMatchObject({
      debugRuntimeSessionId: runResponse.json().runtimeSession.id,
      debugTargetId: targetId,
      launcherSourceType: "debug_service",
      adapterKind: "env"
    });
  }, 15000);

  it("当前缺少额外处理项时会拒绝自动运行", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const repoPath = path.join(fixture.rootDir, "vite-run-repo");

    mkdirSync(repoPath, { recursive: true });
    writeFileSync(
      path.join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "vite-run-repo",
          scripts: {
            dev: "vite"
          },
          devDependencies: {
            vite: "^5.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(path.join(repoPath, "vite.config.ts"), "export default {};\n", "utf8");

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const importResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: repoPath,
        name: "Vite Run Repo"
      }
    });

    expect(importResponse.statusCode).toBe(201);
    const workspaceId = (importResponse.json() as { id: string }).id;
    const analyzeResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/debug-targets/analyze",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        rootPath: repoPath,
        commandHints: ["pnpm dev"]
      }
    });

    expect(analyzeResponse.statusCode).toBe(200);
    const targetId = analyzeResponse.json().target.id as string;
    const runResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/debug-targets/${targetId}/run`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(runResponse.statusCode).toBe(409);
    expect(runResponse.json().error_code).toBe("DEBUG_TARGET_RUN_NOT_ALLOWED");
  }, 15000);

  it("关闭调试终端后会释放租约，并把运行时标记为 STOPPED", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const repoPath = path.join(fixture.rootDir, "express-stop-repo");

    mkdirSync(repoPath, { recursive: true });
    writeFileSync(
      path.join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "express-stop-repo",
          scripts: {
            dev: "node server.js"
          },
          dependencies: {
            express: "^4.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(
      path.join(repoPath, "server.js"),
      "setInterval(() => {}, 1000);\n",
      "utf8"
    );

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const importResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: repoPath,
        name: "Express Stop Repo"
      }
    });

    expect(importResponse.statusCode).toBe(201);
    const workspaceId = (importResponse.json() as { id: string }).id;
    const analyzeResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/debug-targets/analyze",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        rootPath: repoPath,
        commandHints: ["node server.js"]
      }
    });

    expect(analyzeResponse.statusCode).toBe(200);
    const targetId = analyzeResponse.json().target.id as string;
    const runResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/debug-targets/${targetId}/run`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(runResponse.statusCode).toBe(200);
    const runtimeId = runResponse.json().runtimeSession.id as string;
    const terminalId = runResponse.json().services[0].terminalId as string;
    const closeResponse = await hosted.app.inject({
      method: "DELETE",
      url: `/api/terminals/${terminalId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(closeResponse.statusCode).toBe(200);

    await wait(300);

    const runtimeResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/debug-runtimes/${runtimeId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(runtimeResponse.statusCode).toBe(200);
    expect(runtimeResponse.json()).toMatchObject({
      runtimeSession: {
        id: runtimeId,
        status: "STOPPED",
        failureStage: null
      },
      services: [
        {
          binding: {
            status: "RELEASED"
          },
          portLease: {
            status: "RELEASED"
          },
          processInstance: {
            id: terminalId,
            status: "closed"
          }
        }
      ]
    });
  }, 20000);

  it("后台巡检会自动回收缺失进程实例留下的脏租约", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const repoPath = path.join(fixture.rootDir, "background-stale-runtime-repo");

    mkdirSync(repoPath, { recursive: true });
    writeFileSync(
      path.join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "background-stale-runtime-repo",
          scripts: {
            dev: "node server.js"
          },
          dependencies: {
            express: "^4.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const importResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: repoPath,
        name: "Background Stale Runtime Repo"
      }
    });

    expect(importResponse.statusCode).toBe(201);
    const workspaceId = (importResponse.json() as { id: string }).id;
    const analyzeResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/debug-targets/analyze",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        rootPath: repoPath,
        commandHints: ["node server.js"]
      }
    });

    expect(analyzeResponse.statusCode).toBe(200);
    const targetId = analyzeResponse.json().target.id as string;
    const launchPlanResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/debug-targets/${targetId}/launch-plan`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(launchPlanResponse.statusCode).toBe(200);
    const runtimeId = launchPlanResponse.json().runtimeSession.id as string;
    const runtimeBindingId = launchPlanResponse.json().services[0].runtimeBindingId as string;
    const portLeaseId = launchPlanResponse.json().services[0].portLeaseId as string;
    const runtimeRepository = hosted.services.repositories.debugRuntimeSessionRepository;
    const bindingRepository = hosted.services.repositories.runtimeBindingRepository;
    const leaseRepository = hosted.services.repositories.portLeaseRepository;
    const runtime = runtimeRepository.findById(runtimeId)!;
    const binding = bindingRepository.findById(runtimeBindingId)!;
    const lease = leaseRepository.findById(portLeaseId)!;

    runtimeRepository.update({
      ...runtime,
      status: "RUNNING",
      startedAt: "2026-04-13T12:00:00.000Z",
      updatedAt: "2026-04-13T12:00:00.000Z"
    });
    bindingRepository.update({
      ...binding,
      processInstanceId: "missing-terminal",
      updatedAt: "2026-04-13T12:00:00.000Z"
    });
    leaseRepository.update({
      ...lease,
      status: "LEASED",
      releasedAt: null
    });

    await hosted.services.modules.debugRuntimeReconciliationScheduler.runOnce();

    expect(runtimeRepository.findById(runtimeId)).toMatchObject({
      id: runtimeId,
      status: "FAILED",
      failureStage: "stale_runtime_binding"
    });
    expect(bindingRepository.findById(runtimeBindingId)).toMatchObject({
      id: runtimeBindingId,
      status: "FAILED"
    });
    expect(leaseRepository.findById(portLeaseId)).toMatchObject({
      id: portLeaseId,
      status: "RELEASED",
      releasedAt: expect.any(String)
    });
  }, 15000);

  it("后台巡检不会重复改坏已经 RELEASED 的关闭终端资源", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const repoPath = path.join(fixture.rootDir, "released-runtime-repo");

    mkdirSync(repoPath, { recursive: true });
    writeFileSync(
      path.join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "released-runtime-repo",
          scripts: {
            dev: "node server.js"
          },
          dependencies: {
            express: "^4.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const importResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: repoPath,
        name: "Released Runtime Repo"
      }
    });

    expect(importResponse.statusCode).toBe(201);
    const workspaceId = (importResponse.json() as { id: string }).id;
    const analyzeResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/debug-targets/analyze",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        rootPath: repoPath,
        commandHints: ["node server.js"]
      }
    });

    expect(analyzeResponse.statusCode).toBe(200);
    const targetId = analyzeResponse.json().target.id as string;
    const launchPlanResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/debug-targets/${targetId}/launch-plan`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(launchPlanResponse.statusCode).toBe(200);
    const runtimeId = launchPlanResponse.json().runtimeSession.id as string;
    const runtimeBindingId = launchPlanResponse.json().services[0].runtimeBindingId as string;
    const portLeaseId = launchPlanResponse.json().services[0].portLeaseId as string;
    const serviceId = launchPlanResponse.json().services[0].serviceId as string;
    const runtimeRepository = hosted.services.repositories.debugRuntimeSessionRepository;
    const bindingRepository = hosted.services.repositories.runtimeBindingRepository;
    const leaseRepository = hosted.services.repositories.portLeaseRepository;
    const terminalRepository = hosted.services.repositories.terminalInstanceRepository;
    const userId = hosted.services.repositories.authUserRepository.findByUsername("admin")!.id;
    const runtime = runtimeRepository.findById(runtimeId)!;
    const binding = bindingRepository.findById(runtimeBindingId)!;
    const lease = leaseRepository.findById(portLeaseId)!;
    const releasedAt = "2026-04-13T12:05:00.000Z";

    terminalRepository.create({
      id: "closed-terminal-1",
      workspaceId,
      name: "closed terminal",
      cwd: repoPath,
      shell: "/bin/zsh",
      runtimeType: "embedded-pty",
      runtimeSessionId: "terminal-runtime-closed-1",
      attachTarget: "embedded:terminal-runtime-closed-1",
      status: "closed",
      processId: null,
      createdByUserId: userId,
      createdAt: "2026-04-13T12:00:00.000Z",
      lastActiveAt: releasedAt,
      closedAt: releasedAt,
      exitCode: 0,
      statusDetail: null,
      debugRuntimeSessionId: runtimeId,
      debugTargetId: targetId,
      debugServiceId: serviceId,
      frameworkAnalysisId: null,
      launcherSourceType: "debug_service",
      launchStage: "command_dispatched",
      failureStage: null,
      adapterKind: "cli",
      envPatchSummary: null,
      artifactRef: null
    });

    runtimeRepository.update({
      ...runtime,
      status: "RUNNING",
      startedAt: "2026-04-13T12:00:00.000Z",
      stoppedAt: null,
      updatedAt: "2026-04-13T12:00:00.000Z"
    });
    bindingRepository.update({
      ...binding,
      processInstanceId: "closed-terminal-1",
      status: "RELEASED",
      updatedAt: releasedAt
    });
    leaseRepository.update({
      ...lease,
      status: "RELEASED",
      releasedAt
    });

    await hosted.services.modules.debugRuntimeReconciliationScheduler.runOnce();

    expect(runtimeRepository.findById(runtimeId)).toMatchObject({
      id: runtimeId,
      status: "STOPPED",
      failureStage: null
    });
    expect(bindingRepository.findById(runtimeBindingId)).toMatchObject({
      id: runtimeBindingId,
      status: "RELEASED"
    });
    expect(leaseRepository.findById(portLeaseId)).toMatchObject({
      id: portLeaseId,
      status: "RELEASED",
      releasedAt
    });
  }, 15000);

  it("Host 冷启动时会自动回收上次异常退出留下的脏租约", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const repoPath = path.join(fixture.rootDir, "startup-recovery-repo");
    const databasePath = path.join(fixture.rootDir, "debug-runtime-recovery.sqlite");

    mkdirSync(repoPath, { recursive: true });
    writeFileSync(
      path.join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "startup-recovery-repo",
          scripts: {
            dev: "node server.js"
          },
          dependencies: {
            express: "^4.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const hosted = createTestApp(fixture, { databasePath });
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const importResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: repoPath,
        name: "Startup Recovery Repo"
      }
    });

    expect(importResponse.statusCode).toBe(201);
    const workspaceId = (importResponse.json() as { id: string }).id;
    const analyzeResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/debug-targets/analyze",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        rootPath: repoPath,
        commandHints: ["node server.js"]
      }
    });

    expect(analyzeResponse.statusCode).toBe(200);
    const targetId = analyzeResponse.json().target.id as string;
    const launchPlanResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/debug-targets/${targetId}/launch-plan`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(launchPlanResponse.statusCode).toBe(200);
    const runtimeId = launchPlanResponse.json().runtimeSession.id as string;
    const runtimeBindingId = launchPlanResponse.json().services[0].runtimeBindingId as string;
    const portLeaseId = launchPlanResponse.json().services[0].portLeaseId as string;
    const runtimeRepository = hosted.services.repositories.debugRuntimeSessionRepository;
    const bindingRepository = hosted.services.repositories.runtimeBindingRepository;
    const leaseRepository = hosted.services.repositories.portLeaseRepository;
    const runtime = runtimeRepository.findById(runtimeId)!;
    const binding = bindingRepository.findById(runtimeBindingId)!;
    const lease = leaseRepository.findById(portLeaseId)!;

    runtimeRepository.update({
      ...runtime,
      status: "RUNNING",
      startedAt: "2026-04-14T08:00:00.000Z",
      updatedAt: "2026-04-14T08:00:00.000Z"
    });
    bindingRepository.update({
      ...binding,
      processInstanceId: "missing-terminal-after-crash",
      updatedAt: "2026-04-14T08:00:00.000Z"
    });
    leaseRepository.update({
      ...lease,
      status: "LEASED",
      releasedAt: null
    });

    hosted.app.server.closeAllConnections?.();
    await hosted.app.close();
    activeServers.pop();

    const recoveredHost = createTestApp(fixture, { databasePath });
    activeServers.push(recoveredHost);
    await recoveredHost.app.ready();

    expect(
      recoveredHost.services.repositories.debugRuntimeSessionRepository.findById(runtimeId)
    ).toMatchObject({
      id: runtimeId,
      status: "FAILED",
      failureStage: "stale_runtime_binding"
    });
    expect(
      recoveredHost.services.repositories.runtimeBindingRepository.findById(runtimeBindingId)
    ).toMatchObject({
      id: runtimeBindingId,
      status: "FAILED"
    });
    expect(
      recoveredHost.services.repositories.portLeaseRepository.findById(portLeaseId)
    ).toMatchObject({
      id: portLeaseId,
      status: "RELEASED",
      releasedAt: expect.any(String)
    });
  }, 20000);

  it("查询运行态时会把缺失进程实例的活跃租约标记为 STALE", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    const repoPath = path.join(fixture.rootDir, "stale-runtime-repo");

    mkdirSync(repoPath, { recursive: true });
    writeFileSync(
      path.join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: "stale-runtime-repo",
          scripts: {
            dev: "node server.js"
          },
          dependencies: {
            express: "^4.0.0"
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const importResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/workspaces/import",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        path: repoPath,
        name: "Stale Runtime Repo"
      }
    });

    expect(importResponse.statusCode).toBe(201);
    const workspaceId = (importResponse.json() as { id: string }).id;
    const analyzeResponse = await hosted.app.inject({
      method: "POST",
      url: "/api/debug-targets/analyze",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        rootPath: repoPath,
        commandHints: ["node server.js"]
      }
    });

    expect(analyzeResponse.statusCode).toBe(200);
    const targetId = analyzeResponse.json().target.id as string;
    const launchPlanResponse = await hosted.app.inject({
      method: "POST",
      url: `/api/debug-targets/${targetId}/launch-plan`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(launchPlanResponse.statusCode).toBe(200);
    const runtimeId = launchPlanResponse.json().runtimeSession.id as string;
    const runtimeBindingId = launchPlanResponse.json().services[0].runtimeBindingId as string;
    const portLeaseId = launchPlanResponse.json().services[0].portLeaseId as string;
    const runtimeRepository = hosted.services.repositories.debugRuntimeSessionRepository;
    const bindingRepository = hosted.services.repositories.runtimeBindingRepository;
    const leaseRepository = hosted.services.repositories.portLeaseRepository;
    const runtime = runtimeRepository.findById(runtimeId)!;
    const binding = bindingRepository.findById(runtimeBindingId)!;
    const lease = leaseRepository.findById(portLeaseId)!;

    runtimeRepository.update({
      ...runtime,
      status: "RUNNING",
      startedAt: "2026-04-13T12:00:00.000Z",
      updatedAt: "2026-04-13T12:00:00.000Z"
    });
    bindingRepository.update({
      ...binding,
      processInstanceId: "missing-terminal",
      updatedAt: "2026-04-13T12:00:00.000Z"
    });
    leaseRepository.update({
      ...lease,
      status: "LEASED",
      releasedAt: null
    });

    const runtimeResponse = await hosted.app.inject({
      method: "GET",
      url: `/api/debug-runtimes/${runtimeId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(runtimeResponse.statusCode).toBe(200);
    expect(runtimeResponse.json()).toMatchObject({
      runtimeSession: {
        id: runtimeId,
        status: "FAILED",
        failureStage: "stale_runtime_binding"
      },
      services: [
        {
          binding: {
            id: runtimeBindingId,
            status: "FAILED"
          },
          portLease: {
            id: portLeaseId,
            status: "STALE"
          },
          processInstance: null
        }
      ]
    });
  }, 15000);
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
  return (loginResponse.json() as { accessToken: string }).accessToken;
}

async function importWorkspace(
  hosted: ReturnType<typeof createTestApp>,
  accessToken: string,
  repoPath: string,
  name: string
) {
  const importResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/workspaces/import",
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    payload: {
      path: repoPath,
      name
    }
  });

  expect(importResponse.statusCode).toBe(201);
  return (importResponse.json() as { id: string }).id;
}
