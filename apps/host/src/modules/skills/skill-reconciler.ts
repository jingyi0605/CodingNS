import type {
  ManagedSkillRecord,
  SkillScanDiagnostic,
  SkillScanEntry,
  SkillScanResult,
  SkillTargetBindingRecord,
  SkillTargetCli
} from "../../types/domain.js";
import type { SkillTargetLocation } from "./skill-target-adapter.js";

export interface DiscoveredSkillDirectory {
  targetCli: SkillTargetCli;
  rootDir: string;
  directoryPath: string;
  directoryName: string;
  name: string;
  contentHash: string;
}

export interface ReconcileSkillScanInput {
  targetLocations: readonly SkillTargetLocation[];
  directories: readonly DiscoveredSkillDirectory[];
  managedSkills: readonly ManagedSkillRecord[];
  bindings: readonly SkillTargetBindingRecord[];
  diagnostics?: readonly SkillScanDiagnostic[];
  scannedAt: string;
}

export class SkillReconciler {
  reconcile(input: ReconcileSkillScanInput): SkillScanResult {
    const managed: SkillScanEntry[] = [];
    const unmanaged: SkillScanEntry[] = [];
    const conflicted: SkillScanEntry[] = [];
    const diagnostics = [...(input.diagnostics ?? [])];
    const managedSkillById = new Map(input.managedSkills.map((record) => [record.id, record] as const));
    const managedSkillByDirectoryName = new Map(
      input.managedSkills.map((record) => [record.directoryName, record] as const)
    );
    const targetRootByCli = new Map(
      input.targetLocations.map((location) => [location.targetCli, location.rootDir] as const)
    );
    const actualDirectoryKeys = new Set<string>();

    for (const directory of input.directories) {
      const managedSkill = managedSkillByDirectoryName.get(directory.directoryName);
      const managementState = resolveManagementState(directory, managedSkill);
      const entry = createSkillScanEntry(directory, managedSkill, managementState);

      actualDirectoryKeys.add(createDirectoryKey(directory.targetCli, directory.directoryName));

      if (managementState === "managed") {
        managed.push(entry);
        continue;
      }

      if (managementState === "conflicted") {
        conflicted.push(entry);
        continue;
      }

      unmanaged.push(entry);
    }

    for (const binding of input.bindings) {
      if (!binding.enabled) {
        continue;
      }

      const managedSkill = managedSkillById.get(binding.skillId);

      if (!managedSkill) {
        continue;
      }

      const directoryKey = createDirectoryKey(binding.targetCli, managedSkill.directoryName);

      if (actualDirectoryKeys.has(directoryKey)) {
        continue;
      }

      diagnostics.push({
        targetCli: binding.targetCli,
        rootDir: targetRootByCli.get(binding.targetCli) ?? "",
        code: "SKILL_TARGET_SKILL_MISSING",
        detail: `目标 CLI 缺少受管 skill：${managedSkill.directoryName}`,
        directoryName: managedSkill.directoryName,
        directoryPath: null,
        managedSkillId: managedSkill.id
      });
    }

    return {
      managed: sortSkillScanEntries(managed),
      unmanaged: sortSkillScanEntries(unmanaged),
      conflicted: sortSkillScanEntries(conflicted),
      diagnostics: sortSkillScanDiagnostics(diagnostics),
      scannedAt: input.scannedAt
    };
  }
}

function resolveManagementState(
  directory: DiscoveredSkillDirectory,
  managedSkill: ManagedSkillRecord | undefined
): SkillScanEntry["managementState"] {
  if (!managedSkill) {
    return "unmanaged";
  }

  return managedSkill.contentHash === directory.contentHash ? "managed" : "conflicted";
}

function createSkillScanEntry(
  directory: DiscoveredSkillDirectory,
  managedSkill: ManagedSkillRecord | undefined,
  managementState: SkillScanEntry["managementState"]
): SkillScanEntry {
  return {
    targetCli: directory.targetCli,
    directoryPath: directory.directoryPath,
    directoryName: directory.directoryName,
    name: directory.name,
    contentHash: directory.contentHash,
    managementState,
    managedSkillId: managedSkill?.id ?? null
  };
}

function createDirectoryKey(targetCli: SkillTargetCli, directoryName: string): string {
  return `${targetCli}:${directoryName}`;
}

function sortSkillScanEntries(entries: SkillScanEntry[]): SkillScanEntry[] {
  return entries.sort((left, right) => {
    const targetOrder = left.targetCli.localeCompare(right.targetCli);

    if (targetOrder !== 0) {
      return targetOrder;
    }

    return left.directoryName.localeCompare(right.directoryName);
  });
}

function sortSkillScanDiagnostics(diagnostics: SkillScanDiagnostic[]): SkillScanDiagnostic[] {
  return diagnostics.sort((left, right) => {
    const targetOrder = left.targetCli.localeCompare(right.targetCli);

    if (targetOrder !== 0) {
      return targetOrder;
    }

    const codeOrder = left.code.localeCompare(right.code);

    if (codeOrder !== 0) {
      return codeOrder;
    }

    return (left.directoryName ?? "").localeCompare(right.directoryName ?? "");
  });
}
