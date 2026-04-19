import type Database from "better-sqlite3";

import type {
  InstanceTailscaleConfig,
  InstanceTailscaleStatus
} from "../../types/domain.js";

export class InstanceTailscaleRepository {
  constructor(private readonly db: Database.Database) {}

  findConfig(): InstanceTailscaleConfig | null {
    const row = this.db
      .prepare(
        `SELECT activated, enabled, control_server_url, hostname, state_dir, updated_at
         FROM instance_tailscale_config
         WHERE id = 'default'`
      )
      .get() as InstanceTailscaleConfigRow | undefined;

    return row ? mapConfigRow(row) : null;
  }

  upsertConfig(config: InstanceTailscaleConfig): InstanceTailscaleConfig {
    this.db
      .prepare(
        `INSERT INTO instance_tailscale_config (
          id,
          activated,
          enabled,
          control_server_url,
          hostname,
          state_dir,
          updated_at
        ) VALUES ('default', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          activated = excluded.activated,
          enabled = excluded.enabled,
          control_server_url = excluded.control_server_url,
          hostname = excluded.hostname,
          state_dir = excluded.state_dir,
          updated_at = excluded.updated_at`
      )
      .run(
        config.activated ? 1 : 0,
        config.enabled ? 1 : 0,
        config.controlServerUrl,
        config.hostname,
        config.stateDir,
        config.updatedAt
      );

    return config;
  }

  findStatus(): InstanceTailscaleStatus | null {
    const row = this.db
      .prepare(
        `SELECT
           phase,
           connected,
           login_url,
           control_server_url,
           hostname,
           account_name,
           tailnet_fqdn,
           tailnet_ipv4,
           tailnet_ipv6,
           reachable_base_url,
           last_error,
           observed_at
         FROM instance_tailscale_status
         WHERE id = 'default'`
      )
      .get() as InstanceTailscaleStatusRow | undefined;

    return row ? mapStatusRow(row) : null;
  }

  upsertStatus(status: InstanceTailscaleStatus): InstanceTailscaleStatus {
    this.db
      .prepare(
        `INSERT INTO instance_tailscale_status (
          id,
          phase,
          connected,
          login_url,
          control_server_url,
          hostname,
          account_name,
          tailnet_fqdn,
          tailnet_ipv4,
          tailnet_ipv6,
          reachable_base_url,
          last_error,
          observed_at
        ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          phase = excluded.phase,
          connected = excluded.connected,
          login_url = excluded.login_url,
          control_server_url = excluded.control_server_url,
          hostname = excluded.hostname,
          account_name = excluded.account_name,
          tailnet_fqdn = excluded.tailnet_fqdn,
          tailnet_ipv4 = excluded.tailnet_ipv4,
          tailnet_ipv6 = excluded.tailnet_ipv6,
          reachable_base_url = excluded.reachable_base_url,
          last_error = excluded.last_error,
          observed_at = excluded.observed_at`
      )
      .run(
        status.phase,
        status.connected ? 1 : 0,
        status.loginUrl,
        status.controlServerUrl,
        status.hostname,
        status.accountName,
        status.tailnetFqdn,
        status.tailnetIpv4,
        status.tailnetIpv6,
        status.reachableBaseUrl,
        status.lastError,
        status.observedAt
      );

    return status;
  }
}

interface InstanceTailscaleConfigRow {
  activated: number;
  enabled: number;
  control_server_url: string | null;
  hostname: string | null;
  state_dir: string;
  updated_at: string;
}

interface InstanceTailscaleStatusRow {
  phase: InstanceTailscaleStatus["phase"];
  connected: number;
  login_url: string | null;
  control_server_url: string | null;
  hostname: string | null;
  account_name: string | null;
  tailnet_fqdn: string | null;
  tailnet_ipv4: string | null;
  tailnet_ipv6: string | null;
  reachable_base_url: string | null;
  last_error: string | null;
  observed_at: string | null;
}

function mapConfigRow(row: InstanceTailscaleConfigRow): InstanceTailscaleConfig {
  return {
    activated: Boolean(row.activated),
    enabled: Boolean(row.enabled),
    controlServerUrl: row.control_server_url,
    hostname: row.hostname,
    stateDir: row.state_dir,
    updatedAt: row.updated_at
  };
}

function mapStatusRow(row: InstanceTailscaleStatusRow): InstanceTailscaleStatus {
  return {
    phase: row.phase,
    connected: Boolean(row.connected),
    loginUrl: row.login_url,
    controlServerUrl: row.control_server_url,
    hostname: row.hostname,
    accountName: row.account_name,
    tailnetFqdn: row.tailnet_fqdn,
    tailnetIpv4: row.tailnet_ipv4,
    tailnetIpv6: row.tailnet_ipv6,
    reachableBaseUrl: row.reachable_base_url,
    lastError: row.last_error,
    observedAt: row.observed_at
  };
}
