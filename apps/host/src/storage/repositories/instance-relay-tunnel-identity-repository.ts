import type Database from "better-sqlite3";

import type { InstanceRelayTunnelIdentity } from "../../types/domain.js";

export class InstanceRelayTunnelIdentityRepository {
  constructor(private readonly db: Database.Database) {}

  findIdentity(): InstanceRelayTunnelIdentity | null {
    const row = this.db
      .prepare(
        `SELECT
           key_algorithm,
           private_key_pem,
           public_key_pem,
           key_fingerprint,
           created_at,
           updated_at
         FROM instance_relay_tunnel_identity
         WHERE id = 'default'`
      )
      .get() as InstanceRelayTunnelIdentityRow | undefined;

    return row ? mapIdentityRow(row) : null;
  }

  upsertIdentity(identity: InstanceRelayTunnelIdentity): InstanceRelayTunnelIdentity {
    this.db
      .prepare(
        `INSERT INTO instance_relay_tunnel_identity (
          id,
          key_algorithm,
          private_key_pem,
          public_key_pem,
          key_fingerprint,
          created_at,
          updated_at
        ) VALUES ('default', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          key_algorithm = excluded.key_algorithm,
          private_key_pem = excluded.private_key_pem,
          public_key_pem = excluded.public_key_pem,
          key_fingerprint = excluded.key_fingerprint,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`
      )
      .run(
        identity.keyAlgorithm,
        identity.privateKeyPem,
        identity.publicKeyPem,
        identity.keyFingerprint,
        identity.createdAt,
        identity.updatedAt
      );

    return identity;
  }
}

interface InstanceRelayTunnelIdentityRow {
  key_algorithm: InstanceRelayTunnelIdentity["keyAlgorithm"];
  private_key_pem: string;
  public_key_pem: string;
  key_fingerprint: string;
  created_at: string;
  updated_at: string;
}

function mapIdentityRow(row: InstanceRelayTunnelIdentityRow): InstanceRelayTunnelIdentity {
  return {
    keyAlgorithm: row.key_algorithm,
    privateKeyPem: row.private_key_pem,
    publicKeyPem: row.public_key_pem,
    keyFingerprint: row.key_fingerprint,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
