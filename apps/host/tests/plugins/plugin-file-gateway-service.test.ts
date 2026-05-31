import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { FileAccessGuard } from "../../src/modules/file/file-access-guard.js";
import { PluginFileGatewayService } from "../../src/modules/plugins/plugin-file-gateway-service.js";
import type { PluginPermissionService } from "../../src/modules/plugins/plugin-permission-service.js";
import type { PluginRegistryService } from "../../src/modules/plugins/plugin-registry-service.js";
import type { PluginAuditEventRepository } from "../../src/storage/repositories/plugin-audit-event-repository.js";

describe("plugin-file-gateway-service", () => {
  it("写工作区文件后会上报 mutation hook", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codingns-plugin-file-gateway-service-"));
    const filePath = path.join(tempDir, "reports", "output.txt");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    try {
      const service = new PluginFileGatewayService(
        {
          getPlugin: () => ({
            manifest: {
              id: "demo.plugin",
              name: "演示插件",
              version: "1.0.0",
              permissions: {
                workspaceWrite: true
              }
            }
          })
        } as unknown as PluginRegistryService,
        {
          resolvePath: () => ({
            absolutePath: filePath,
            relativePath: "reports/output.txt"
          })
        } as unknown as FileAccessGuard,
        {
          assertWorkspaceWrite: () => undefined
        } as unknown as PluginPermissionService,
        {
          create: () => undefined
        } as unknown as PluginAuditEventRepository
      );

      const events: Array<{
        workspaceId: string;
        absolutePath: string;
        relativePath: string;
        kind: string;
      }> = [];
      service.setMutationHook((event) => {
        events.push(event);
      });

      service.writeFile({
        pluginId: "demo.plugin",
        workspaceId: "workspace-1",
        runtimeSessionId: "runtime-1",
        requestedPath: "reports/output.txt",
        actorUserId: "user-1",
        content: "generated"
      });

      expect(fs.readFileSync(filePath, "utf8")).toBe("generated");
      expect(events).toEqual([
        {
          workspaceId: "workspace-1",
          absolutePath: filePath,
          relativePath: "reports/output.txt",
          kind: "upsert"
        }
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
