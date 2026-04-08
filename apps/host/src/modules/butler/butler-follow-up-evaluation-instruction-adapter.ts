import type { ButlerProject, SessionRunningState } from "../../types/domain.js";

const OUTPUT_CONTRACT_VERSION = "butler-follow-up-evaluation-v1";

export type ButlerFollowUpEvaluationDecision =
  | "continue"
  | "waiting_user"
  | "completed"
  | "failed";

export interface ButlerFollowUpEvaluationInstructionEnvelope {
  providerId: "codex" | "claude-code";
  outputContractVersion: string;
  prompt: string;
  metadata: {
    projectId: string;
    projectName: string;
    sessionId: string;
    butlerSessionId: string;
    transcriptLineCount: number;
  };
}

export interface BuildButlerFollowUpEvaluationInstructionInput {
  providerId: "codex" | "claude-code";
  project: ButlerProject;
  sessionId: string;
  butlerSessionId: string;
  sessionTitle: string | null;
  objective: string;
  completionCriteria: string;
  runningState: SessionRunningState | null;
  messageCount: number;
  lastMessageAt: string | null;
  autoContinueCount: number;
  maxAutoContinueCount: number;
  lastAutomationSummary: string | null;
  latestAssistantText: string | null;
  transcriptLines: string[];
}

export class ButlerFollowUpEvaluationInstructionAdapter {
  buildInstruction(
    input: BuildButlerFollowUpEvaluationInstructionInput
  ): ButlerFollowUpEvaluationInstructionEnvelope {
    const transcript =
      input.transcriptLines.length > 0
        ? input.transcriptLines.join("\n")
        : "- 最近没有可用消息，请保守判断，并明确说明缺口。";
    const prompt = [
      "你现在是代码助手的后台跟进评估器，不负责和用户闲聊，也不负责直接开发。",
      "你的唯一职责是判断：当前开发会话是否已经真正完成用户目标，是否必须等用户决定，还是应该继续自动推动。",
      "禁止用套话凑结论，禁止只看最后一句就草率下判断。要结合目标、当前运行态和最近消息整体判断。",
      "如果目标或上下文里提到了 spec，完成标准只能按 spec 明确要求的必做项判断。",
      "不要把“建议下一步”“最佳实践”“可选优化”“顺手补一下”这类建议项扩成新的开发范围。",
      "如果没有 spec，就先从目标和最近消息里归纳一句当前核心任务，后续只围绕这个核心任务判断是否完成。",
      "除非目标本身明确要求，否则重构、补测试、补体验优化、顺手整理代码都不是必须完成条件。",
      "如果信息不足，可以明确说信息不足；但只有在真的缺关键决策信息时，才返回 waiting_user。",
      "如果已经达到预设的自动推进轮数上限，你不能再通过新增目标来继续扩会话范围。",
      "",
      "判断标准：",
      "1. 只有目标已经实质完成，而且满足预设结束条件，才返回 completed；不能把建议项没做当成未完成。",
      "2. 只有确实需要用户做选择、补业务信息、确认高风险操作，或者已经达到自动推进轮数上限时，才返回 waiting_user。",
      "3. 只要目标还没完成、而且继续推进不会越权，就返回 continue，并给出下一条要发给开发会话的明确中文指令。",
      "4. 只有当前上下文已经无法可靠判断，或者会话明显坏掉到无法继续时，才返回 failed。",
      "",
      "输出要求：",
      "- 全部使用中文。",
      "- 先写一小段中文结论，控制在 2 句内。",
      "- 最后必须补一个 JSON 代码块，字段必须完整。",
      "- decision 只能是 continue / waiting_user / completed / failed。",
      "- continuePrompt 必须是要发给开发会话的下一条中文消息；decision 不是 continue 时填 null。",
      "- waitingReason 只在 decision=waiting_user 时填写，其它情况填 null。",
      "",
      `项目名称：${input.project.name}`,
      `项目路径：${input.project.repoRoot}`,
      `代码助手会话 ID：${input.butlerSessionId}`,
      `真实会话 ID：${input.sessionId}`,
      `会话标题：${input.sessionTitle ?? "未命名会话"}`,
      `用户目标：${input.objective}`,
      `预设结束条件：${input.completionCriteria}`,
      `当前运行态：${input.runningState ?? "未知"}`,
      `当前消息数：${input.messageCount}`,
      `最近消息时间：${input.lastMessageAt ?? "未知"}`,
      `历史自动推进次数：${input.autoContinueCount}`,
      `预设最多自动推进轮数：${input.maxAutoContinueCount}`,
      `剩余自动推进轮数：${Math.max(input.maxAutoContinueCount - input.autoContinueCount, 0)}`,
      `上一轮自动化摘要：${input.lastAutomationSummary?.trim() || "无"}`,
      `最近一条助手结论：${input.latestAssistantText?.trim() || "无"}`,
      "",
      "最近消息摘录：",
      transcript,
      "",
      "最终输出格式：",
      "```json",
      JSON.stringify(
        {
          decision: "continue",
          summary: "一句中文结论",
          waitingReason: null,
          continuePrompt: "继续未完成的开发工作，先核对当前目标还有哪些没做完，然后直接补齐，不要只做总结。",
          riskLevel: "medium"
        },
        null,
        2
      ),
      "```",
      "riskLevel 只能是 low / medium / high。"
    ].join("\n");

    return {
      providerId: input.providerId,
      outputContractVersion: OUTPUT_CONTRACT_VERSION,
      prompt,
      metadata: {
        projectId: input.project.id,
        projectName: input.project.name,
        sessionId: input.sessionId,
        butlerSessionId: input.butlerSessionId,
        transcriptLineCount: input.transcriptLines.length
      }
    };
  }
}
