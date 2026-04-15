import { TaskHelperProcessClient } from "./task-helper-client.js";
import type { TaskExecutionLane, TaskLaneExecutor } from "./task-types.js";

export function createHostTaskLaneExecutors(): Partial<Record<TaskExecutionLane, TaskLaneExecutor>> {
  const helperProcessClient = new TaskHelperProcessClient();

  return {
    helper_process: {
      execute: async (definition, input, context) => {
        if (!definition.helperProcessHandler) {
          return await definition.run(input, context);
        }

        return await helperProcessClient.execute(
          definition.helperProcessHandler as never,
          input,
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
