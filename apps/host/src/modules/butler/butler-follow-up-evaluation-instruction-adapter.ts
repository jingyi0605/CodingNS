import type { ButlerProject, SessionRunningState } from "../../types/domain.js";

const OUTPUT_CONTRACT_VERSION = "butler-follow-up-cli-v1";

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
  taskId: string;
  providerId: "codex" | "claude-code";
  project: ButlerProject;
  sessionId: string;
  butlerSessionId: string;
  assistantSessionId: string;
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
      "你现在是在真实助手会话里执行的专用跟进助手，不负责和用户闲聊，也不负责直接开发当前仓库。",
      "你的唯一职责是判断：当前开发会话是否已经真正完成用户目标，是否必须等用户决定，还是应该继续自动推动。",
      "禁止用套话凑结论，禁止只看最后一句就草率下判断。要结合目标、当前运行态和最近消息整体判断。",
      "如果目标或上下文里提到了 spec，完成标准只能按 spec 明确要求的必做项判断。",
      "不要把“建议下一步”“最佳实践”“可选优化”“顺手补一下”这类建议项扩成新的开发范围。",
      "如果没有 spec，就先从目标和最近消息里归纳一句当前核心任务，后续只围绕这个核心任务判断是否完成。",
      "除非目标本身明确要求，否则重构、补测试、补体验优化、顺手整理代码都不是必须完成条件。",
      "如果信息不足，可以明确说信息不足；但只有在真的缺关键决策信息时，才返回 waiting_user。",
      "如果已经达到预设的自动推进轮数上限，你不能再通过新增目标来继续扩会话范围。",
      "你可以直接调用 codingns assistant CLI 检查项目和目标会话状态。",
      "这一轮的正式结论必须通过 `codingns assistant follow-ups.*` 命令回写到跟进任务，而不是输出 JSON 让 Host 猜。",
      "只要决定继续推进，就必须先用 `codingns assistant sessions send` 把中文跟进消息发到目标开发会话，再用 `codingns assistant follow-ups continue` 回写。",
      "如果决定等待用户，就使用 `codingns assistant follow-ups waiting-user`。",
      "如果决定已经完成，就使用 `codingns assistant follow-ups complete`。",
      "如果上下文损坏或确实无法可靠继续，就使用 `codingns assistant follow-ups fail`。",
      "",
      "判断标准：",
      "1. 只有目标已经实质完成，而且满足预设结束条件，才调用 complete；不能把建议项没做当成未完成。",
      "2. 只有确实需要用户做选择、补业务信息、确认高风险操作，或者已经达到自动推进轮数上限时，才调用 waiting-user。",
      "3. 只要目标还没完成、而且继续推进不会越权，就先发消息到目标开发会话，再调用 continue。",
      "4. 只有当前上下文已经无法可靠判断，或者会话明显坏掉到无法继续时，才调用 fail。",
      "",
      "执行要求：",
      "- 全部使用中文。",
      "- 先自己检查当前项目、目标会话、跟进任务，再决定动作。",
      "- 不要把命令建议写成自然语言结论后就停下，必须真的执行命令。",
      "- 如果走 continue，`--continue-prompt` 必须回填你刚刚已经发到目标开发会话的那条中文消息原文。",
      "- `--summary` 要写本轮结构化结论，后端会把它直接写入跟进任务。",
      "- 命令执行完成后，你可以再补 1 到 2 句中文说明，但这段说明不是结构化结果来源。",
      "",
      `跟进任务 ID：${input.taskId}`,
      `项目名称：${input.project.name}`,
      `项目路径：${input.project.repoRoot}`,
      `代码助手会话 ID：${input.butlerSessionId}`,
      `真实会话 ID：${input.sessionId}`,
      `当前跟进助手会话 ID：${input.assistantSessionId}`,
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
      "命令模板：",
      `- 继续推进：codingns assistant sessions send ${input.sessionId} --message \"<你刚发给目标会话的中文消息>\" && codingns assistant follow-ups continue ${input.taskId} --summary \"<本轮结论>\" --continue-prompt \"<同一条消息原文>\"`,
      `- 等待用户：codingns assistant follow-ups waiting-user ${input.taskId} --summary \"<本轮结论>\" --waiting-reason \"<必须等用户的原因>\"`,
      `- 已完成：codingns assistant follow-ups complete ${input.taskId} --summary \"<完成结论>\"`,
      `- 失败：codingns assistant follow-ups fail ${input.taskId} --summary \"<失败结论>\" --reason \"<失败原因>\"`,
      "",
      "最近消息摘录：",
      transcript
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
