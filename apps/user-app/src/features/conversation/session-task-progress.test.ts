import { describe, expect, it } from "vitest";

import {
  buildConversationTaskSnapshot,
  countConversationTasksByStatus
} from "./session-task-progress";

import type { ProviderId, ToolCallDto } from "./api/conversation-api";
import type { SessionMessageViewModel } from "./runtime/session-runtime-machine";

describe("buildConversationTaskSnapshot", () => {
  it("会解析 Codex 的 update_plan 全量任务", () => {
    const snapshot = buildConversationTaskSnapshot([
      createToolMessage({
        timestamp: "2026-04-13T10:00:00.000Z",
        toolCall: {
          callId: "plan-1",
          name: "update_plan",
          input: JSON.stringify({
            explanation: "先确认边界，再开始写代码",
            plan: [
              { step: "梳理现有状态", status: "completed" },
              { step: "补任务按钮", status: "in_progress" },
              { step: "补回归测试", status: "pending" }
            ]
          }),
          output: null,
          error: null,
          status: "completed"
        }
      })
    ], "codex");

    expect(snapshot?.source).toBe("plan");
    expect(snapshot?.explanation).toBe("先确认边界，再开始写代码");
    expect(snapshot?.items.map((item) => `${item.title}:${item.status}`)).toEqual([
      "梳理现有状态:completed",
      "补任务按钮:in_progress",
      "补回归测试:pending"
    ]);
  });

  it("会解析 Claude Code 的 ExitPlanMode 计划输出", () => {
    const snapshot = buildConversationTaskSnapshot([
      createToolMessage({
        timestamp: "2026-06-13T11:00:00.000Z",
        toolCall: {
          callId: "exit-plan-1",
          name: "ExitPlanMode",
          input: JSON.stringify({
            allowedPrompts: [
              {
                tool: "Bash",
                prompt: "run tests"
              }
            ]
          }),
          output: JSON.stringify({
            plan: [
              { step: "检查现有 Hook 设置", status: "completed" },
              { step: "补 Host 计划审批", status: "in_progress" },
              { step: "回归关键测试", status: "pending" }
            ],
            explanation: "先把计划审批主链路打通，再补前端展示。"
          }),
          error: null,
          status: "completed"
        }
      })
    ], "claude-code");

    expect(snapshot?.source).toBe("plan");
    expect(snapshot?.explanation).toBe("先把计划审批主链路打通，再补前端展示。");
    expect(snapshot?.allowedPrompts).toEqual([
      {
        tool: "Bash",
        prompt: "run tests"
      }
    ]);
    expect(snapshot?.items.map((item) => `${item.title}:${item.status}`)).toEqual([
      "检查现有 Hook 设置:completed",
      "补 Host 计划审批:in_progress",
      "回归关键测试:pending"
    ]);
  });

  it("会解析 Claude Code 的 TodoWrite 全量任务", () => {
    const snapshot = buildConversationTaskSnapshot([
      createToolMessage({
        timestamp: "2026-04-13T10:10:00.000Z",
        toolCall: {
          callId: "todo-1",
          name: "TodoWrite",
          input: JSON.stringify({
            todos: [
              { id: "a", content: "拆任务格式", status: "completed", priority: "high" },
              { id: "b", content: "做统一归一化", status: "in_progress" }
            ]
          }),
          output: null,
          error: null,
          status: "completed"
        }
      })
    ], "claude-code");

    expect(snapshot?.source).toBe("todo");
    expect(snapshot?.items).toHaveLength(2);
    expect(snapshot?.items[0]).toMatchObject({
      id: "a",
      title: "拆任务格式",
      status: "completed",
      detail: "high"
    });
    expect(snapshot?.items[1]).toMatchObject({
      id: "b",
      title: "做统一归一化",
      status: "in_progress"
    });
  });

  it("会按增量方式合并 Claude Code 的 TaskCreate 与 TaskUpdate", () => {
    const snapshot = buildConversationTaskSnapshot([
      createToolMessage({
        timestamp: "2026-04-13T10:20:00.000Z",
        toolCall: {
          callId: "task-create-1",
          name: "TaskCreate",
          input: JSON.stringify({
            title: "写 spec"
          }),
          output: JSON.stringify("1"),
          error: null,
          status: "completed"
        }
      }),
      createToolMessage({
        timestamp: "2026-04-13T10:21:00.000Z",
        toolCall: {
          callId: "task-create-2",
          name: "TaskCreate",
          input: JSON.stringify({
            title: "写实现"
          }),
          output: JSON.stringify("2"),
          error: null,
          status: "completed"
        }
      }),
      createToolMessage({
        timestamp: "2026-04-13T10:25:00.000Z",
        toolCall: {
          callId: "task-update-1",
          name: "TaskUpdate",
          input: JSON.stringify({
            status: "completed",
            taskId: "1"
          }),
          output: "Updated task #1 status",
          error: null,
          status: "completed"
        }
      }),
      createToolMessage({
        timestamp: "2026-04-13T10:26:00.000Z",
        toolCall: {
          callId: "task-update-2",
          name: "TaskUpdate",
          input: JSON.stringify({
            status: "in_progress",
            taskId: 2,
            activeForm: "正在补按钮交互"
          }),
          output: "Updated task #2 status",
          error: null,
          status: "completed"
        }
      })
    ], "claude-code");

    expect(snapshot?.items.map((item) => `${item.id}:${item.status}:${item.title}`)).toEqual([
      "1:completed:写 spec",
      "2:in_progress:写实现"
    ]);
    expect(snapshot?.items.find((item) => item.id === "2")?.detail).toBe("正在补按钮交互");
  });

  it("Claude Code 的 TaskUpdate 会按创建顺序更新任务列表，不会把 taskId 当成新任务", () => {
    const snapshot = buildConversationTaskSnapshot([
      createToolMessage({
        timestamp: "2026-04-13T10:20:00.000Z",
        toolCall: {
          callId: "task-create-list",
          name: "TaskCreate",
          input: JSON.stringify({
            tasks: [
              { title: "迁移索引状态指示器外观样式和弹窗数据模型", status: "pending" },
              { title: "迁移标签任务状态指示器组件和轮询逻辑", status: "pending" }
            ]
          }),
          output: null,
          error: null,
          status: "completed"
        }
      }),
      createToolMessage({
        timestamp: "2026-04-13T10:25:00.000Z",
        toolCall: {
          callId: "task-update-1",
          name: "TaskUpdate",
          input: JSON.stringify({
            status: "completed",
            taskId: "1"
          }),
          output: "Updated task #1 status",
          error: null,
          status: "completed"
        }
      }),
      createToolMessage({
        timestamp: "2026-04-13T10:26:00.000Z",
        toolCall: {
          callId: "task-update-2",
          name: "TaskUpdate",
          input: JSON.stringify({
            status: "in_progress",
            taskId: 2
          }),
          output: "Updated task #2 status",
          error: null,
          status: "completed"
        }
      })
    ], "claude-code");

    expect(snapshot?.items).toHaveLength(2);
    expect(snapshot?.items.map((item) => `${item.status}:${item.title}`)).toEqual([
      "completed:迁移索引状态指示器外观样式和弹窗数据模型",
      "in_progress:迁移标签任务状态指示器组件和轮询逻辑"
    ]);
  });

  it("会解析 Claude Code 的纯文本 TaskCreate 输出", () => {
    const snapshot = buildConversationTaskSnapshot([
      createToolMessage({
        timestamp: "2026-04-13T10:20:00.000Z",
        toolCall: {
          callId: "task-create-1",
          name: "TaskCreate",
          input: "",
          output: "Task #1 created successfully: 调研目标工具的文档结构",
          error: null,
          status: "completed"
        }
      }),
      createToolMessage({
        timestamp: "2026-04-13T10:21:00.000Z",
        toolCall: {
          callId: "task-create-2",
          name: "TaskCreate",
          input: "",
          output: "Task #2 created successfully: 初始化 Docusaurus 中文站点脚手架",
          error: null,
          status: "completed"
        }
      }),
      createToolMessage({
        timestamp: "2026-04-13T10:25:00.000Z",
        toolCall: {
          callId: "task-update-1",
          name: "TaskUpdate",
          input: JSON.stringify({
            status: "completed",
            taskId: "1"
          }),
          output: "Updated task #1 status",
          error: null,
          status: "completed"
        }
      })
    ], "claude-code");

    expect(snapshot?.items.map((item) => `${item.id}:${item.status}:${item.title}`)).toEqual([
      "1:completed:调研目标工具的文档结构",
      "2:pending:初始化 Docusaurus 中文站点脚手架"
    ]);
  });

  it("会解析 Claude Code 的纯文本 TaskList 输出", () => {
    const snapshot = buildConversationTaskSnapshot([
      createToolMessage({
        timestamp: "2026-04-13T10:30:00.000Z",
        toolCall: {
          callId: "task-list-1",
          name: "TaskList",
          input: "{}",
          output: [
            "#1 [completed] 调研目标工具的文档结构",
            "#2 [completed] 初始化 Docusaurus 中文站点脚手架",
            "#3 [in_progress] 翻译核心章节并校对术语",
            "#4 [pending] 配置中文搜索与部署流程"
          ].join("\n"),
          error: null,
          status: "completed"
        }
      })
    ], "claude-code");

    expect(snapshot?.items.map((item) => `${item.id}:${item.status}:${item.title}`)).toEqual([
      "1:completed:调研目标工具的文档结构",
      "2:completed:初始化 Docusaurus 中文站点脚手架",
      "3:in_progress:翻译核心章节并校对术语",
      "4:pending:配置中文搜索与部署流程"
    ]);
  });

  it("会优先采用 OpenCode 的 todoread 结果作为当前任务快照", () => {
    const snapshot = buildConversationTaskSnapshot([
      createToolMessage({
        timestamp: "2026-04-13T10:30:00.000Z",
        toolCall: {
          callId: "todo-write-1",
          name: "todowrite",
          input: JSON.stringify({
            todos: [
              { id: "1", content: "旧任务", status: "pending" }
            ]
          }),
          output: null,
          error: null,
          status: "completed"
        }
      }),
      createToolMessage({
        timestamp: "2026-04-13T10:35:00.000Z",
        toolCall: {
          callId: "todo-read-1",
          name: "todoread",
          input: "",
          output: JSON.stringify({
            tasks: [
              { id: "1", title: "旧任务", status: "completed" },
              { id: "2", title: "新任务", status: "in_progress" }
            ]
          }),
          error: null,
          status: "completed"
        }
      })
    ], "opencode");

    expect(snapshot?.items.map((item) => `${item.id}:${item.status}`)).toEqual([
      "1:completed",
      "2:in_progress"
    ]);
    expect(snapshot?.updatedAt).toBe("2026-04-13T10:35:00.000Z");
  });

  it("会统计各状态数量", () => {
    const counts = countConversationTasksByStatus([
      { id: "1", title: "A", status: "pending", detail: null, updatedAt: "2026-04-13T10:00:00.000Z" },
      { id: "2", title: "B", status: "in_progress", detail: null, updatedAt: "2026-04-13T10:00:00.000Z" },
      { id: "3", title: "C", status: "completed", detail: null, updatedAt: "2026-04-13T10:00:00.000Z" }
    ]);

    expect(counts).toEqual({
      pending: 1,
      in_progress: 1,
      completed: 1,
      failed: 0,
      cancelled: 0
    });
  });
});

function createToolMessage(input: {
  timestamp: string;
  toolCall: ToolCallDto;
  provider?: ProviderId;
}): SessionMessageViewModel {
  return {
    id: input.toolCall.callId,
    sessionId: "session-1",
    role: "tool",
    kind: "tool_call",
    content: input.toolCall.input,
    toolCall: input.toolCall,
    attachments: [],
    attachmentPayloads: null,
    origin: null,
    originRef: null,
    timestamp: input.timestamp,
    sequence: 1,
    rawRef: `raw://${input.toolCall.callId}`,
    deliveryState: "sent",
    clientRequestId: null
  };
}
