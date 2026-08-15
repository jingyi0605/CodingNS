import { getRecentModifiedFiles, type RecentModifiedFileRecordDto } from "./file-context-api";
import { fetchSkillOverview, type ManagedSkillOverviewItemDto } from "../../settings/api/skills-api";

export interface ComposerMentionSkillItemDto {
  id: string;
  name: string;
  source: "managed" | "assistant-runtime";
  targetCli: string[];
  description: string;
}

export interface ComposerMentionFileItemDto extends RecentModifiedFileRecordDto {}

export interface ComposerMentionSearchResultDto {
  skills: ComposerMentionSkillItemDto[];
  files: ComposerMentionFileItemDto[];
}

const DEFAULT_LIMIT = 5;

export async function searchComposerMentionItems(input: {
  workspaceId?: string | null;
  provider?: string | null;
  keyword?: string;
  limit?: number;
  targetHostId?: string | null;
}): Promise<ComposerMentionSearchResultDto> {
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.floor(input.limit!)) : DEFAULT_LIMIT;
  const keyword = input.keyword?.trim() ?? "";
  const targetCli = normalizeProviderToSkillTarget(input.provider);

  const [skillOverview, recentModified] = await Promise.all([
    fetchSkillOverview(),
    input.workspaceId?.trim()
      ? getRecentModifiedFiles(
        input.workspaceId.trim(),
        {
          limit,
          keyword
        },
        {
          targetHostId: input.targetHostId ?? undefined
        }
      )
      : Promise.resolve({ items: [] as ComposerMentionFileItemDto[] })
  ]);

  return {
      skills: filterSkills({
      keyword,
      limit,
      targetCli,
      managedSkills: skillOverview.managedSkills,
      assistantRuntimeSkills: skillOverview.assistantRuntimeSkills
    }),
    files: recentModified.items.slice(0, limit)
  };
}

function normalizeProviderToSkillTarget(provider: string | null | undefined): string | null {
  const normalized = provider?.trim();

  if (!normalized) {
    return null;
  }

  if (
    normalized === "claude-code"
    || normalized === "codex"
    || normalized === "gemini"
    || normalized === "opencode"
    || normalized === "deepseek-harness"
  ) {
    return normalized;
  }

  return null;
}

function filterSkills(input: {
  keyword: string;
  limit: number;
  targetCli: string | null;
  managedSkills: ManagedSkillOverviewItemDto[];
  assistantRuntimeSkills: Array<{
    name: string;
    directoryName: string;
    sourcePath: string;
    usedByTargetCli: string[];
  }>;
}): ComposerMentionSkillItemDto[] {
  const normalizedKeyword = input.keyword.toLowerCase();
  const matchesKeyword = (value: string) =>
    normalizedKeyword.length === 0 || value.toLowerCase().includes(normalizedKeyword);
  const items: ComposerMentionSkillItemDto[] = [];

  for (const skill of input.managedSkills) {
    const enabledTargetCli = skill.bindings
      .filter((binding) => binding.enabled)
      .map((binding) => binding.targetCli);

    if (input.targetCli && !enabledTargetCli.includes(input.targetCli as never)) {
      continue;
    }

    if (!matchesKeyword(skill.skill.name) && !matchesKeyword(skill.skill.directoryName)) {
      continue;
    }

    items.push({
      id: skill.skill.id,
      name: skill.skill.name,
      source: "managed",
      targetCli: enabledTargetCli,
      description: buildSkillDescription(enabledTargetCli)
    });
  }

  for (const skill of input.assistantRuntimeSkills) {
    if (input.targetCli && !skill.usedByTargetCli.includes(input.targetCli)) {
      continue;
    }

    if (!matchesKeyword(skill.name) && !matchesKeyword(skill.directoryName)) {
      continue;
    }

    items.push({
      id: `assistant-runtime:${skill.directoryName}`,
      name: skill.name,
      source: "assistant-runtime",
      targetCli: skill.usedByTargetCli,
      description: buildSkillDescription(skill.usedByTargetCli)
    });
  }

  items.sort((left, right) => left.name.localeCompare(right.name));
  return items.slice(0, input.limit);
}

function buildSkillDescription(targetCli: string[]): string {
  if (targetCli.length === 0) {
    return "当前还没有可用目标";
  }

  return `适用于 ${targetCli.join("、")}`;
}
