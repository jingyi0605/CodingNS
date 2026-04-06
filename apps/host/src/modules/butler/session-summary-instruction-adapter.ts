import type { ButlerProject } from "../../types/domain.js";

const OUTPUT_CONTRACT_VERSION = "butler-session-summary-v2";

export interface SessionSummaryInstructionEnvelope {
  providerId: "codex" | "claude-code";
  outputContractVersion: string;
  prompt: string;
  metadata: {
    projectId: string;
    projectName: string;
    butlerSessionId: string;
    sourceSessionId: string;
    transcriptLineCount: number;
  };
}

export interface BuildSessionSummaryInstructionInput {
  providerId: "codex" | "claude-code";
  project: ButlerProject;
  butlerSessionId: string;
  sessionId: string;
  sessionTitle: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  previousSummary: string | null;
  lastSummarizedSequence: number | null;
  transcriptLines: string[];
}

export class SessionSummaryInstructionAdapter {
  buildInstruction(input: BuildSessionSummaryInstructionInput): SessionSummaryInstructionEnvelope {
    const transcript =
      input.transcriptLines.length > 0
        ? input.transcriptLines.join("\n")
        : "- 最近没有可用消息，请只根据会话标题给出保守摘要。";
    const previousSummary = input.previousSummary?.trim() || "（无，视为第一次正式摘要）";
    const incrementScope =
      input.transcriptLines.length > 0
        ? input.lastSummarizedSequence === null
          ? "本轮提供的是历史上尚未进入正式 Butler 摘要的消息。"
          : `本轮只提供 sequence > ${input.lastSummarizedSequence} 的新增消息。`
        : "本轮没有拿到新增消息。";
    const prompt = [
      "你现在是代码助手的后台会话摘要器，不负责和用户聊天，只负责维护单个项目会话的最新检索摘要。",
      "你会收到上一版摘要和本轮新增消息。你的任务不是重写整个历史，而是在不编造信息的前提下，把新增变化合并进旧摘要，输出一版新的完整摘要。",
      "请严格只基于下面提供的会话元信息、上一版摘要和新增消息，不要编造仓库状态，不要补写没有出现过的任务。",
      "输出必须简短，避免把原始消息大段重复粘贴出来。",
      "",
      "摘要目标：",
      "1. 说明这个会话现在主要在做什么。",
      "2. 结合新增消息更新当前进展：继续推进、已经完成，还是被风险/错误卡住。",
      "3. 给出一到三条最值得继续跟进的动作。",
      "",
      "输出约束：",
      "- 全部使用中文。",
      "- summary 控制在 2 到 4 句内，优先写结果，不写寒暄。",
      "- summary 必须是合并后的最新摘要，不要写成“相比上次新增了什么”。",
      "- riskFlags 只保留真正影响推进的风险，不超过 4 条。",
      "- nextActions 只保留最值得做的下一步，不超过 3 条。",
      "- 如果信息不足，要明确说明信息不足，不要瞎猜。",
      "",
      `项目名称：${input.project.name}`,
      `项目路径：${input.project.repoRoot}`,
      `代码助手会话 ID：${input.butlerSessionId}`,
      `真实会话 ID：${input.sessionId}`,
      `会话标题：${input.sessionTitle ?? "未命名会话"}`,
      `最近消息时间：${input.lastMessageAt ?? "未知"}`,
      `当前已知消息数：${input.messageCount}`,
      "",
      "上一版摘要：",
      previousSummary,
      "",
      "增量范围说明：",
      incrementScope,
      "",
      "本轮新增消息摘录：",
      transcript,
      "",
      "最终输出要求：",
      "1. 先输出一段中文摘要。",
      "2. 最后必须补一个 JSON 代码块，字段完整，格式如下：",
      "```json",
      JSON.stringify(
        {
          summary: "两到四句中文总结",
          riskLevel: "low",
          suggestions: ["建议 1"],
          progressState: "working",
          riskFlags: ["风险 1"],
          nextActions: ["下一步动作 1"]
        },
        null,
        2
      ),
      "```",
      "3. riskLevel 只能是 low / medium / high。",
      "4. progressState 只能是 unknown / working / blocked / done。"
    ].join("\n");

    return {
      providerId: input.providerId,
      outputContractVersion: OUTPUT_CONTRACT_VERSION,
      prompt,
      metadata: {
        projectId: input.project.id,
        projectName: input.project.name,
        butlerSessionId: input.butlerSessionId,
        sourceSessionId: input.sessionId,
        transcriptLineCount: input.transcriptLines.length
      }
    };
  }
}
