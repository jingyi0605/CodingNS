import type { TaskDefinition } from "./task-types.js";

export class TaskRegistry {
  private readonly definitions = new Map<string, TaskDefinition<unknown, unknown>>();

  register<TInput, TResult>(definition: TaskDefinition<TInput, TResult>): void {
    const existing = this.definitions.get(definition.taskType);

    if (existing && existing !== definition) {
      throw new Error(`任务类型已注册: ${definition.taskType}`);
    }

    this.definitions.set(definition.taskType, definition as TaskDefinition<unknown, unknown>);
  }

  has(taskType: string): boolean {
    return this.definitions.has(taskType);
  }

  get<TInput, TResult>(taskType: string): TaskDefinition<TInput, TResult> {
    const definition = this.definitions.get(taskType);

    if (!definition) {
      throw new Error(`未注册的任务类型: ${taskType}`);
    }

    return definition as TaskDefinition<TInput, TResult>;
  }
}
