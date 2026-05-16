import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { SkillTargetCli } from "../../types/domain.js";

export interface AssistantRuntimeSkillCatalogEntry {
  name: string;
  directoryName: string;
  sourcePath: string;
  usedByTargetCli: readonly SkillTargetCli[];
}

const builtinSkillRootDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "builtin-skills"
);

const ASSISTANT_RUNTIME_SKILL_SPECS: readonly Omit<AssistantRuntimeSkillCatalogEntry, "sourcePath">[] = [
  {
    name: "codingns-assistant",
    directoryName: "codingns-assistant",
    usedByTargetCli: ["codex", "claude-code"]
  },
  {
    name: "codingns-workspace-session",
    directoryName: "codingns-workspace-session",
    usedByTargetCli: ["codex", "claude-code"]
  }
];

export function listAssistantRuntimeSkills(): AssistantRuntimeSkillCatalogEntry[] {
  return ASSISTANT_RUNTIME_SKILL_SPECS
    .map((spec) => {
      const sourcePath = path.join(builtinSkillRootDir, spec.directoryName);

      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
        return null;
      }

      return {
        ...spec,
        sourcePath
      };
    })
    .filter((item): item is AssistantRuntimeSkillCatalogEntry => item !== null);
}
