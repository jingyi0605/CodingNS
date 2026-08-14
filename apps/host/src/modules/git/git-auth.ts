import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";

export type GitAuthInput =
  | {
      mode?: "none";
    }
  | {
      mode: "basic";
      username?: string;
      password?: string;
    }
  | {
      mode: "token";
      username?: string;
      token?: string;
    };

export interface GitAuthContext {
  env: NodeJS.ProcessEnv;
  cleanup: () => void;
}

/**
 * 当上层已经显式提供了远端认证时，必须关掉本机 credential helper。
 * 否则 Git 可能优先命中 osxkeychain / gh / GCM 里缓存的旧账号，
 * 最终把错误凭据发给远端，看起来像是“PAT 不生效”。
 */
export function createGitCredentialHelperBypassEnv(
  overrides?: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    ...(overrides ?? {})
  };
}

/**
 * Git 在无终端环境里依然可能尝试弹交互提示。
 * 这里统一强制关掉终端交互，避免请求直接卡到超时。
 */
export function createGitNonInteractiveEnv(overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    ...(overrides ?? {})
  };
}

/**
 * 复用 askpass 方式给 Git 提供用户名 / 密码 / token。
 * 这样 clone、push、pull、fetch 走的是同一套认证数据结构，而不是各写一份分叉逻辑。
 */
export function createGitAuthContext(auth: GitAuthInput | null | undefined): GitAuthContext | null {
  if (!auth || !auth.mode || auth.mode === "none") {
    return null;
  }

  const mode = auth.mode;
  let username = "";
  let secret = "";

  if (mode === "basic") {
    username = auth.username?.trim() || "";
    secret = auth.password?.trim() || "";
  } else if (mode === "token") {
    username = auth.username?.trim() || "git";
    secret = auth.token?.trim() || "";
  } else {
    return null;
  }

  if (!username) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "Git 用户名不能为空",
      field: "username"
    });
  }

  if (!secret) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: mode === "basic" ? "Git 密码不能为空" : "Git token 不能为空",
      field: mode === "basic" ? "password" : "token"
    });
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codingns-git-auth-"));
  const helperRuntimePath = path.join(tempDir, "askpass.cjs");
  const helperScriptPath = path.join(tempDir, process.platform === "win32" ? "askpass.cmd" : "askpass.sh");

  fs.writeFileSync(
    helperRuntimePath,
    [
      'const prompt = (process.argv.slice(2).join(" ") || "").toLowerCase();',
      'const username = process.env.CODINGNS_GIT_AUTH_USERNAME || "";',
      'const secret = process.env.CODINGNS_GIT_AUTH_SECRET || "";',
      'if (prompt.includes("username")) {',
      "  process.stdout.write(username);",
      '} else if (prompt.includes("password") || prompt.includes("passphrase")) {',
      "  process.stdout.write(secret);",
      "} else {",
      "  process.stdout.write(secret || username);",
      "}"
    ].join("\n"),
    "utf8"
  );

  if (process.platform === "win32") {
    fs.writeFileSync(
      helperScriptPath,
      '@echo off\r\n"%CODINGNS_GIT_NODE%" "%~dp0askpass.cjs" %*\r\n',
      "utf8"
    );
  } else {
    fs.writeFileSync(
      helperScriptPath,
      '#!/bin/sh\n"$CODINGNS_GIT_NODE" "$(dirname "$0")/askpass.cjs" "$@"\n',
      "utf8"
    );
    fs.chmodSync(helperScriptPath, 0o755);
  }

  return {
    env: createGitNonInteractiveEnv({
      CODINGNS_GIT_NODE: process.execPath,
      CODINGNS_GIT_AUTH_USERNAME: username,
      CODINGNS_GIT_AUTH_SECRET: secret,
      GIT_ASKPASS: helperScriptPath
    }),
    cleanup: () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}
