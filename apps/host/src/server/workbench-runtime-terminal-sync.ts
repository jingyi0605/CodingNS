import type { AuthUserRepository } from "../storage/repositories/auth-user-repository.js";
import type { SessionHistoryService } from "../modules/sessions/session-history-service.js";
import type { SessionLiveRuntimeService } from "../modules/sessions/session-live-runtime-service.js";
import type { WorkbenchWsHub } from "../ws/workbench-ws-hub.js";

interface Disposable {
  close(): void;
}

export function registerWorkbenchRuntimeTerminalSync(input: {
  authUserRepository: Pick<AuthUserRepository, "listIds">;
  sessionHistoryService: Pick<SessionHistoryService, "refreshRuntimeFallbackSession">;
  workbenchWsHub: Pick<WorkbenchWsHub, "broadcastSnapshot">;
  runtimeServices: Array<Pick<SessionLiveRuntimeService, "registerTerminalStateListener">>;
}): Disposable {
  const subscriptions = input.runtimeServices.map((service) =>
    service.registerTerminalStateListener(async (event) => {
      const userIds = input.authUserRepository.listIds();

      await Promise.allSettled(
        userIds.map(async (userId) => {
          await input.sessionHistoryService.refreshRuntimeFallbackSession(event.sessionId, userId);
          await input.workbenchWsHub.broadcastSnapshot(userId);
        })
      );
    })
  );

  return {
    close() {
      while (subscriptions.length > 0) {
        subscriptions.pop()?.close();
      }
    }
  };
}
