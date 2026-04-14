import type Database from "better-sqlite3";

import type { RuntimeBinding } from "../../types/domain.js";

export class RuntimeBindingRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: RuntimeBinding): RuntimeBinding {
    this.db
      .prepare(
        `INSERT INTO runtime_bindings (
          id,
          runtime_id,
          service_id,
          process_instance_id,
          expected_port,
          leased_port,
          observed_port,
          proxy_path,
          status,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.runtimeId,
        record.serviceId,
        record.processInstanceId ?? null,
        record.expectedPort ?? null,
        record.leasedPort ?? null,
        record.observedPort ?? null,
        record.proxyPath ?? null,
        record.status,
        record.updatedAt
      );

    return record;
  }

  listByRuntimeId(runtimeId: string): RuntimeBinding[] {
    return this.db
      .prepare(
        `SELECT
          id,
          runtime_id,
          service_id,
          process_instance_id,
          expected_port,
          leased_port,
          observed_port,
          proxy_path,
          status,
          updated_at
        FROM runtime_bindings
        WHERE runtime_id = ?
        ORDER BY updated_at DESC`
      )
      .all(runtimeId)
      .map((row) => mapRuntimeBindingRow(row as RuntimeBindingRow));
  }

  update(record: RuntimeBinding): RuntimeBinding | null {
    this.db
      .prepare(
        `UPDATE runtime_bindings
         SET process_instance_id = ?,
             expected_port = ?,
             leased_port = ?,
             observed_port = ?,
             proxy_path = ?,
             status = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        record.processInstanceId ?? null,
        record.expectedPort ?? null,
        record.leasedPort ?? null,
        record.observedPort ?? null,
        record.proxyPath ?? null,
        record.status,
        record.updatedAt,
        record.id
      );

    return this.findById(record.id);
  }

  findById(id: string): RuntimeBinding | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          runtime_id,
          service_id,
          process_instance_id,
          expected_port,
          leased_port,
          observed_port,
          proxy_path,
          status,
          updated_at
        FROM runtime_bindings
        WHERE id = ?`
      )
      .get(id) as RuntimeBindingRow | undefined;

    return row ? mapRuntimeBindingRow(row) : null;
  }
}

interface RuntimeBindingRow {
  id: string;
  runtime_id: string;
  service_id: string;
  process_instance_id: string | null;
  expected_port: number | null;
  leased_port: number | null;
  observed_port: number | null;
  proxy_path: string | null;
  status: RuntimeBinding["status"];
  updated_at: string;
}

function mapRuntimeBindingRow(row: RuntimeBindingRow): RuntimeBinding {
  return {
    id: row.id,
    runtimeId: row.runtime_id,
    serviceId: row.service_id,
    processInstanceId: row.process_instance_id,
    expectedPort: row.expected_port,
    leasedPort: row.leased_port,
    observedPort: row.observed_port,
    proxyPath: row.proxy_path,
    status: row.status,
    updatedAt: row.updated_at
  };
}
