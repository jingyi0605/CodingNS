import fs from "node:fs";

import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { PluginAuditEventRepository } from "../../storage/repositories/plugin-audit-event-repository.js";
import type { FileNode, FileSnapshot } from "../../types/domain.js";
import type { FileAccessGuard } from "../file/file-access-guard.js";
import { PluginPermissionService } from "./plugin-permission-service.js";
import type { PluginRegistryService } from "./plugin-registry-service.js";

export interface PluginFileGatewayReadInput {
  pluginId: string;
  workspaceId: string;
  runtimeSessionId: string;
  requestedPath: string;
  actorUserId: string | null;
}

export interface PluginFileGatewayWriteInput extends PluginFileGatewayReadInput {
  content: string;
}

export interface PluginFileGatewayListInput {
  pluginId: string;
  workspaceId: string;
  runtimeSessionId: string;
  requestedPath?: string | null;
  actorUserId: string | null;
}

type PluginFileMutationKind = "upsert";

interface PluginFileMutationEvent {
  workspaceId: string;
  absolutePath: string;
  relativePath: string;
  kind: PluginFileMutationKind;
}

type PluginFileMutationHook = (event: PluginFileMutationEvent) => void;

export class PluginFileGatewayService {
  private mutationHook: PluginFileMutationHook | null = null;

  constructor(
    private readonly pluginRegistryService: PluginRegistryService,
    private readonly fileAccessGuard: FileAccessGuard,
    private readonly pluginPermissionService: PluginPermissionService,
    private readonly pluginAuditEventRepository: PluginAuditEventRepository
  ) {}

  setMutationHook(hook: PluginFileMutationHook | null): void {
    this.mutationHook = hook;
  }

  readFile(input: PluginFileGatewayReadInput): FileSnapshot {
    const detail = this.pluginRegistryService.getPlugin(input.pluginId);
    try {
      this.pluginPermissionService.assertWorkspaceRead(detail.manifest, {
        pluginId: input.pluginId,
        workspaceId: input.workspaceId
      });
    } catch (error) {
      this.recordPermissionAudit(input, "workspace.read_file", error);
      throw error;
    }

    const resolved = this.fileAccessGuard.resolvePath(input.workspaceId, input.requestedPath, {
      mustExist: true,
      kind: "file"
    });
    const buffer = fs.readFileSync(resolved.absolutePath);
    const stats = fs.statSync(resolved.absolutePath);

    const snapshot: FileSnapshot = {
      workspaceId: input.workspaceId,
      path: resolved.relativePath,
      content: buffer.toString("utf8"),
      encoding: "utf-8",
      version: buildPluginFileVersion(buffer, stats),
      size: buffer.byteLength,
      updatedAt: stats.mtime.toISOString()
    };

    this.recordAuditEvent(input.pluginId, input.workspaceId, input.actorUserId, "plugin.file_read", {
      runtimeSessionId: input.runtimeSessionId,
      path: resolved.relativePath,
      size: snapshot.size
    });

    return snapshot;
  }

  writeFile(input: PluginFileGatewayWriteInput): { path: string; size: number; updatedAt: string } {
    const detail = this.pluginRegistryService.getPlugin(input.pluginId);
    try {
      this.pluginPermissionService.assertWorkspaceWrite(detail.manifest, {
        pluginId: input.pluginId,
        workspaceId: input.workspaceId
      }, input.requestedPath);
    } catch (error) {
      this.recordPermissionAudit(input, "workspace.write_file", error);
      throw error;
    }

    const resolved = this.fileAccessGuard.resolvePath(input.workspaceId, input.requestedPath, {
      mustExist: false,
      kind: "file"
    });
    const buffer = Buffer.from(input.content, "utf8");
    fs.writeFileSync(resolved.absolutePath, buffer);
    const stats = fs.statSync(resolved.absolutePath);

    this.reportMutation({
      workspaceId: input.workspaceId,
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      kind: "upsert"
    });

    this.recordAuditEvent(input.pluginId, input.workspaceId, input.actorUserId, "plugin.file_write", {
      runtimeSessionId: input.runtimeSessionId,
      path: resolved.relativePath,
      size: buffer.byteLength
    });

    return {
      path: resolved.relativePath,
      size: buffer.byteLength,
      updatedAt: stats.mtime.toISOString()
    };
  }

  listDirectory(input: PluginFileGatewayListInput): FileNode[] {
    const detail = this.pluginRegistryService.getPlugin(input.pluginId);
    try {
      this.pluginPermissionService.requirePermissionGrant({
        manifest: detail.manifest,
        pluginId: input.pluginId,
        workspaceId: input.workspaceId,
        permissionKey: "workspace.list_dir",
        scopePath: input.requestedPath ?? null,
        runtimeSessionId: input.runtimeSessionId
      });
    } catch (error) {
      this.recordPermissionAudit(input, "workspace.list_dir", error);
      throw error;
    }

    const resolved = this.fileAccessGuard.resolvePath(input.workspaceId, input.requestedPath ?? "", {
      allowRoot: true,
      mustExist: true,
      kind: "directory"
    });

    const items = fs
      .readdirSync(resolved.absolutePath, { withFileTypes: true })
      .filter((entry) => !entry.isSymbolicLink())
      .map((entry) => {
        const childAbsolutePath = `${resolved.absolutePath}/${entry.name}`;
        const childStats = fs.statSync(childAbsolutePath);
        const childRelativePath = resolved.relativePath
          ? `${resolved.relativePath}/${entry.name}`
          : entry.name;

        return {
          path: childRelativePath.replace(/\\/g, "/"),
          name: entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
          size: entry.isDirectory() ? null : childStats.size,
          updatedAt: childStats.mtime.toISOString()
        } satisfies FileNode;
      })
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "directory" ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });

    this.recordAuditEvent(input.pluginId, input.workspaceId, input.actorUserId, "plugin.file_list", {
      runtimeSessionId: input.runtimeSessionId,
      path: resolved.relativePath,
      count: items.length
    });

    return items;
  }

  private recordAuditEvent(
    pluginId: string,
    workspaceId: string,
    actorUserId: string | null,
    operation: "plugin.file_read" | "plugin.file_write" | "plugin.file_list",
    payload: Record<string, unknown>
  ): void {
    this.pluginAuditEventRepository.create({
      id: createId(),
      pluginId,
      workspaceId,
      eventType: "plugin.action_invoked",
      actorUserId,
      payloadJson: JSON.stringify({
        operation,
        ...payload
      }),
      createdAt: nowIso()
    });
  }

  private recordPermissionAudit(
    input: PluginFileGatewayReadInput | PluginFileGatewayWriteInput | PluginFileGatewayListInput,
    permissionKey: "workspace.read_file" | "workspace.write_file" | "workspace.list_dir",
    error: unknown
  ): void {
    if (!(error instanceof Error) || !("errorCode" in error)) {
      return;
    }

    const errorCode = String((error as { errorCode?: unknown }).errorCode ?? "");
    if (errorCode === "PLUGIN_PERMISSION_DECLARATION_MISSING") {
      this.pluginPermissionService.recordPermissionDenied({
        pluginId: input.pluginId,
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        permissionKey,
        scopePath: "requestedPath" in input ? input.requestedPath ?? null : null,
        runtimeSessionId: input.runtimeSessionId,
        reason: "declaration_missing"
      });
      return;
    }

    if (errorCode === "PLUGIN_PERMISSION_GRANT_REQUIRED") {
      this.pluginPermissionService.recordPermissionDenied({
        pluginId: input.pluginId,
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        permissionKey,
        scopePath: "requestedPath" in input ? input.requestedPath ?? null : null,
        runtimeSessionId: input.runtimeSessionId,
        reason: "grant_required"
      });
      return;
    }
  }

  private reportMutation(event: PluginFileMutationEvent): void {
    this.mutationHook?.(event);
  }
}

function buildPluginFileVersion(buffer: Buffer, stats: fs.Stats): string {
  return `${buffer.byteLength}:${stats.mtimeMs}:${stats.ino}`;
}
