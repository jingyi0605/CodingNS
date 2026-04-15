import type {
  ButlerInboxItem,
  ButlerProject
} from "../../types/domain.js";

const OUTPUT_CONTRACT_VERSION = "butler-inbox-analysis-v2";

export interface ButlerInboxExecutionInstruction {
  analysisSummary: string;
  prompt: string;
  followUpObjective: string;
  completionCriteria: string;
}

export interface ButlerInboxAnalysisInstructionEnvelope {
  providerId: "codex" | "claude-code";
  outputContractVersion: string;
  prompt: string;
  metadata: {
    projectId: string;
    projectName: string;
    itemId: string;
    itemTitle: string;
  };
}

export function buildButlerInboxAnalysisInstruction(input: {
  providerId: "codex" | "claude-code";
  item: ButlerInboxItem;
  project: ButlerProject;
}): ButlerInboxAnalysisInstructionEnvelope {
  const prompt = [
    "你现在是代码助手里的代办分析器，不直接开发，只负责为单条代办生成真正有针对性的执行提示词。",
    "你必须在分析过程中实际调用 codingns assistant CLI 补查信息，不能只复述 BUTLER_CONTEXT.md，也不能只根据这条代办内容脑补答案。",
    "你的分析必须只围绕当前代办，不要把项目里无关的风险、旧问题、建议项硬塞进结果。",
    "如果信息不足，可以明确承认不足，但生成的执行提示词仍然必须告诉后续开发会话该先查什么、先看哪里。",
    "你输出的 generatedPrompt 将直接作为后续实际开发会话的首条提示词，所以它必须像开发负责人交接任务，而不是像泛泛而谈的总结。",
    "",
    "## 强制执行的查询步骤",
    "1. 先阅读 BUTLER_CONTEXT.md 和 BUTLER_API.md。",
    "2. 先确认 CLI 可用：至少执行一次 `codingns assistant capabilities list`。",
    `3. 必须读取当前项目详情：至少执行一次 \`codingns assistant projects get ${input.project.id}\`。`,
    `4. 必须检查项目会话：至少执行一次 \`codingns assistant sessions list --project ${input.project.id}\`。`,
    "5. 如果发现与当前代办直接相关的会话，继续按需读取 `sessions runtime` 和 `sessions messages`，只看最相关的 1 到 3 个会话。",
    "6. 如果项目下存在可用终端，按需读取 `terminals list` 和 `terminals history`，但不要发送任何终端输入。",
    "7. 必须根据你查到的真实信息判断：当前仓库是否已经有相关实现、相关会话是否已经做过一半、当前最合理的下一步是什么。",
    "",
    "## 严格禁止",
    "- 禁止发送 `sessions send`。",
    "- 禁止发送 `terminals send`。",
    "- 禁止 fork 会话。",
    "- 禁止直接修改任何项目代码。",
    "",
    "## 当前代办",
    `- 项目名称：${input.project.name}`,
    `- 项目 ID：${input.project.id}`,
    `- 仓库路径：${input.project.repoRoot}`,
    `- 代办 ID：${input.item.id}`,
    `- 标题：${input.item.title}`,
    `- 类型：${input.item.itemType}`,
    `- 当前状态：${input.item.status}`,
    `- 优先级：${input.item.priority}`,
    `- 描述：${input.item.content}`,
    "",
    "## 输出目标",
    "你要产出四个字段：",
    "- analysisSummary：给用户看的中文摘要，只总结和当前代办直接相关的发现，而且必须体现你查到的真实线索。",
    "- generatedPrompt：给后续开发会话的中文执行提示词，必须具体、可执行、围绕当前代办，不能夹带无关项目噪音。",
    "- followUpObjective：给后台跟进系统的目标描述，要聚焦这条代办本身。",
    "- completionCriteria：这条代办什么时候算完成，要写成明确结束条件。",
    "",
    "## generatedPrompt 的质量要求",
    "1. 必须写成 4 个小节，标题固定为：`问题判断`、`仓库现状`、`实际开发思路`、`验证与风险`。",
    "2. `问题判断` 必须先说清楚这条代办真正要解决的问题，不要泛泛而谈。",
    "3. `仓库现状` 必须引用你通过 CLI 查到的真实线索，例如项目详情、已有会话、终端历史、已经做到哪一步；不能编造文件名、分支名或进度。",
    "4. `实际开发思路` 必须明确后续开发会话第一步该检查哪些代码或现有会话线索；如果你查不到具体文件，就老实写“先定位相关代码路径”，不要假装知道。",
    "5. `实际开发思路` 必须强调最小必要改动，不能破坏现有行为，也不能顺手扩需求。",
    "6. `验证与风险` 必须要求跑必要验证；如果当前查不到验证入口或跑不了，就说明原因、缺口和残余风险。",
    "7. 禁止把与当前代办无关的历史问题、项目全局治理建议、顺手优化项塞进提示词。",
    "",
    "## 输出格式",
    "- 先用不超过 2 句中文给一个结论。",
    "- 最后必须给一个 JSON 代码块，字段完整。",
    "- cliEvidence 必须列出你实际使用过的 CLI 命令或关键读取动作，至少 3 条。",
    "- analysisSummary 和 generatedPrompt 都必须能被人一眼看出是针对这条代办，而不是通用模板。",
    "",
    "```json",
    JSON.stringify(
      {
        analysisSummary: "一句聚焦当前代办的中文摘要",
        generatedPrompt: [
          "问题判断",
          "这里说明这条代办真正要解决的问题。",
          "",
          "仓库现状",
          "这里写通过 CLI 查到的当前实现状态、已有会话线索或需要继续确认的部分。",
          "",
          "实际开发思路",
          "这里写后续开发会话应先查什么、再改什么、保持哪些行为不破坏。",
          "",
          "验证与风险",
          "这里写必须补的验证，以及当前还存在的风险。"
        ].join("\\n"),
        followUpObjective: "围绕当前代办推进的中文目标",
        completionCriteria: "当前代办的明确完成标准",
        cliEvidence: [
          "codingns assistant capabilities list",
          `codingns assistant projects get ${input.project.id}`,
          `codingns assistant sessions list --project ${input.project.id}`
        ]
      },
      null,
      2
    ),
    "```"
  ].join("\n");

  return {
    providerId: input.providerId,
    outputContractVersion: OUTPUT_CONTRACT_VERSION,
    prompt,
    metadata: {
      projectId: input.project.id,
      projectName: input.project.name,
      itemId: input.item.id,
      itemTitle: input.item.title
    }
  };
}
