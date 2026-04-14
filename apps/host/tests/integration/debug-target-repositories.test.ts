import { describe, expect, it } from "vitest";

import { AiFallbackEditRepository } from "../../src/storage/repositories/ai-fallback-edit-repository.js";
import { DebugRuntimeSessionRepository } from "../../src/storage/repositories/debug-runtime-session-repository.js";
import { DebugServiceRepository } from "../../src/storage/repositories/debug-service-repository.js";
import { DebugTargetRepository } from "../../src/storage/repositories/debug-target-repository.js";
import { FrameworkAnalysisResultRepository } from "../../src/storage/repositories/framework-analysis-result-repository.js";
import { PortLeaseRepository } from "../../src/storage/repositories/port-lease-repository.js";
import { RuntimeBindingRepository } from "../../src/storage/repositories/runtime-binding-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

describe("spec007.1 调试编排仓储", () => {
  it("可以完成调试目标到 AI 兜底记录的最小读写", () => {
    const database = createDatabaseClient(":memory:");
    seedWorkspaceDependencies(database.db);

    const debugTargetRepository = new DebugTargetRepository(database.db);
    const debugServiceRepository = new DebugServiceRepository(database.db);
    const frameworkAnalysisRepository = new FrameworkAnalysisResultRepository(database.db);
    const debugRuntimeRepository = new DebugRuntimeSessionRepository(database.db);
    const portLeaseRepository = new PortLeaseRepository(database.db);
    const runtimeBindingRepository = new RuntimeBindingRepository(database.db);
    const aiFallbackEditRepository = new AiFallbackEditRepository(database.db);

    debugTargetRepository.create({
      id: "target-1",
      workspaceId: "workspace-1",
      rootPath: "/tmp/workspace/repo",
      displayName: "repo",
      stackHint: "vite",
      sourceType: "repo",
      rootWorkspaceId: null,
      createdAt: "2026-04-13T08:00:00.000Z",
      updatedAt: "2026-04-13T08:00:00.000Z"
    });
    debugServiceRepository.create({
      id: "service-1",
      targetId: "target-1",
      role: "frontend",
      name: "web",
      cwd: "/tmp/workspace/repo",
      command: "pnpm",
      args: ["dev"],
      env: {},
      defaultPortHint: 5173,
      protocol: "http",
      healthPath: null,
      adapterKind: "cli",
      frameworkAnalysisId: null,
      createdAt: "2026-04-13T08:00:00.000Z",
      updatedAt: "2026-04-13T08:00:00.000Z"
    });
    frameworkAnalysisRepository.create({
      id: "analysis-1",
      targetId: "target-1",
      serviceId: "service-1",
      primaryFramework: "vite",
      confidence: "high",
      compatibilityLevel: "supported",
      recommendedInjectionMode: "cli",
      requiresServiceDiscoveryHandling: true,
      requiresHmrHandling: true,
      requiresCallbackHandling: false,
      aiFallbackPolicy: "conditional",
      reasons: ["命中 vite.config.ts"],
      detectedFiles: ["vite.config.ts"],
      rawEvidence: {
        packageJson: true
      },
      createdAt: "2026-04-13T08:00:01.000Z"
    });
    debugRuntimeRepository.create({
      id: "runtime-1",
      targetId: "target-1",
      status: "PREPARING",
      failureStage: null,
      startedAt: null,
      stoppedAt: null,
      createdAt: "2026-04-13T08:00:02.000Z",
      updatedAt: "2026-04-13T08:00:02.000Z"
    });
    portLeaseRepository.create({
      id: "lease-1",
      runtimeId: "runtime-1",
      serviceId: "service-1",
      port: 43101,
      protocol: "tcp",
      status: "LEASED",
      leasedAt: "2026-04-13T08:00:03.000Z",
      expiresAt: null,
      releasedAt: null
    });
    runtimeBindingRepository.create({
      id: "binding-1",
      runtimeId: "runtime-1",
      serviceId: "service-1",
      processInstanceId: "terminal-1",
      expectedPort: 5173,
      leasedPort: 43101,
      observedPort: null,
      proxyPath: null,
      status: "ALLOCATED",
      updatedAt: "2026-04-13T08:00:03.500Z"
    });
    aiFallbackEditRepository.create({
      id: "edit-1",
      runtimeId: "runtime-1",
      serviceId: "service-1",
      reason: "前三层注入都失败",
      allowedFiles: ["vite.config.ts"],
      targetPort: 43101,
      patchRef: null,
      rollbackRef: null,
      status: "PENDING",
      createdAt: "2026-04-13T08:00:04.000Z"
    });

    expect(debugTargetRepository.findByWorkspaceAndRootPath("workspace-1", "/tmp/workspace/repo")).toMatchObject({
      id: "target-1",
      stackHint: "vite"
    });
    expect(debugServiceRepository.listByTargetId("target-1")).toEqual([
      expect.objectContaining({
        id: "service-1",
        args: ["dev"],
        adapterKind: "cli"
      })
    ]);
    expect(frameworkAnalysisRepository.listByTargetId("target-1")).toEqual([
      expect.objectContaining({
        id: "analysis-1",
        primaryFramework: "vite",
        recommendedInjectionMode: "cli"
      })
    ]);
    expect(debugRuntimeRepository.listByTargetId("target-1")[0]).toMatchObject({
      id: "runtime-1",
      status: "PREPARING"
    });
    expect(portLeaseRepository.listByRuntimeId("runtime-1")[0]).toMatchObject({
      id: "lease-1",
      port: 43101
    });
    expect(runtimeBindingRepository.listByRuntimeId("runtime-1")[0]).toMatchObject({
      id: "binding-1",
      leasedPort: 43101
    });
    expect(aiFallbackEditRepository.listByRuntimeId("runtime-1")[0]).toMatchObject({
      id: "edit-1",
      allowedFiles: ["vite.config.ts"]
    });

    database.close();
  });
});

function seedWorkspaceDependencies(
  db: ReturnType<typeof createDatabaseClient>["db"]
): void {
  db.exec(`
    INSERT INTO auth_users (
      id,
      username,
      password_hash,
      role,
      created_at,
      updated_at
    ) VALUES (
      'user-1',
      'admin',
      'hash',
      'admin',
      '2026-04-13T07:59:00.000Z',
      '2026-04-13T07:59:00.000Z'
    );

    INSERT INTO workspaces (
      id,
      name,
      path,
      repo_root,
      favorite,
      sort_order,
      created_at,
      updated_at
    ) VALUES (
      'workspace-1',
      'workspace',
      '/tmp/workspace',
      '/tmp/workspace',
      0,
      0,
      '2026-04-13T07:59:00.000Z',
      '2026-04-13T07:59:00.000Z'
    );
  `);
}
