import fs from "node:fs";
import path from "node:path";

import type { SessionBinding } from "../../types/domain.js";
import type { OpenCliCatalogEntryRepository } from "../../storage/repositories/opencli-catalog-entry-repository.js";
import type { OpenCliProviderRepository } from "../../storage/repositories/opencli-provider-repository.js";

const OPENCLI_BRIDGE_SKILL_DIRECTORY = "codingns-opencli";
const SUPPORTED_SKILL_PROVIDERS = new Set<SessionBinding["provider"]>([
  "codex",
  "claude-code",
  "legna-code"
]);
const MAX_VISIBLE_COMMANDS = 80;

export class OpenCliBridgeSkillService {
  constructor(
    private readonly providerRepository: Pick<OpenCliProviderRepository, "get">,
    private readonly catalogEntryRepository: Pick<OpenCliCatalogEntryRepository, "list">
  ) {}

  supportsProvider(provider: SessionBinding["provider"]): boolean {
    return SUPPORTED_SKILL_PROVIDERS.has(provider);
  }

  hasEnabledCommands(): boolean {
    const provider = this.providerRepository.get();

    if (!provider.enabled) {
      return false;
    }

    return this.catalogEntryRepository.list().some((entry) => entry.enabled);
  }

  syncRuntimeSkill(provider: SessionBinding["provider"], runtimeHomeDir: string): void {
    if (!this.supportsProvider(provider)) {
      return;
    }

    const targetSkillDir = path.join(runtimeHomeDir, "skills", OPENCLI_BRIDGE_SKILL_DIRECTORY);
    const entries = this.catalogEntryRepository
      .list()
      .filter((entry) => entry.enabled)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.commandId.localeCompare(right.commandId));

    fs.rmSync(targetSkillDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(targetSkillDir, "agents"), { recursive: true });

    fs.writeFileSync(path.join(targetSkillDir, "SKILL.md"), buildSkillMarkdown(entries), "utf8");
    fs.writeFileSync(path.join(targetSkillDir, "agents", "openai.yaml"), buildOpenAiAgentPrompt(), "utf8");
  }

  removeRuntimeSkill(provider: SessionBinding["provider"], runtimeHomeDir: string): void {
    if (!this.supportsProvider(provider)) {
      return;
    }

    fs.rmSync(
      path.join(runtimeHomeDir, "skills", OPENCLI_BRIDGE_SKILL_DIRECTORY),
      { recursive: true, force: true }
    );
  }
}

function buildSkillMarkdown(
  entries: ReadonlyArray<{
    commandId: string;
    site: string;
    browser: boolean;
    description: string;
  }>
): string {
  const siteSummaries = buildSiteSummaries(entries);
  const visibleCommands = entries.slice(0, MAX_VISIBLE_COMMANDS);
  const hiddenCommandCount = entries.length - visibleCommands.length;

  return `---
name: codingns-opencli
description: Use when the user needs website or platform data through the OpenCLI commands enabled in this CodingNS managed session. Always treat OpenCLI as a managed runtime: check the enabled catalog first, only call enabled commands, and remember browser-dependent commands may still fail in the current environment.
---

# CodingNS OpenCLI

## 概述

这不是用户全局安装目录里的裸 OpenCLI。

当前会话拿到的是 CodingNS 生成的裁剪版 OpenCLI runtime。只有当前启用的 CLI技能，才应该被当成可用入口。

## 固定边界

- 不要假设 OpenCLI 全目录都可用，只认当前 skill 里列出的启用站点和启用命令。
- 如果不确定当前 runtime 里到底有哪些命令，先执行 \`opencli list -f json\`。
- 如果某个命令标记为“依赖浏览器”，那只表示目录里存在，不表示当前环境一定能跑通。
- 如果 \`opencli list -f json\` 或具体命令报不存在、桥接缺失、浏览器错误，就直接按事实说明，不要编造结果。
- 当前 skill 只负责 OpenCLI 桥接，不负责替代普通 shell 推理。

## 默认工作流

1. 用户要抓站点、平台、榜单、趋势、帖子、公开页面数据时，优先判断是不是适合走 OpenCLI。
2. 不确定命令名或当前可用目录时，先跑 \`opencli list -f json\`。
3. 只从当前启用命令里挑一个最贴切的 \`site/name\` 去执行。
4. 如果命令依赖浏览器，先提醒它可能失败；如果用户仍要继续，再执行一次真实命令，不要伪造成功。
5. 失败时先回传真实错误，再决定是否换命令或回退别的方案。

## 当前启用站点

${siteSummaries.length > 0
    ? siteSummaries.map((summary) => `- ${summary}`).join("\n")
    : "- 当前没有启用任何站点"}

## 当前启用命令

${visibleCommands.length > 0
    ? visibleCommands.map((entry) => {
      const suffix = entry.browser ? "依赖浏览器" : "可直接运行";
      const description = entry.description.trim() || "未写说明";
      return `- \`${entry.commandId}\`：${description}；${suffix}`;
    }).join("\n")
    : "- 当前没有启用任何命令"}
${hiddenCommandCount > 0 ? `\n- 其余还有 ${hiddenCommandCount} 个启用命令，执行前可用 \`opencli list -f json\` 再确认。` : ""}
`;
}

function buildOpenAiAgentPrompt(): string {
  return [
    "language: zh-CN",
    "default_prompt: |",
    "  当用户要站点、平台、榜单、帖子、趋势或公开页面数据时，优先检查 $codingns-opencli。",
    "  先看 skill 里列出的启用命令；如果不确定当前 runtime 目录，再执行 `opencli list -f json`。",
    "  只能调用当前启用的 site/name，不要假设全局 opencli 目录都可用。"
  ].join("\n");
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
        ? `${site}：${summary.total} 个命令，其中 ${summary.browserDependent} 个依赖浏览器`
        : `${site}：${summary.total} 个命令，可直接运行`
    );
}
