import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ButlerInboxAnalysisService } from "../../src/modules/butler/butler-inbox-analysis-service.js";

describe("ButlerInboxAnalysisService", () => {
  it("会从最近多条助手消息里回退查找结构化 JSON", async () => {
    const service = createService({
      messages: [
        createAssistantMessage(
          "```json\n{\"analysisSummary\":\"验证码问题\",\"generatedPrompt\":\"问题判断\\n补齐登录失败三次后的图形验证码。\\n\\n仓库现状\\nCLI 已确认项目和会话。\\n\\n实际开发思路\\n先定位登录失败计数和验证码开关，再补最小改动。\\n\\n验证与风险\\n补三次失败场景验证。\",\"followUpObjective\":\"推进验证码收尾\",\"completionCriteria\":\"三次失败后展示图形验证码\",\"cliEvidence\":[\"codingns assistant capabilities list\",\"codingns assistant projects get demo\",\"codingns assistant sessions list --project demo\"]}\n```"
        ),
        createAssistantMessage("这是补充说明，没有 JSON。")
      ]
    });

    const result = await service.readTodoAnalysisResult("session-1", "codex", "user-1");

    expect(result).toEqual({
      analysisSummary: "验证码问题",
      prompt:
        "问题判断\n补齐登录失败三次后的图形验证码。\n\n仓库现状\nCLI 已确认项目和会话。\n\n实际开发思路\n先定位登录失败计数和验证码开关，再补最小改动。\n\n验证与风险\n补三次失败场景验证。",
      followUpObjective: "推进验证码收尾",
      completionCriteria: "三次失败后展示图形验证码"
    });
  });

  it("会解析包裹在普通说明文字里的 JSON 对象", async () => {
    const service = createService({
      messages: [
        createAssistantMessage(
          [
            "结论：需要继续推进验证码收尾。",
            "{",
            "\"analysisSummary\":\"验证码问题\",",
            "\"generatedPrompt\":\"问题判断\\n收尾登录失败三次后的验证码触发。\\n\\n仓库现状\\n已查过相关项目和会话，但还没确认代码路径。\\n\\n实际开发思路\\n先定位登录失败计数相关代码，再补验证码展示条件，保持最小改动。\\n\\n验证与风险\\n至少验证连续三次失败和成功登录后的回收逻辑。\",",
            "\"followUpObjective\":\"完成验证码触发收尾\",",
            "\"completionCriteria\":\"连续三次登录失败后出现图形验证码，且验证通过\",",
            "\"cliEvidence\":[\"codingns assistant capabilities list\",\"codingns assistant projects get demo\",\"codingns assistant sessions list --project demo\"]",
            "}"
          ].join("\n")
        )
      ]
    });

    const result = await service.readTodoAnalysisResult("session-2", "codex", "user-1");

    expect(result.analysisSummary).toBe("验证码问题");
    expect(result.prompt).toContain("问题判断");
    expect(result.followUpObjective).toBe("完成验证码触发收尾");
    expect(result.completionCriteria).toBe("连续三次登录失败后出现图形验证码，且验证通过");
  });

  it("分析结果没有 assistant 输出时，会把 raw 终态诊断拼进错误信息", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "butler-inbox-analysis-"));
    const rawStoreRef = join(tempDir, "analysis-empty.jsonl");

    writeFileSync(
      rawStoreRef,
      [
        JSON.stringify({
          timestamp: "2026-04-15T09:43:13.415Z",
          type: "session_meta",
          payload: {
            id: "provider-session-1"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-15T09:43:13.416Z",
          type: "event_msg",
          payload: {
            type: "task_started"
          }
        }),
        JSON.stringify({
          timestamp: "2026-04-15T09:44:05.643Z",
          type: "event_msg",
          payload: {
            type: "task_complete",
            last_agent_message: null
          }
        })
      ].join("\n"),
      "utf8"
    );

    const service = createService({
      messages: [],
      rawStoreRef
    });

    await expect(service.readTodoAnalysisResult("session-3", "codex", "user-1")).rejects.toThrow(
      /最近 assistant 输出为空；raw 终态：task_complete，last_agent_message=null；最近 raw 事件：record:session_meta -> event:task_started -> event:task_complete/
    );
  });
});

function createService(input: {
  messages: Array<{ role: string; kind: string; content: string }>;
  rawStoreRef?: string;
}): ButlerInboxAnalysisService {
  return new ButlerInboxAnalysisService(
    {
      ensureInitialized: vi.fn()
    } as never,
    {
      importWorkspace: vi.fn()
    } as never,
    {
      resolvePromptContext: vi.fn()
    } as never,
    {
      ensureWorkspaceCredential: vi.fn(),
      getCredentialFilePath: vi.fn()
    } as never,
    {
      getOverview: vi.fn(),
      importUnmanagedSkill: vi.fn()
    } as never,
    {
      readRecentHistoryEnvelope: vi.fn(async () => ({
        messages: input.messages
      })),
      getSession: vi.fn(() => ({
        rawStoreRef: input.rawStoreRef ?? null
      }))
    } as never,
    {
      getSessionRuntime: vi.fn(async () => ({
        runningState: "idle"
      }))
    } as never,
    {
      get: vi.fn()
    } as never,
    null,
    null,
    null,
    null
  );
}

function createAssistantMessage(content: string): { role: string; kind: string; content: string } {
  return {
    role: "assistant",
    kind: "text",
    content
  };
}
