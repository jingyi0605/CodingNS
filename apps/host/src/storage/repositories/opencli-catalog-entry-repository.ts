import type Database from "better-sqlite3";

import type { OpenCliCatalogEntryRecord, OpenCliProviderId } from "../../types/domain.js";

export class OpenCliCatalogEntryRepository {
  constructor(private readonly db: Database.Database) {}

  list(providerId: OpenCliProviderId = "opencli"): OpenCliCatalogEntryRecord[] {
    return this.db
      .prepare(
        `SELECT
           provider_id,
           command_id,
           site,
           name,
           description,
           strategy,
           browser,
           module_path,
           source_file,
           enabled,
           sort_order
         FROM opencli_catalog_entries
         WHERE provider_id = ?
         ORDER BY site ASC, sort_order ASC, command_id ASC`
      )
      .all(providerId)
      .map((row) => mapOpenCliCatalogEntryRow(row as OpenCliCatalogEntryRow));
  }

  replaceAll(
    providerId: OpenCliProviderId,
    entries: readonly OpenCliCatalogEntryRecord[]
  ): OpenCliCatalogEntryRecord[] {
    const deleteStatement = this.db.prepare(
      `DELETE FROM opencli_catalog_entries
       WHERE provider_id = ?`
    );
    const insertStatement = this.db.prepare(
      `INSERT INTO opencli_catalog_entries (
         provider_id,
         command_id,
         site,
         name,
         description,
         strategy,
         browser,
         module_path,
         source_file,
         enabled,
         sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const runInTransaction = this.db.transaction(
      (targetProviderId: OpenCliProviderId, nextEntries: readonly OpenCliCatalogEntryRecord[]) => {
        deleteStatement.run(targetProviderId);

        nextEntries.forEach((entry) => {
          insertStatement.run(
            targetProviderId,
            entry.commandId,
            entry.site,
            entry.name,
            entry.description,
            entry.strategy,
            entry.browser ? 1 : 0,
            entry.modulePath,
            entry.sourceFile,
            entry.enabled ? 1 : 0,
            entry.sortOrder
          );
        });
      }
    );

    runInTransaction(providerId, entries);

    return entries.map((entry) => ({ ...entry, providerId }));
  }

  replaceEnabledStates(
    providerId: OpenCliProviderId,
    enabledCommandIds: readonly string[]
  ): OpenCliCatalogEntryRecord[] {
    const enabledCommandIdSet = new Set(enabledCommandIds);
    const updateDisabledStatement = this.db.prepare(
      `UPDATE opencli_catalog_entries
       SET enabled = 0
       WHERE provider_id = ?`
    );
    const updateEnabledStatement = this.db.prepare(
      `UPDATE opencli_catalog_entries
       SET enabled = 1
       WHERE provider_id = ?
         AND command_id = ?`
    );
    const runInTransaction = this.db.transaction(
      (targetProviderId: OpenCliProviderId, targetCommandIds: readonly string[]) => {
        updateDisabledStatement.run(targetProviderId);

        targetCommandIds.forEach((commandId) => {
          updateEnabledStatement.run(targetProviderId, commandId);
        });
      }
    );

    runInTransaction(providerId, [...enabledCommandIdSet]);

    return this.list(providerId);
  }
}

interface OpenCliCatalogEntryRow {
  provider_id: OpenCliCatalogEntryRecord["providerId"];
  command_id: string;
  site: string;
  name: string;
  description: string;
  strategy: string;
  browser: number;
  module_path: string | null;
  source_file: string | null;
  enabled: number;
  sort_order: number;
}

function mapOpenCliCatalogEntryRow(row: OpenCliCatalogEntryRow): OpenCliCatalogEntryRecord {
  return {
    providerId: row.provider_id,
    commandId: row.command_id,
    site: row.site,
    name: row.name,
    description: row.description,
    strategy: row.strategy,
    browser: row.browser === 1,
    modulePath: row.module_path,
    sourceFile: row.source_file,
    enabled: row.enabled === 1,
    sortOrder: row.sort_order
  };
}
