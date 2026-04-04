import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import type Database from "better-sqlite3";

/**
 * Demo 模式清理服务。
 *
 * 职责单一：清空所有业务数据但保留 demo 用户账户和引导状态。
 * 清理后 demo 用户可以继续登录使用，获得一个全新的环境。
 */
export class DemoCleanupService {
  private readonly dataRootDir: string;

  constructor(
    private readonly db: Database.Database,
    databasePath: string
  ) {
    this.dataRootDir = path.dirname(databasePath);
  }

  /**
   * 清空所有业务数据。
   * 按 FK 依赖顺序从子表到父表删除，最后清理磁盘文件。
   * 保留 auth_users（demo 账户）和 bootstrap_state（已初始化标记）。
   */
  cleanupAllUserData(): void {
    this.cleanupDatabase();
    this.cleanupDiskFiles();
  }

  private cleanupDatabase(): void {
    const deleteAll = (table: string) => this.db.prepare(`DELETE FROM ${table}`).run();

    this.db.transaction(() => {
      // 会话叶子表（无下游依赖）
      deleteAll("session_file_context_bindings");
      deleteAll("session_send_queue");
      deleteAll("session_message_attachments");
      deleteAll("session_changed_file_states");
      deleteAll("session_changed_files");
      deleteAll("session_status_snapshots");
      deleteAll("session_states");

      // 会话核心表
      deleteAll("session_indices");
      deleteAll("session_bindings");

      // 终端叶子表（虽然 terminal_log 有 CASCADE，但手动删更清晰）
      deleteAll("terminal_log_segments");
      deleteAll("terminal_log_files");
      deleteAll("terminal_runtime_sessions");

      // 终端核心表
      deleteAll("terminal_instances");
      deleteAll("terminal_command_templates");

      // 用户数据表
      deleteAll("recent_files");
      deleteAll("user_preference_profiles");
      deleteAll("user_quick_phrase_preferences");

      // 工作区子表 + 根表
      deleteAll("commit_rule_profiles");
      deleteAll("workspaces");

      // 认证 token（保留用户账户）
      deleteAll("auth_tokens");
    })();
  }

  private cleanupDiskFiles(): void {
    const dirs = ["terminal-logs", "session-attachments"];
    for (const dir of dirs) {
      const fullPath = path.join(this.dataRootDir, dir);
      try {
        rmSync(fullPath, { recursive: true, force: true });
        mkdirSync(fullPath, { recursive: true });
      } catch {
        // 目录可能不存在，忽略
      }
    }
  }
}

/**
 * Demo 模式在线会话追踪器。
 *
 * 用内存 Map 记录每个用户当前有效的 access token 数量，
 * 用于判断"最后一个会话注销"的时机。
 * 进程重启时 Map 清空，所有计数归零，这是可接受的——
 * 重启后旧 token 失效（数据库中已无记录），用户需要重新登录。
 */
export class DemoOnlineTracker {
  /** userId -> Set<accessTokenHash> */
  private readonly onlineTokens = new Map<string, Set<string>>();

  /** 用户上线（登录成功后调用） */
  trackLogin(userId: string, accessTokenHash: string): void {
    let tokens = this.onlineTokens.get(userId);
    if (!tokens) {
      tokens = new Set();
      this.onlineTokens.set(userId, tokens);
    }
    tokens.add(accessTokenHash);
  }

  /**
   * 用户下线（登出时调用）。
   * @returns true 如果这是该用户的最后一个在线会话
   */
  trackLogout(userId: string, accessTokenHash: string): boolean {
    const tokens = this.onlineTokens.get(userId);
    if (!tokens) return true;

    tokens.delete(accessTokenHash);
    if (tokens.size === 0) {
      this.onlineTokens.delete(userId);
      return true;
    }
    return false;
  }

  /** 获取某个用户的在线会话数 */
  getOnlineCount(userId: string): number {
    return this.onlineTokens.get(userId)?.size ?? 0;
  }
}
