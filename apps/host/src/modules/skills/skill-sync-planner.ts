import { AppError } from "../../shared/errors/app-error.js";
import type { SkillTargetBindingRecord, SkillTargetCli } from "../../types/domain.js";

export interface PlannedSkillSyncTarget {
  targetCli: SkillTargetCli;
  existingBinding: SkillTargetBindingRecord | null;
}

export class SkillSyncPlanner {
  planRequestedTargets(
    requestedTargetCli: readonly SkillTargetCli[],
    existingBindings: readonly SkillTargetBindingRecord[] = []
  ): PlannedSkillSyncTarget[] {
    const normalizedTargetCli = Array.from(new Set(requestedTargetCli));

    if (normalizedTargetCli.length === 0) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "至少要指定一个目标 CLI",
        field: "targetCli"
      });
    }

    const bindingByTarget = new Map(
      existingBindings.map((binding) => [binding.targetCli, binding] as const)
    );

    return normalizedTargetCli.map((targetCli) => ({
      targetCli,
      existingBinding: bindingByTarget.get(targetCli) ?? null
    }));
  }
}
