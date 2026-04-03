import type { ProviderId } from "@codingns/session-sync-core";

import type { ProjectMemory } from "../../types/domain.js";
import type { ButlerProject } from "../../types/domain.js";
import type { PatrolPlanView } from "./patrol-plan-service.js";
import type { PatrolRunView } from "./patrol-run-service.js";

const OUTPUT_CONTRACT_VERSION = "butler-patrol-v1";
const MAX_MEMORY_COUNT = 8;

export interface ButlerInstructionEnvelope {
  providerId: ProviderId;
  outputContractVersion: string;
  title: string;
  prompt: string;
  metadata: {
    projectId: string;
    projectName: string;
    runId: string;
    planId: string | null;
    executionMode: "readonly" | "controlled";
  };
}

export interface BuildPatrolInstructionInput {
  providerId: ProviderId;
  project: ButlerProject;
  run: PatrolRunView;
  plan: PatrolPlanView | null;
  memories: ProjectMemory[];
}

export class InstructionAdapter {
  buildPatrolInstruction(input: BuildPatrolInstructionInput): ButlerInstructionEnvelope {
    const executionMode = input.plan?.executionMode ?? mapProjectApprovalMode(input.project.approvalMode);
    const memorySection = renderMemorySection(input.memories);
    const scopeSection = renderJsonSection("巡视范围", input.plan?.patrolScope ?? {});
    const triggerSection = renderJsonSection("触发配置", input.plan?.triggerConfig ?? {});
    const constraintLines =
      executionMode === "readonly"
        ? [
            "本次巡视模式是 readonly。默认只做检查、阅读、分析、测试与总结，不要修改项目文件。",
            "如果你判断必须改代码才能证明问题，请先在总结中说明原因，不要直接动手。"
          ]
        : [
            "本次巡视模式是 controlled。允许做最小必要的验证动作，必要时可以做最小范围修复，但必须先判断破坏面。",
            "任何改动都必须保持向后兼容，优先修数据结构和边界条件，不要做表演式重构。"
          ];

    const prompt = [
      "你现在不是普通聊天助手，而是这个项目的代码管家巡视执行器。",
      "你的职责是：检查项目进展、识别风险、验证关键结论，并给出下一步最值得做的建议。",
      "请用中文输出。先给人能读懂的结论，再给结构化结果。",
      "",
      `项目名称：${input.project.name}`,
      `项目路径：${input.project.repoRoot}`,
      `项目 ID：${input.project.id}`,
      `巡视运行 ID：${input.run.id}`,
      `巡视计划 ID：${input.plan?.id ?? "manual"}`,
      `provider：${input.providerId}`,
      `执行模式：${executionMode}`,
      `项目当前风险等级：${input.project.riskLevel}`,
      "",
      "本次巡视目标：",
      "1. 判断项目当前推进到了哪里，哪些工作已经完成，哪些还卡住。",
      "2. 检查是否存在明显风险、失败测试、阻塞项、脏补丁或设计走偏。",
      "3. 给出最值得优先执行的下一步建议。",
      "4. 如有必要，运行轻量验证来支撑结论，但不要为了显得勤奋而乱跑重任务。",
      "",
      "执行约束：",
      ...constraintLines.map((line) => `- ${line}`),
      "- 优先使用最简单、最稳的办法得到结论。",
      "- 如果发现用户空间或现有行为可能被破坏，必须明确点名风险。",
      "- 不要凭空编造测试结果、完成状态或修复结果。",
      "",
      scopeSection,
      "",
      triggerSection,
      "",
      memorySection,
      "",
      "最终输出要求：",
      "1. 先输出一段中文巡视结论，包含当前进展、风险和建议。",
      "2. 最后必须再输出一个 JSON 代码块，且字段完整，格式如下：",
      "```json",
      JSON.stringify(
        {
          summary: "一句到三句的中文总结",
          riskLevel: "low",
          suggestions: ["下一步建议 1", "下一步建议 2"],
          progressState: "working",
          riskFlags: ["风险点 1"],
          nextActions: ["下一步动作 1"]
        },
        null,
        2
      ),
      "```",
      "3. riskLevel 只能是 low / medium / high。",
      "4. progressState 只能是 unknown / working / blocked / done。",
      "5. 如果信息不足，也必须给出保守结论，不要省略 JSON 代码块。"
    ].join("\n");

    return {
      providerId: input.providerId,
      outputContractVersion: OUTPUT_CONTRACT_VERSION,
      title: `代码管家巡视 - ${input.project.name}`,
      prompt,
      metadata: {
        projectId: input.project.id,
        projectName: input.project.name,
        runId: input.run.id,
        planId: input.plan?.id ?? null,
        executionMode
      }
    };
  }
}

function renderMemorySection(memories: ProjectMemory[]): string {
  if (memories.length === 0) {
    return "项目长期记忆：暂无已沉淀记忆。请基于当前仓库状态谨慎判断。";
  }

  const lines = memories.slice(0, MAX_MEMORY_COUNT).map((memory, index) => {
    return [
      `${index + 1}. [${memory.memoryType}/${memory.status}] ${memory.title}`,
      `   范围：${memory.scopePath ?? "项目级"}`,
      `   内容：${memory.content}`
    ].join("\n");
  });

  return ["项目长期记忆（按最近更新优先取样）：", ...lines].join("\n");
}

function renderJsonSection(title: string, value: Record<string, unknown>): string {
  return `${title}：\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function mapProjectApprovalMode(value: ButlerProject["approvalMode"]): "readonly" | "controlled" {
  return value === "readonly" ? "readonly" : "controlled";
}
