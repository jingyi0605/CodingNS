import type Database from "better-sqlite3";

import type { PortLeaseRecord, PortLeaseStatus } from "../../types/domain.js";

export class PortLeaseRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: PortLeaseRecord): PortLeaseRecord {
    this.db
      .prepare(
        `INSERT INTO port_leases (
          id,
          runtime_id,
          service_id,
          port,
          protocol,
          status,
          leased_at,
          expires_at,
          released_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.runtimeId,
        record.serviceId,
        record.port,
        record.protocol,
        record.status,
        record.leasedAt,
        record.expiresAt ?? null,
        record.releasedAt ?? null
      );

    return record;
  }

  listByRuntimeId(runtimeId: string): PortLeaseRecord[] {
    return this.db
      .prepare(
        `SELECT
          id,
          runtime_id,
          service_id,
          port,
          protocol,
          status,
          leased_at,
          expires_at,
          released_at
        FROM port_leases
        WHERE runtime_id = ?
        ORDER BY leased_at DESC`
      )
      .all(runtimeId)
      .map((row) => mapPortLeaseRow(row as PortLeaseRow));
  }

  update(record: PortLeaseRecord): PortLeaseRecord | null {
    this.db
      .prepare(
        `UPDATE port_leases
         SET status = ?,
             expires_at = ?,
             released_at = ?
         WHERE id = ?`
      )
      .run(record.status, record.expiresAt ?? null, record.releasedAt ?? null, record.id);

    return this.findById(record.id);
  }

  findById(id: string): PortLeaseRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          runtime_id,
          service_id,
          port,
          protocol,
          status,
          leased_at,
          expires_at,
          released_at
        FROM port_leases
        WHERE id = ?`
      )
      .get(id) as PortLeaseRow | undefined;

    return row ? mapPortLeaseRow(row) : null;
  }

  findActiveByPort(port: number, protocol: PortLeaseRecord["protocol"]): PortLeaseRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          runtime_id,
          service_id,
          port,
          protocol,
          status,
          leased_at,
          expires_at,
          released_at
        FROM port_leases
        WHERE port = ?
          AND protocol = ?
          AND status IN ('LEASED', 'RELEASING')
        ORDER BY leased_at DESC
        LIMIT 1`
      )
      .get(port, protocol) as PortLeaseRow | undefined;

    return row ? mapPortLeaseRow(row) : null;
  }

  listByStatuses(statuses: PortLeaseStatus[]): PortLeaseRecord[] {
    if (statuses.length === 0) {
      return [];
    }

    const placeholders = statuses.map(() => "?").join(", ");

    return this.db
      .prepare(
        `SELECT
          id,
          runtime_id,
          service_id,
          port,
          protocol,
          status,
          leased_at,
          expires_at,
          released_at
        FROM port_leases
        WHERE status IN (${placeholders})
        ORDER BY leased_at DESC`
      )
      .all(...statuses)
      .map((row) => mapPortLeaseRow(row as PortLeaseRow));
  }
}

interface PortLeaseRow {
  id: string;
  runtime_id: string;
  service_id: string;
  port: number;
  protocol: PortLeaseRecord["protocol"];
  status: PortLeaseRecord["status"];
  leased_at: string;
  expires_at: string | null;
  released_at: string | null;
}

function mapPortLeaseRow(row: PortLeaseRow): PortLeaseRecord {
  return {
    id: row.id,
    runtimeId: row.runtime_id,
    serviceId: row.service_id,
    port: row.port,
    protocol: row.protocol,
    status: row.status,
    leasedAt: row.leased_at,
    expiresAt: row.expires_at,
    releasedAt: row.released_at
  };
}
