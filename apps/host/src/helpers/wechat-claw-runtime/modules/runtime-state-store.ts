import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { nowIso } from "../../../shared/utils/time.js";
import type {
  WechatClawAccountSessionRecord,
  WechatClawContextTokenRecord,
  WechatClawDeliveryReceiptRecord,
  WechatClawPollCheckpointRecord,
  WechatClawRuntimeLoginStatus,
  WechatClawRuntimeSessionView
} from "./types.js";

export class WechatClawRuntimeStateStore {
  private readonly db: Database.Database;

  constructor(runtimeRootDir: string) {
    fs.mkdirSync(runtimeRootDir, { recursive: true });
    const dbPath = path.join(runtimeRootDir, "runtime.sqlite");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.initializeSchema();
  }

  dispose(): void {
    this.db.close();
  }

  getAccountSession(channelAccountId: string): WechatClawAccountSessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          channel_account_id,
          status,
          login_session_key,
          login_qrcode,
          qr_code_url,
          qr_code_source_url,
          provider_account_id,
          api_base_url,
          token,
          user_id,
          last_error_code,
          last_error_message,
          login_started_at,
          expires_at,
          created_at,
          updated_at
        FROM account_sessions
        WHERE channel_account_id = ?`
      )
      .get(channelAccountId) as Record<string, unknown> | undefined;

    return row ? mapAccountSessionRow(row) : null;
  }

  saveAccountSession(
    channelAccountId: string,
    patch: Partial<WechatClawAccountSessionRecord> & {
      status: WechatClawRuntimeLoginStatus;
    }
  ): WechatClawAccountSessionRecord {
    const current = this.getAccountSession(channelAccountId);
    const timestamp = nowIso();
    const record: WechatClawAccountSessionRecord = {
      channelAccountId,
      status: patch.status,
      loginSessionKey: patch.loginSessionKey ?? current?.loginSessionKey ?? null,
      loginQrcode: patch.loginQrcode ?? current?.loginQrcode ?? null,
      qrCodeUrl: patch.qrCodeUrl ?? current?.qrCodeUrl ?? null,
      qrCodeSourceUrl: patch.qrCodeSourceUrl ?? current?.qrCodeSourceUrl ?? null,
      providerAccountId: patch.providerAccountId ?? current?.providerAccountId ?? null,
      apiBaseUrl: patch.apiBaseUrl ?? current?.apiBaseUrl ?? null,
      token: patch.token ?? current?.token ?? null,
      userId: patch.userId ?? current?.userId ?? null,
      lastErrorCode: patch.lastErrorCode ?? current?.lastErrorCode ?? null,
      lastErrorMessage: patch.lastErrorMessage ?? current?.lastErrorMessage ?? null,
      loginStartedAt: patch.loginStartedAt ?? current?.loginStartedAt ?? null,
      expiresAt: patch.expiresAt ?? current?.expiresAt ?? null,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    this.db
      .prepare(
        `INSERT INTO account_sessions (
          channel_account_id,
          status,
          login_session_key,
          login_qrcode,
          qr_code_url,
          qr_code_source_url,
          provider_account_id,
          api_base_url,
          token,
          user_id,
          last_error_code,
          last_error_message,
          login_started_at,
          expires_at,
          created_at,
          updated_at
        ) VALUES (
          @channelAccountId,
          @status,
          @loginSessionKey,
          @loginQrcode,
          @qrCodeUrl,
          @qrCodeSourceUrl,
          @providerAccountId,
          @apiBaseUrl,
          @token,
          @userId,
          @lastErrorCode,
          @lastErrorMessage,
          @loginStartedAt,
          @expiresAt,
          @createdAt,
          @updatedAt
        )
        ON CONFLICT(channel_account_id) DO UPDATE SET
          status = excluded.status,
          login_session_key = excluded.login_session_key,
          login_qrcode = excluded.login_qrcode,
          qr_code_url = excluded.qr_code_url,
          qr_code_source_url = excluded.qr_code_source_url,
          provider_account_id = excluded.provider_account_id,
          api_base_url = excluded.api_base_url,
          token = excluded.token,
          user_id = excluded.user_id,
          last_error_code = excluded.last_error_code,
          last_error_message = excluded.last_error_message,
          login_started_at = excluded.login_started_at,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at`
      )
      .run(record);

    return record;
  }

  clearAccountRuntimeState(channelAccountId: string): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM account_sessions WHERE channel_account_id = ?").run(channelAccountId);
      this.db.prepare("DELETE FROM poll_checkpoints WHERE channel_account_id = ?").run(channelAccountId);
      this.db.prepare("DELETE FROM context_tokens WHERE channel_account_id = ?").run(channelAccountId);
      this.db.prepare("DELETE FROM delivery_receipts WHERE channel_account_id = ?").run(channelAccountId);
    });
    transaction();
  }

  getPollCheckpoint(channelAccountId: string): WechatClawPollCheckpointRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          channel_account_id,
          cursor,
          latest_external_event_id,
          updated_at
        FROM poll_checkpoints
        WHERE channel_account_id = ?`
      )
      .get(channelAccountId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return {
      channelAccountId: String(row.channel_account_id),
      cursor: asNullableText(row.cursor),
      latestExternalEventId: asNullableText(row.latest_external_event_id),
      updatedAt: String(row.updated_at)
    };
  }

  setPollCheckpoint(
    channelAccountId: string,
    input: {
      cursor: string | null;
      latestExternalEventId: string | null;
    }
  ): WechatClawPollCheckpointRecord {
    const record: WechatClawPollCheckpointRecord = {
      channelAccountId,
      cursor: input.cursor,
      latestExternalEventId: input.latestExternalEventId,
      updatedAt: nowIso()
    };

    this.db
      .prepare(
        `INSERT INTO poll_checkpoints (
          channel_account_id,
          cursor,
          latest_external_event_id,
          updated_at
        ) VALUES (
          @channelAccountId,
          @cursor,
          @latestExternalEventId,
          @updatedAt
        )
        ON CONFLICT(channel_account_id) DO UPDATE SET
          cursor = excluded.cursor,
          latest_external_event_id = excluded.latest_external_event_id,
          updated_at = excluded.updated_at`
      )
      .run(record);

    return record;
  }

  getContextToken(
    channelAccountId: string,
    conversationKey: string,
    externalUserId: string
  ): WechatClawContextTokenRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          channel_account_id,
          conversation_key,
          external_user_id,
          token,
          status,
          expires_at,
          updated_at
        FROM context_tokens
        WHERE channel_account_id = ?
          AND conversation_key = ?
          AND external_user_id = ?`
      )
      .get(channelAccountId, conversationKey, externalUserId) as Record<string, unknown> | undefined;

    return row ? mapContextTokenRow(row) : null;
  }

  listContextTokensByUser(
    channelAccountId: string,
    externalUserId: string
  ): WechatClawContextTokenRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
          channel_account_id,
          conversation_key,
          external_user_id,
          token,
          status,
          expires_at,
          updated_at
        FROM context_tokens
        WHERE channel_account_id = ?
          AND external_user_id = ?
        ORDER BY updated_at DESC`
      )
      .all(channelAccountId, externalUserId) as Record<string, unknown>[];

    return rows.map(mapContextTokenRow);
  }

  upsertContextToken(
    channelAccountId: string,
    input: {
      conversationKey: string;
      externalUserId: string;
      token: string;
      status?: string;
      expiresAt?: string | null;
    }
  ): WechatClawContextTokenRecord {
    const record: WechatClawContextTokenRecord = {
      channelAccountId,
      conversationKey: input.conversationKey,
      externalUserId: input.externalUserId,
      token: input.token,
      status: input.status ?? "active",
      expiresAt: input.expiresAt ?? null,
      updatedAt: nowIso()
    };

    this.db
      .prepare(
        `INSERT INTO context_tokens (
          channel_account_id,
          conversation_key,
          external_user_id,
          token,
          status,
          expires_at,
          updated_at
        ) VALUES (
          @channelAccountId,
          @conversationKey,
          @externalUserId,
          @token,
          @status,
          @expiresAt,
          @updatedAt
        )
        ON CONFLICT(channel_account_id, conversation_key, external_user_id) DO UPDATE SET
          token = excluded.token,
          status = excluded.status,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at`
      )
      .run(record);

    return record;
  }

  saveDeliveryReceipt(
    channelAccountId: string,
    input: {
      providerMessageRef: string;
      status: string;
      errorCode?: string | null;
      errorMessage?: string | null;
    }
  ): WechatClawDeliveryReceiptRecord {
    const record: WechatClawDeliveryReceiptRecord = {
      channelAccountId,
      providerMessageRef: input.providerMessageRef,
      status: input.status,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      updatedAt: nowIso()
    };

    this.db
      .prepare(
        `INSERT INTO delivery_receipts (
          channel_account_id,
          provider_message_ref,
          status,
          error_code,
          error_message,
          updated_at
        ) VALUES (
          @channelAccountId,
          @providerMessageRef,
          @status,
          @errorCode,
          @errorMessage,
          @updatedAt
        )
        ON CONFLICT(channel_account_id, provider_message_ref) DO UPDATE SET
          status = excluded.status,
          error_code = excluded.error_code,
          error_message = excluded.error_message,
          updated_at = excluded.updated_at`
      )
      .run(record);

    return record;
  }

  toSessionView(session: WechatClawAccountSessionRecord | null): WechatClawRuntimeSessionView | null {
    if (!session) {
      return null;
    }

    return {
      channelAccountId: session.channelAccountId,
      status: session.status,
      loginSessionKey: session.loginSessionKey,
      qrCodeText: session.qrCodeSourceUrl ?? session.loginQrcode,
      qrCodeUrl: session.qrCodeUrl,
      qrCodeSourceUrl: session.qrCodeSourceUrl,
      providerAccountId: session.providerAccountId,
      userId: session.userId,
      lastErrorCode: session.lastErrorCode,
      lastErrorMessage: session.lastErrorMessage,
      loginStartedAt: session.loginStartedAt,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    };
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS account_sessions (
        channel_account_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        login_session_key TEXT,
        login_qrcode TEXT,
        qr_code_url TEXT,
        qr_code_source_url TEXT,
        provider_account_id TEXT,
        api_base_url TEXT,
        token TEXT,
        user_id TEXT,
        last_error_code TEXT,
        last_error_message TEXT,
        login_started_at TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS poll_checkpoints (
        channel_account_id TEXT PRIMARY KEY,
        cursor TEXT,
        latest_external_event_id TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS context_tokens (
        channel_account_id TEXT NOT NULL,
        conversation_key TEXT NOT NULL,
        external_user_id TEXT NOT NULL,
        token TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(channel_account_id, conversation_key, external_user_id)
      );

      CREATE TABLE IF NOT EXISTS delivery_receipts (
        channel_account_id TEXT NOT NULL,
        provider_message_ref TEXT NOT NULL,
        status TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(channel_account_id, provider_message_ref)
      );
    `);

    this.ensureColumn("account_sessions", "qr_code_source_url", "TEXT");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
    const exists = rows.some((row) => String(row.name ?? "") === column);
    if (exists) {
      return;
    }

    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function mapAccountSessionRow(row: Record<string, unknown>): WechatClawAccountSessionRecord {
  return {
    channelAccountId: String(row.channel_account_id),
    status: String(row.status) as WechatClawRuntimeLoginStatus,
    loginSessionKey: asNullableText(row.login_session_key),
    loginQrcode: asNullableText(row.login_qrcode),
    qrCodeUrl: asNullableText(row.qr_code_url),
    qrCodeSourceUrl: asNullableText(row.qr_code_source_url),
    providerAccountId: asNullableText(row.provider_account_id),
    apiBaseUrl: asNullableText(row.api_base_url),
    token: asNullableText(row.token),
    userId: asNullableText(row.user_id),
    lastErrorCode: asNullableText(row.last_error_code),
    lastErrorMessage: asNullableText(row.last_error_message),
    loginStartedAt: asNullableText(row.login_started_at),
    expiresAt: asNullableText(row.expires_at),
    createdAt: asNullableText(row.created_at),
    updatedAt: asNullableText(row.updated_at)
  };
}

function mapContextTokenRow(row: Record<string, unknown>): WechatClawContextTokenRecord {
  return {
    channelAccountId: String(row.channel_account_id),
    conversationKey: String(row.conversation_key),
    externalUserId: String(row.external_user_id),
    token: String(row.token),
    status: String(row.status),
    expiresAt: asNullableText(row.expires_at),
    updatedAt: String(row.updated_at)
  };
}

function asNullableText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
