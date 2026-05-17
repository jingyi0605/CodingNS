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
const OPENCLI_BRIDGE_SKILL_DESCRIPTION =
  "Use when the user needs website or platform data through the OpenCLI commands enabled in this CodingNS managed session. Always treat OpenCLI as a managed runtime: check the enabled catalog first, only call enabled commands, and remember browser-dependent commands may still fail in the current environment.";

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
  const publicVisibleCommands = entries.filter((entry) => !entry.browser).slice(0, MAX_VISIBLE_COMMANDS);
  const hiddenPublicCommandCount = entries.filter((entry) => !entry.browser).length - publicVisibleCommands.length;
  const browserDependentCommands = entries.filter((entry) => entry.browser);
  const browserDependentPreview = browserDependentCommands.slice(0, 12);
  const hiddenBrowserCommandCount = browserDependentCommands.length - browserDependentPreview.length;

  return `---
name: codingns-opencli
description: ${JSON.stringify(OPENCLI_BRIDGE_SKILL_DESCRIPTION)}
---

# CodingNS OpenCLI

## 概述

这不是用户全局安装目录里的裸 OpenCLI。

当前会话拿到的是 CodingNS 生成的裁剪版 OpenCLI runtime。只有当前启用的 CLI技能，才应该被当成可用入口。

## 固定边界

- 不要假设 OpenCLI 全目录都可用，只认当前 skill 里列出的启用站点和启用命令。
- 如果不确定当前 runtime 里到底有哪些命令，先执行 \`opencli list -f json\`。
- 如果某个命令标记为“依赖浏览器”，那只表示目录里存在，不表示当前环境一定能跑通。
- browser-dependent 的 OpenCLI 命令不是通用浏览器自动化入口，不要把它当成 \`office.browser.*\` 的替代品。
- 只要任务涉及登录态、个人账户、订单、购物车、私有页面、验证码、企业后台、表单提交、下载文件、点击页面控件、复用人工已登录 Chrome/Edge，一律不要直接调用 browser-dependent 的 OpenCLI 站点命令。
- 上面这类真实站点操作，在工作区会话里必须优先走 \`office.browser.*\`；如果要真实浏览器调试，应显式传 \`executionBackend=opencli_bridge\`。
- 如果 \`opencli list -f json\` 或具体命令报不存在、桥接缺失、浏览器错误，就直接按事实说明，不要编造结果。
- 当前 skill 只负责 OpenCLI 桥接，不负责替代普通 shell 推理。

## 默认工作流

1. 用户要抓公开站点、公开页面、公开榜单、公开帖子、公开趋势数据时，优先判断是不是适合走 OpenCLI。
2. 不确定命令名或当前可用目录时，先跑 \`opencli list -f json\`。
3. 如果是登录、账户、后台、下单、订单、验证码、页面交互或真实浏览器操作，不要选 OpenCLI，直接回到 \`office.browser.*\`。
4. 只从当前启用命令里挑一个最贴切的 \`site/name\` 去执行。
5. 如果命令依赖浏览器，先提醒它可能失败；如果用户仍要继续，再执行一次真实命令，不要伪造成功。
6. 失败时先回传真实错误，再决定是否换命令或回退别的方案。

## 当前启用站点

${siteSummaries.length > 0
    ? siteSummaries.map((summary) => `- ${summary}`).join("\n")
    : "- 当前没有启用任何站点"}

## 当前默认可见命令

这里只列默认建议直接调用的公开数据命令。browser-dependent 命令即使存在，也不应该在真实站点任务里替代 \`office.browser.*\`。

${publicVisibleCommands.length > 0
    ? publicVisibleCommands.map((entry) => {
      const suffix = entry.browser ? "依赖浏览器" : "可直接运行";
      const description = entry.description.trim() || "未写说明";
      return `- \`${entry.commandId}\`：${description}；${suffix}`;
    }).join("\n")
    : "- 当前没有默认建议直接调用的公开命令"}
${hiddenPublicCommandCount > 0 ? `\n- 其余还有 ${hiddenPublicCommandCount} 个公开命令未展开，执行前可用 \`opencli list -f json\` 再确认。` : ""}

## browser-dependent 命令

下面这些命令只是说明 runtime 目录里存在对应桥接命令，不代表应该把它们当成正式浏览器任务入口。

${browserDependentPreview.length > 0
    ? browserDependentPreview.map((entry) => {
      const description = entry.description.trim() || "未写说明";
      return `- \`${entry.commandId}\`：${description}；只可用于受控的 OpenCLI 抓取，不可替代 \`office.browser.*\``;
    }).join("\n")
    : "- 当前没有 browser-dependent 命令"}
${hiddenBrowserCommandCount > 0 ? `\n- 其余还有 ${hiddenBrowserCommandCount} 个 browser-dependent 命令未展开；如确实需要查看目录，只能用 \`opencli list -f json\` 自查，不能默认把它们当成真实站点任务入口。` : ""}
`;
}

function buildOpenAiAgentPrompt(): string {
  return [
    "language: zh-CN",
    "default_prompt: |",
    "  当用户要公开站点、公开页面、公开榜单、公开帖子或公开趋势数据时，优先检查 $codingns-opencli。",
    "  先看 skill 里列出的启用命令；如果不确定当前 runtime 目录，再执行 `opencli list -f json`。",
    "  只能调用当前启用的 site/name，不要假设全局 opencli 目录都可用。",
    "  不要把 browser-dependent 的 OpenCLI 命令当成通用浏览器自动化入口。",
    "  只要任务涉及登录、验证码、个人账户、订单、私有页面、企业后台、表单提交、下载文件或复用人工已登录浏览器，一律回到 office.browser.*；如果要真实浏览器调试，显式传 executionBackend=opencli_bridge。"
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
