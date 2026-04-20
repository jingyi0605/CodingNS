import type Database from "better-sqlite3";

import type {
  InstanceRelayTunnelConfig,
  InstanceRelayTunnelStatus,
  RelayTunnelProvider
} from "../../types/domain.js";

export class InstanceRelayTunnelRepository {
  constructor(private readonly db: Database.Database) {}

  findConfig(): InstanceRelayTunnelConfig | null {
    const row = this.db
      .prepare(
        `SELECT
           activated,
           enabled,
           provider,
           relay_base_url,
           control_base_url,
           control_access_token_ciphertext,
           control_account_email,
           control_session_expires_at,
           account_id,
           tunnel_domain,
           binding_id,
           host_public_key,
           host_key_fingerprint,
           local_target_base_url,
           local_target_source,
           updated_at
         FROM instance_relay_tunnel_config
         WHERE id = 'default'`
      )
      .get() as InstanceRelayTunnelConfigRow | undefined;

    return row ? mapConfigRow(row) : null;
  }

  upsertConfig(config: InstanceRelayTunnelConfig): InstanceRelayTunnelConfig {
    this.db
      .prepare(
        `INSERT INTO instance_relay_tunnel_config (
          id,
          activated,
          enabled,
          provider,
          relay_base_url,
          control_base_url,
          control_access_token_ciphertext,
          control_account_email,
          control_session_expires_at,
          account_id,
          tunnel_domain,
          binding_id,
          host_public_key,
          host_key_fingerprint,
          local_target_base_url,
          local_target_source,
          updated_at
        ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          activated = excluded.activated,
          enabled = excluded.enabled,
          provider = excluded.provider,
          relay_base_url = excluded.relay_base_url,
          control_base_url = excluded.control_base_url,
          control_access_token_ciphertext = excluded.control_access_token_ciphertext,
          control_account_email = excluded.control_account_email,
          control_session_expires_at = excluded.control_session_expires_at,
          account_id = excluded.account_id,
          tunnel_domain = excluded.tunnel_domain,
          binding_id = excluded.binding_id,
          host_public_key = excluded.host_public_key,
          host_key_fingerprint = excluded.host_key_fingerprint,
          local_target_base_url = excluded.local_target_base_url,
          local_target_source = excluded.local_target_source,
          updated_at = excluded.updated_at`
      )
      .run(
        config.activated ? 1 : 0,
        config.enabled ? 1 : 0,
        config.provider,
        config.relayBaseUrl,
        config.controlBaseUrl,
        config.controlAccessTokenCiphertext,
        config.controlAccountEmail,
        config.controlSessionExpiresAt,
        config.accountId,
        config.tunnelDomain,
        config.bindingId,
        config.hostPublicKey,
        config.hostKeyFingerprint,
        config.localTargetBaseUrl,
        config.localTargetBaseUrlSource ?? "default",
        config.updatedAt
      );

    return config;
  }

  findStatus(): InstanceRelayTunnelStatus | null {
    const row = this.db
      .prepare(
        `SELECT
           phase,
           connected,
           binding_id,
           tunnel_domain,
           host_fingerprint,
           traffic_used_bytes,
           traffic_remaining_bytes,
           quota_reset_at,
           last_error,
           observed_at
         FROM instance_relay_tunnel_status
         WHERE id = 'default'`
      )
      .get() as InstanceRelayTunnelStatusRow | undefined;

    return row ? mapStatusRow(row) : null;
  }

  upsertStatus(status: InstanceRelayTunnelStatus): InstanceRelayTunnelStatus {
    this.db
      .prepare(
        `INSERT INTO instance_relay_tunnel_status (
          id,
          phase,
          connected,
          binding_id,
          tunnel_domain,
          host_fingerprint,
          traffic_used_bytes,
          traffic_remaining_bytes,
          quota_reset_at,
          last_error,
          observed_at
        ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          phase = excluded.phase,
          connected = excluded.connected,
          binding_id = excluded.binding_id,
          tunnel_domain = excluded.tunnel_domain,
          host_fingerprint = excluded.host_fingerprint,
          traffic_used_bytes = excluded.traffic_used_bytes,
          traffic_remaining_bytes = excluded.traffic_remaining_bytes,
          quota_reset_at = excluded.quota_reset_at,
          last_error = excluded.last_error,
          observed_at = excluded.observed_at`
      )
      .run(
        status.phase,
        status.connected ? 1 : 0,
        status.bindingId,
        status.tunnelDomain,
        status.hostFingerprint,
        status.trafficUsedBytes,
        status.trafficRemainingBytes,
        status.quotaResetAt,
        status.lastError,
        status.observedAt
      );

    return status;
  }
}

interface InstanceRelayTunnelConfigRow {
  activated: number;
  enabled: number;
  provider: RelayTunnelProvider;
  relay_base_url: string | null;
  control_base_url: string | null;
  control_access_token_ciphertext: string | null;
  control_account_email: string | null;
  control_session_expires_at: string | null;
  account_id: string | null;
  tunnel_domain: string | null;
  binding_id: string | null;
  host_public_key: string | null;
  host_key_fingerprint: string | null;
  local_target_base_url: string;
  local_target_source: "default" | "custom";
  updated_at: string;
}

interface InstanceRelayTunnelStatusRow {
  phase: InstanceRelayTunnelStatus["phase"];
  connected: number;
  binding_id: string | null;
  tunnel_domain: string | null;
  host_fingerprint: string | null;
  traffic_used_bytes: string | null;
  traffic_remaining_bytes: string | null;
  quota_reset_at: string | null;
  last_error: string | null;
  observed_at: string | null;
}

function mapConfigRow(row: InstanceRelayTunnelConfigRow): InstanceRelayTunnelConfig {
  return {
    activated: Boolean(row.activated),
    enabled: Boolean(row.enabled),
    provider: row.provider,
    relayBaseUrl: row.relay_base_url,
    controlBaseUrl: row.control_base_url,
    controlAccessTokenCiphertext: row.control_access_token_ciphertext,
    controlAccountEmail: row.control_account_email,
    controlSessionExpiresAt: row.control_session_expires_at,
    accountId: row.account_id,
    tunnelDomain: row.tunnel_domain,
    bindingId: row.binding_id,
    hostPublicKey: row.host_public_key,
    hostKeyFingerprint: row.host_key_fingerprint,
    localTargetBaseUrl: row.local_target_base_url,
    localTargetBaseUrlSource: row.local_target_source,
    updatedAt: row.updated_at
  };
}

function mapStatusRow(row: InstanceRelayTunnelStatusRow): InstanceRelayTunnelStatus {
  return {
    phase: row.phase,
    connected: Boolean(row.connected),
    bindingId: row.binding_id,
    tunnelDomain: row.tunnel_domain,
    hostFingerprint: row.host_fingerprint,
    trafficUsedBytes: row.traffic_used_bytes,
    trafficRemainingBytes: row.traffic_remaining_bytes,
    quotaResetAt: row.quota_reset_at,
    lastError: row.last_error,
    observedAt: row.observed_at
  };
}
