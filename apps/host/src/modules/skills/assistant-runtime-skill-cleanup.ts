import fs from "node:fs";
import path from "node:path";

import { resolveBuiltinSkillDirectory } from "./builtin-skill-service.js";
import { isReservedAssistantSkillDirectoryName } from "./skill-name-policy.js";
import { computeSkillDirectoryHash, isValidSkillDirectory } from "./skill-manager-service.js";
import type { SkillTargetAdapter } from "./skill-target-adapter.js";
import type { SkillTargetCli } from "../../types/domain.js";

const ASSISTANT_RUNTIME_SKILL_DIRECTORY = "codingns-assistant";

export interface AssistantRuntimeSkillCleanupResult {
  targetCli: SkillTargetCli;
  targetPath: string;
  status: "missing" | "removed_legacy_copy" | "kept_drifted_copy" | "invalid_entry";
  detail: string | null;
}

export function cleanupLegacyAssistantRuntimeSkillCopies(
  adapters: readonly SkillTargetAdapter[]
): AssistantRuntimeSkillCleanupResult[] {
  const builtinSkillPath = resolveBuiltinSkillDirectory(ASSISTANT_RUNTIME_SKILL_DIRECTORY);
  const builtinSkillHash = computeSkillDirectoryHash(builtinSkillPath);

  return adapters.map((adapter) => cleanupOneTarget(adapter, builtinSkillHash));
}

function cleanupOneTarget(
  adapter: SkillTargetAdapter,
  builtinSkillHash: string
): AssistantRuntimeSkillCleanupResult {
  const targetPath = path.join(adapter.resolveRootDir(), ASSISTANT_RUNTIME_SKILL_DIRECTORY);

  if (!isReservedAssistantSkillDirectoryName(ASSISTANT_RUNTIME_SKILL_DIRECTORY)) {
    return {
      targetCli: adapter.targetCli,
      targetPath,
      status: "invalid_entry",
      detail: "保留助手目录名配置异常"
    };
  }

  if (!fs.existsSync(targetPath)) {
    return {
      targetCli: adapter.targetCli,
      targetPath,
      status: "missing",
      detail: null
    };
  }

  if (!isValidSkillDirectory(targetPath)) {
    return {
      targetCli: adapter.targetCli,
      targetPath,
      status: "invalid_entry",
      detail: "目录存在，但不是合法 skill 目录"
    };
  }

  const currentHash = computeSkillDirectoryHash(targetPath);

  if (currentHash !== builtinSkillHash) {
    return {
      targetCli: adapter.targetCli,
      targetPath,
      status: "kept_drifted_copy",
      detail: "检测到用户改动过的保留目录，已保留原目录并继续诊断"
    };
  }

  fs.rmSync(targetPath, { recursive: true, force: true });

  return {
    targetCli: adapter.targetCli,
    targetPath,
    status: "removed_legacy_copy",
    detail: "检测到旧官方副本，启动时已自动清理"
  };
}
