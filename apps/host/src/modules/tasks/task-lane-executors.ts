import { getSharedTaskHelperProcessClient } from "./task-helper-client.js";
import type { TaskExecutionLane, TaskLaneExecutor } from "./task-types.js";

export function createHostTaskLaneExecutors(): Partial<Record<TaskExecutionLane, TaskLaneExecutor>> {
  const helperProcessClient = getSharedTaskHelperProcessClient();

  return {
    helper_process: {
      execute: async (definition, input, context) => {
        if (!definition.helperProcessHandler) {
          return await definition.run(input, context);
        }

        return await helperProcessClient.execute(
          definition.helperProcessHandler as never,
          attachHelperTaskMeta(input, context),
          context.signal
        );
      }
    },
    external_process: {
      execute: async (definition, input, context) =>
        await definition.run(input, context)
    }
  };
}

function attachHelperTaskMeta<TInput extends unknown>(
  input: TInput,
  context: { taskId: string; taskType: string; key: string; attempt: number }
): TInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  return {
    ...(input as Record<string, unknown>),
    __taskMeta: {
      taskId: context.taskId,
      taskType: context.taskType,
      key: context.key,
      attempt: context.attempt
    }
  } as TInput;
}
