import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { PluginAuditEventRepository } from "../../storage/repositories/plugin-audit-event-repository.js";
import type { PluginDefinitionRepository } from "../../storage/repositories/plugin-definition-repository.js";
import type { PluginEnablementRepository } from "../../storage/repositories/plugin-enablement-repository.js";
import type {
  PluginAuditEvent,
  PluginDefinition,
  PluginEnablement,
  PluginManifest
} from "../../types/domain.js";
import { readPluginManifest } from "./plugin-manifest.js";

interface PluginRegistryLogger {
  warn(bindings: Record<string, unknown>, message: string): void;
  info?(bindings: Record<string, unknown>, message: string): void;
}

export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  installRoot: string;
  hasFrontend: boolean;
  hasBackend: boolean;
  updatedAt: string;
}

export interface PluginDetail {
  definition: PluginDefinition;
  manifest: PluginManifest;
  enablement: PluginEnablement;
  auditEvents: PluginAuditEvent[];
}

export class PluginRegistryService {
  constructor(
    private readonly pluginDefinitionRepository: PluginDefinitionRepository,
    private readonly pluginEnablementRepository: PluginEnablementRepository,
    private readonly pluginAuditEventRepository: PluginAuditEventRepository,
    private readonly pluginRootDir: string,
    private readonly logger: PluginRegistryLogger
  ) {
    fs.mkdirSync(this.pluginRootDir, { recursive: true });
  }

  listPlugins(): PluginSummary[] {
    this.syncPluginsFromDisk();

    return this.pluginDefinitionRepository.list().map((definition) => {
      const enablement = this.getOrCreateEnablement(definition.id);
      const manifest = parseStoredManifest(definition.manifestJson, definition.id);

      return {
        id: definition.id,
        name: manifest.name,
        version: manifest.version,
        enabled: enablement.enabled,
        installRoot: definition.installRoot,
        hasFrontend: definition.hasFrontend,
        hasBackend: definition.hasBackend,
        updatedAt: definition.updatedAt
      };
    });
  }

  getPlugin(pluginId: string): PluginDetail {
    this.syncPluginsFromDisk();
    const definition = this.requireDefinition(pluginId);
    const enablement = this.getOrCreateEnablement(pluginId);

    return {
      definition,
      manifest: parseStoredManifest(definition.manifestJson, definition.id),
      enablement,
      auditEvents: this.pluginAuditEventRepository.listByPluginId(pluginId, 50)
    };
  }

  enablePlugin(pluginId: string, userId: string): PluginEnablement {
    this.syncPluginsFromDisk();
    this.requireDefinition(pluginId);
    const current = this.getOrCreateEnablement(pluginId);
    const timestamp = nowIso();
    const next: PluginEnablement = {
      pluginId,
      enabled: true,
      enabledByUserId: userId,
      enabledAt: timestamp,
      disabledByUserId: current.disabledByUserId,
      disabledAt: current.disabledAt,
      reason: null,
      updatedAt: timestamp
    };

    this.pluginEnablementRepository.upsert(next);
    this.recordAuditEvent(pluginId, "plugin.enabled", userId, {
      enabled: true
    });
    return next;
  }

  disablePlugin(pluginId: string, userId: string, reason?: string | null): PluginEnablement {
    this.syncPluginsFromDisk();
    this.requireDefinition(pluginId);
    const current = this.getOrCreateEnablement(pluginId);
    const timestamp = nowIso();
    const next: PluginEnablement = {
      pluginId,
      enabled: false,
      enabledByUserId: current.enabledByUserId,
      enabledAt: current.enabledAt,
      disabledByUserId: userId,
      disabledAt: timestamp,
      reason: reason?.trim() || null,
      updatedAt: timestamp
    };

    this.pluginEnablementRepository.upsert(next);
    this.recordAuditEvent(pluginId, "plugin.disabled", userId, {
      enabled: false,
      reason: next.reason
    });
    return next;
  }

  syncPluginsFromDisk(): void {
    const directoryEntries = fs.existsSync(this.pluginRootDir)
      ? fs.readdirSync(this.pluginRootDir, { withFileTypes: true })
      : [];
    const seenPluginIds = new Map<string, string>();
    const existingDefinitions = this.pluginDefinitionRepository.list();

    for (const entry of directoryEntries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }

      const installRoot = path.join(this.pluginRootDir, entry.name);
      const manifestPath = path.join(installRoot, "plugin.json");

      if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
        continue;
      }

      try {
        const parsed = readPluginManifest(installRoot);
        const previousRoot = seenPluginIds.get(parsed.manifest.id);

        if (previousRoot && previousRoot !== installRoot) {
          throw new AppError({
            statusCode: 409,
            errorCode: "PLUGIN_ID_CONFLICT",
            detail: `插件 id 冲突：${parsed.manifest.id} 已被目录 ${previousRoot} 占用`
          });
        }

        seenPluginIds.set(parsed.manifest.id, installRoot);
        const previousDefinition = this.pluginDefinitionRepository.findById(parsed.manifest.id);
        const timestamp = nowIso();
        const definition: PluginDefinition = {
          id: parsed.manifest.id,
          version: parsed.manifest.version,
          name: parsed.manifest.name,
          installRoot,
          manifestJson: JSON.stringify(parsed.manifest),
          hasFrontend: Boolean(parsed.manifest.frontend),
          hasBackend: Boolean(parsed.manifest.backend),
          createdAt: previousDefinition?.createdAt ?? timestamp,
          updatedAt: timestamp
        };

        this.pluginDefinitionRepository.upsert(definition);
        this.getOrCreateEnablement(definition.id);
        this.recordAuditEvent(definition.id, "plugin.registered", null, {
          installRoot,
          version: definition.version
        });
      } catch (error) {
        const pluginId = tryReadPluginId(manifestPath) ?? entry.name;
        const detail = error instanceof Error ? error.message : "未知错误";

        this.logger.warn(
          {
            pluginId,
            installRoot,
            detail
          },
          "插件注册失败"
        );
        this.recordAuditEvent(pluginId, "plugin.registration_failed", null, {
          installRoot,
          detail
        });
      }
    }

    for (const definition of existingDefinitions) {
      if (seenPluginIds.has(definition.id)) {
        continue;
      }

      if (!definition.installRoot.startsWith(path.resolve(this.pluginRootDir))) {
        continue;
      }

      const enablement = this.pluginEnablementRepository.findByPluginId(definition.id);
      if (enablement?.enabled) {
        this.pluginEnablementRepository.upsert({
          ...enablement,
          enabled: false,
          disabledAt: nowIso(),
          disabledByUserId: enablement.disabledByUserId,
          reason: "插件目录已移除",
          updatedAt: nowIso()
        });
      }

      this.pluginDefinitionRepository.deleteById(definition.id);
      this.recordAuditEvent(definition.id, "plugin.disabled", null, {
        reason: "插件目录已移除"
      });
    }
  }

  private requireDefinition(pluginId: string): PluginDefinition {
    const definition = this.pluginDefinitionRepository.findById(pluginId.trim());
    if (!definition) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PLUGIN_NOT_FOUND",
        detail: "未找到对应插件"
      });
    }

    return definition;
  }

  private getOrCreateEnablement(pluginId: string): PluginEnablement {
    const existing = this.pluginEnablementRepository.findByPluginId(pluginId);
    if (existing) {
      return existing;
    }

    const record: PluginEnablement = {
      pluginId,
      enabled: false,
      enabledByUserId: null,
      enabledAt: null,
      disabledByUserId: null,
      disabledAt: null,
      reason: null,
      updatedAt: nowIso()
    };
    this.pluginEnablementRepository.upsert(record);
    return record;
  }

  private recordAuditEvent(
    pluginId: string,
    eventType: PluginAuditEvent["eventType"],
    actorUserId: string | null,
    payload: Record<string, unknown>
  ): void {
    this.pluginAuditEventRepository.create({
      id: createId(),
      pluginId,
      workspaceId: null,
      eventType,
      actorUserId,
      payloadJson: JSON.stringify(payload),
      createdAt: nowIso()
    });
  }
}

function parseStoredManifest(manifestJson: string, pluginId: string): PluginManifest {
  try {
    return JSON.parse(manifestJson) as PluginManifest;
  } catch {
    throw new AppError({
      statusCode: 500,
      errorCode: "PLUGIN_MANIFEST_CORRUPTED",
      detail: `插件 ${pluginId} 的 manifest 数据损坏`
    });
  }
}

function tryReadPluginId(manifestPath: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { id?: unknown };
    return typeof parsed.id === "string" && parsed.id.trim().length > 0 ? parsed.id.trim() : null;
  } catch {
    return null;
  }
}
