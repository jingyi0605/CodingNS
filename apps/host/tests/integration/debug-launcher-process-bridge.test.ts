import { describe, expect, it } from "vitest";

import { TerminalCommandTemplateRepository } from "../../src/storage/repositories/terminal-command-template-repository.js";
import { TerminalInstanceRepository } from "../../src/storage/repositories/terminal-instance-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

describe("spec007 / spec007.1 关联字段回归", () => {
  it("现有终端配置和终端实例可以承载调试编排关联字段", () => {
    const database = createDatabaseClient(":memory:");

    database.db.exec(`
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
        '2026-04-13T09:00:00.000Z',
        '2026-04-13T09:00:00.000Z'
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
        '2026-04-13T09:00:00.000Z',
        '2026-04-13T09:00:00.000Z'
      );
    `);

    const templateRepository = new TerminalCommandTemplateRepository(database.db);
    const terminalRepository = new TerminalInstanceRepository(database.db);

    templateRepository.create({
      id: "template-1",
      workspaceId: "workspace-1",
      name: "web",
      cwd: "/tmp/workspace",
      command: "pnpm",
      args: ["dev"],
      env: {
        PORT: "43101"
      },
      port: 43101,
      proxyEnabled: false,
      proxySlug: null,
      runtimeType: "embedded-pty",
      sourceType: "debug_service",
      debugTargetId: "target-1",
      debugServiceId: "service-1",
      frameworkAnalysisId: "analysis-1",
      adapterKind: "cli",
      injectionMode: "cli",
      generatedArtifactRef: "artifact://launch-plan-1",
      serviceDiscoveryMode: "same_origin",
      managedBySystem: true,
      createdAt: "2026-04-13T09:01:00.000Z",
      updatedAt: "2026-04-13T09:01:00.000Z"
    });
    terminalRepository.create({
      id: "terminal-1",
      workspaceId: "workspace-1",
      name: "web run",
      cwd: "/tmp/workspace",
      shell: "/bin/zsh",
      runtimeType: "embedded-pty",
      runtimeSessionId: "terminal-runtime-1",
      attachTarget: "embedded:terminal-runtime-1",
      status: "running",
      processId: 1234,
      createdByUserId: "user-1",
      createdAt: "2026-04-13T09:01:30.000Z",
      lastActiveAt: "2026-04-13T09:01:30.000Z",
      closedAt: null,
      exitCode: null,
      statusDetail: null,
      debugRuntimeSessionId: "runtime-1",
      debugTargetId: "target-1",
      debugServiceId: "service-1",
      frameworkAnalysisId: "analysis-1",
      launcherSourceType: "debug_service",
      launchStage: "port_injection",
      failureStage: null,
      adapterKind: "cli",
      envPatchSummary: {
        PORT: 43101
      },
      artifactRef: "artifact://launch-plan-1"
    });

    expect(templateRepository.findById("template-1")).toMatchObject({
      debugTargetId: "target-1",
      debugServiceId: "service-1",
      frameworkAnalysisId: "analysis-1",
      adapterKind: "cli",
      injectionMode: "cli",
      managedBySystem: true
    });
    expect(terminalRepository.findById("terminal-1")).toMatchObject({
      debugRuntimeSessionId: "runtime-1",
      debugTargetId: "target-1",
      debugServiceId: "service-1",
      frameworkAnalysisId: "analysis-1",
      launcherSourceType: "debug_service",
      launchStage: "port_injection",
      adapterKind: "cli",
      envPatchSummary: {
        PORT: 43101
      }
    });

    database.close();
  });
});
