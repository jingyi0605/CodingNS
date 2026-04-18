import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { SkillTargetCli } from "../../types/domain.js";
import type {
  EnsureBuiltinSkillInput,
  ManagedSkillMutationResult,
  SkillManagerService
} from "./skill-manager-service.js";

const builtinSkillRootDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "builtin-skills"
);

const builtinSkillSpecs = [] as const;

export interface BuiltinSkillSyncSummary {
  directoryName: string;
  sourcePath: string;
  targetCli: readonly SkillTargetCli[];
  ok: boolean;
  result: ManagedSkillMutationResult | null;
  errorDetail: string | null;
}

export function resolveBuiltinSkillDirectory(directoryName: string): string {
  const resolvedPath = path.join(builtinSkillRootDir, directoryName);

  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
    throw new Error(`内置 Skill 目录不存在：${resolvedPath}`);
  }

  return resolvedPath;
}

export function syncBuiltinSkillsOnStartup(
  skillManagerService: Pick<SkillManagerService, "ensureBuiltinSkill">
): BuiltinSkillSyncSummary[] {
  return builtinSkillSpecs.map((spec) => syncOneBuiltinSkill(skillManagerService, spec));
}

function syncOneBuiltinSkill(
  skillManagerService: Pick<SkillManagerService, "ensureBuiltinSkill">,
  spec: { directoryName: string; targetCli: readonly SkillTargetCli[] }
): BuiltinSkillSyncSummary {
  const sourcePath = path.join(builtinSkillRootDir, spec.directoryName);

  try {
    resolveBuiltinSkillDirectory(spec.directoryName);
    const input: EnsureBuiltinSkillInput = {
      sourcePath,
      targetCli: spec.targetCli
    };

    return {
      directoryName: spec.directoryName,
      sourcePath,
      targetCli: spec.targetCli,
      ok: true,
      result: skillManagerService.ensureBuiltinSkill(input),
      errorDetail: null
    };
  } catch (error) {
    return {
      directoryName: spec.directoryName,
      sourcePath,
      targetCli: spec.targetCli,
      ok: false,
      result: null,
      errorDetail: error instanceof Error ? error.message : String(error)
    };
  }
}
