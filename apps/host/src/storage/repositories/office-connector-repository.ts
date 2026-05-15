import type Database from "better-sqlite3";

import type { OfficeConnector, OfficeConnectorKind } from "../../types/domain.js";

export class OfficeConnectorRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: OfficeConnector): OfficeConnector {
    this.db
      .prepare(
        `INSERT INTO office_connectors (
           id,
           connector_key,
           kind,
           display_name,
           capability_json,
           status,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.connectorKey,
        record.kind,
        record.displayName,
        record.capabilityJson,
        record.status,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  findById(id: string): OfficeConnector | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           connector_key,
           kind,
           display_name,
           capability_json,
           status,
           created_at,
           updated_at
         FROM office_connectors
         WHERE id = ?`
      )
      .get(id) as OfficeConnectorRow | undefined;

    return row ? mapOfficeConnectorRow(row) : null;
  }

  findByKey(connectorKey: string): OfficeConnector | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           connector_key,
           kind,
           display_name,
           capability_json,
           status,
           created_at,
           updated_at
         FROM office_connectors
         WHERE connector_key = ?`
      )
      .get(connectorKey) as OfficeConnectorRow | undefined;

    return row ? mapOfficeConnectorRow(row) : null;
  }

  list(kind?: OfficeConnectorKind): OfficeConnector[] {
    const rows = kind
      ? this.db
        .prepare(
          `SELECT
             id,
             connector_key,
             kind,
             display_name,
             capability_json,
             status,
             created_at,
             updated_at
           FROM office_connectors
           WHERE kind = ?
           ORDER BY connector_key ASC`
        )
        .all(kind)
      : this.db
        .prepare(
          `SELECT
             id,
             connector_key,
             kind,
             display_name,
             capability_json,
             status,
             created_at,
             updated_at
           FROM office_connectors
           ORDER BY connector_key ASC`
        )
        .all();

    return rows.map((row) => mapOfficeConnectorRow(row as OfficeConnectorRow));
  }
}

interface OfficeConnectorRow {
  id: string;
  connector_key: string;
  kind: OfficeConnectorKind;
  display_name: string;
  capability_json: string;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
}

function mapOfficeConnectorRow(row: OfficeConnectorRow): OfficeConnector {
  return {
    id: row.id,
    connectorKey: row.connector_key,
    kind: row.kind,
    displayName: row.display_name,
    capabilityJson: row.capability_json,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
