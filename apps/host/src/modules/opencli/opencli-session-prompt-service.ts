import type { OpenCliCatalogEntryRepository } from "../../storage/repositories/opencli-catalog-entry-repository.js";
import type { OpenCliProviderRepository } from "../../storage/repositories/opencli-provider-repository.js";

const OPENCLI_PROMPT_PROVIDER_IDS = new Set(["codex", "claude-code", "legna-code"]);
const MAX_PROMPT_COMMANDS = 40;

export class OpenCliSessionPromptService {
  constructor(
    private readonly providerRepository: Pick<OpenCliProviderRepository, "get">,
    private readonly catalogEntryRepository: Pick<OpenCliCatalogEntryRepository, "list">
  ) {}

  buildPrompt(input: {
    provider: string;
    runtimeEnv: Record<string, string>;
  }): string | null {
    if (!OPENCLI_PROMPT_PROVIDER_IDS.has(input.provider)) {
      return null;
    }

    const runtimeRootPath = input.runtimeEnv.CODINGNS_OPENCLI_RUNTIME_ROOT?.trim() ?? "";

    if (!runtimeRootPath) {
      return null;
    }

    const provider = this.providerRepository.get();

    if (!provider.enabled) {
      return null;
    }

    const enabledEntries = this.catalogEntryRepository
      .list()
      .filter((entry) => entry.enabled)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.commandId.localeCompare(right.commandId));

    if (enabledEntries.length === 0) {
      return [
        "## OpenCLI CLI技能",
        "- 当前会话已经注入 CodingNS 管理的 OpenCLI 运行时，但当前没有启用任何 CLI技能。",
        "- 不要调用 `opencli`，除非用户先在面板里启用具体命令。"
      ].join("\n");
    }

    const siteSummaries = buildSiteSummaries(enabledEntries);
    const visibleCommandIds = enabledEntries
      .slice(0, MAX_PROMPT_COMMANDS)
      .map((entry) => entry.commandId);
    const hiddenCommandCount = enabledEntries.length - visibleCommandIds.length;

    return [
      "## OpenCLI CLI技能",
      "- 当前会话已经注入 CodingNS 管理的裁剪版 OpenCLI 运行时，可以直接在 shell 里使用 `opencli`。",
      "- 只能把下面这些已启用命令当成当前会话可见能力；不在列表里的命令，视为当前会话不可用。",
      "- 如需先确认目录，优先执行 `opencli list -f json`，再调用具体命令。",
      "- 目录里存在命令，不等于当前环境一定可运行；标记为依赖浏览器的命令，在浏览器桥缺失时仍可能失败。",
      `- 已启用站点：${siteSummaries.join("；")}`,
      `- 已启用命令：${visibleCommandIds.join("、")}${hiddenCommandCount > 0 ? ` 等另外 ${hiddenCommandCount} 个` : ""}`
    ].join("\n");
  }
}

function buildSiteSummaries(
  entries: ReadonlyArray<{
    site: string;
    browser: boolean;
  }>
): string[] {
  const grouped = new Map<string, { total: number; browserDependent: number }>();

  for (const entry of entries) {
    const current = grouped.get(entry.site) ?? {
      total: 0,
      browserDependent: 0
    };

    current.total += 1;
    current.browserDependent += entry.browser ? 1 : 0;
    grouped.set(entry.site, current);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([site, summary]) =>
      summary.browserDependent > 0
        ? `${site}（${summary.total} 个，其中 ${summary.browserDependent} 个依赖浏览器）`
        : `${site}（${summary.total} 个，可直接运行）`
    );
}
