#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";

function main() {
  const codingHome = path.join(os.homedir(), ".codingns");
  const databasePath = path.join(codingHome, "host.sqlite");
  const runtimeRoot = path.join(path.dirname(databasePath), "butler-runtime");
  const targets = [
    path.join(codingHome, "butler-workspace"),
    path.join(codingHome, "workspace-session-runtime"),
    path.join(codingHome, ".legna", "sessions"),
    runtimeRoot
  ];

  assertExists(databasePath);

  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");

  const rows = db
    .prepare(
      `SELECT session_id, provider_session_id, raw_store_ref, runtime_home_dir
       FROM session_bindings
       WHERE raw_store_ref LIKE '%butler-runtime%'
          OR raw_store_ref LIKE '%pending://codex/%'
          OR provider_session_id LIKE 'pending://codex/%'
          OR IFNULL(runtime_home_dir, '') LIKE '%butler%'`
    )
    .all();

  const sessionIds = [...new Set(rows.map((row) => String(row.session_id)).filter(Boolean))];
  const controlSessionIds = sessionIds.length
    ? db
        .prepare(
          `SELECT id
           FROM butler_control_sessions
           WHERE session_id IN (${sessionIds.map(() => "?").join(", ")})`
        )
        .all(...sessionIds)
        .map((row) => String(row.id))
    : [];
  const butlerSessionIds = sessionIds.length
    ? db
        .prepare(
          `SELECT id
           FROM butler_sessions
           WHERE session_id IN (${sessionIds.map(() => "?").join(", ")})`
        )
        .all(...sessionIds)
        .map((row) => String(row.id))
    : [];

  const transaction = db.transaction(() => {
    if (controlSessionIds.length > 0) {
      const controlPlaceholders = controlSessionIds.map(() => "?").join(", ");
      db.prepare(`DELETE FROM butler_control_timers WHERE control_session_id IN (${controlPlaceholders})`).run(
        ...controlSessionIds
      );
      db.prepare(`DELETE FROM assistant_automation_tasks WHERE control_session_id IN (${controlPlaceholders})`).run(
        ...controlSessionIds
      );
      db.prepare(`DELETE FROM butler_control_events WHERE control_session_id IN (${controlPlaceholders})`).run(
        ...controlSessionIds
      );
    }

    if (butlerSessionIds.length > 0) {
      const butlerPlaceholders = butlerSessionIds.map(() => "?").join(", ");
      db.prepare(`DELETE FROM butler_follow_up_tasks WHERE butler_session_id IN (${butlerPlaceholders}) OR assistant_butler_session_id IN (${butlerPlaceholders})`).run(
        ...butlerSessionIds,
        ...butlerSessionIds
      );
      db.prepare(`UPDATE project_memories SET source_checkpoint_id = NULL WHERE source_checkpoint_id IN (SELECT id FROM session_checkpoints WHERE butler_session_id IN (${butlerPlaceholders}))`).run(
        ...butlerSessionIds
      );
      db.prepare(`UPDATE project_memories SET source_butler_session_id = NULL WHERE source_butler_session_id IN (${butlerPlaceholders})`).run(
        ...butlerSessionIds
      );
      db.prepare(`UPDATE patrol_runs SET butler_session_id = NULL WHERE butler_session_id IN (${butlerPlaceholders})`).run(
        ...butlerSessionIds
      );
      db.prepare(`UPDATE verification_runs SET butler_session_id = NULL WHERE butler_session_id IN (${butlerPlaceholders})`).run(
        ...butlerSessionIds
      );
      db.prepare(`DELETE FROM session_checkpoints WHERE butler_session_id IN (${butlerPlaceholders})`).run(
        ...butlerSessionIds
      );
    }

    if (sessionIds.length > 0) {
      const placeholders = sessionIds.map(() => "?").join(", ");
      db.prepare(`UPDATE channel_threads SET session_id = NULL WHERE session_id IN (${placeholders})`).run(
        ...sessionIds
      );
      db.prepare(`UPDATE channel_threads SET control_session_id = NULL WHERE session_id IN (${placeholders})`).run(
        ...sessionIds
      );
      db.prepare(`UPDATE channel_inbound_events SET session_id = NULL WHERE session_id IN (${placeholders})`).run(
        ...sessionIds
      );
      db.prepare(`UPDATE channel_inbound_events SET control_session_id = NULL WHERE session_id IN (${placeholders})`).run(
        ...sessionIds
      );
      db.prepare(`UPDATE channel_deliveries SET session_id = NULL WHERE session_id IN (${placeholders})`).run(
        ...sessionIds
      );
      db.prepare(`UPDATE channel_deliveries SET control_session_id = NULL WHERE session_id IN (${placeholders})`).run(
        ...sessionIds
      );

      db.prepare(`DELETE FROM session_message_attachments WHERE session_id IN (${placeholders})`).run(...sessionIds);
      db.prepare(`DELETE FROM session_message_origins WHERE session_id IN (${placeholders})`).run(...sessionIds);
      db.prepare(`DELETE FROM session_send_queue WHERE session_id IN (${placeholders})`).run(...sessionIds);
      db.prepare(`DELETE FROM session_file_context_bindings WHERE session_id IN (${placeholders})`).run(...sessionIds);
      db.prepare(`DELETE FROM session_changed_file_states WHERE session_id IN (${placeholders})`).run(...sessionIds);
      db.prepare(`DELETE FROM session_changed_files WHERE session_id IN (${placeholders})`).run(...sessionIds);
      db.prepare(`DELETE FROM session_status_snapshots WHERE session_id IN (${placeholders})`).run(...sessionIds);
      db.prepare(`DELETE FROM session_states WHERE session_id IN (${placeholders})`).run(...sessionIds);
      db.prepare(`DELETE FROM session_forks WHERE session_id IN (${placeholders})`).run(...sessionIds);
      db.prepare(`DELETE FROM butler_control_sessions WHERE session_id IN (${placeholders})`).run(...sessionIds);
      db.prepare(`DELETE FROM butler_sessions WHERE session_id IN (${placeholders})`).run(...sessionIds);
      db.prepare(`DELETE FROM session_indices WHERE session_id IN (${placeholders})`).run(...sessionIds);
      db.prepare(`DELETE FROM session_bindings WHERE session_id IN (${placeholders})`).run(...sessionIds);
    }

    db.prepare(
      `DELETE FROM session_source_index
       WHERE raw_store_ref LIKE '%butler-runtime%'
          OR raw_store_ref LIKE '%pending://codex/%'
          OR provider_session_id LIKE 'pending://codex/%'
          OR workspace_path LIKE '%butler-workspace%'`
    ).run();
  });

  transaction();
  db.close();

  for (const target of targets) {
    rmIfExists(target);
  }

  console.log(
    JSON.stringify(
      {
        databasePath,
        matchedSessionCount: sessionIds.length,
        matchedControlSessionCount: controlSessionIds.length,
        matchedButlerSessionCount: butlerSessionIds.length,
        removedPaths: targets
      },
      null,
      2
    )
  );
}

function assertExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`数据库不存在: ${filePath}`);
  }
}

function rmIfExists(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (error) {
    console.warn(`清理失败: ${targetPath}`, error instanceof Error ? error.message : String(error));
  }
}

main();
