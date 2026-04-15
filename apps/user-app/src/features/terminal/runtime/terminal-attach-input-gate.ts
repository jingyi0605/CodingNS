export interface TerminalAttachInputGate {
  enqueue(content: string): void;
  suspend(): void;
  resume(delayMs?: number): void;
  dispose(): void;
}

/**
 * tmux 重新 attach 后会立刻探测终端能力。
 * 这里先把 xterm 自动回送的输入短暂缓冲，等 attach 端进入稳定状态后再一次性放行。
 */
export function createTerminalAttachInputGate(
  forward: (content: string) => void,
  scheduler: Pick<typeof window, "setTimeout" | "clearTimeout"> = window
): TerminalAttachInputGate {
  let ready = false;
  let pendingContent = "";
  let releaseTimer: number | null = null;

  const clearReleaseTimer = () => {
    if (releaseTimer === null) {
      return;
    }

    scheduler.clearTimeout(releaseTimer);
    releaseTimer = null;
  };

  const flushPending = () => {
    if (!ready || pendingContent.length === 0) {
      return;
    }

    const content = pendingContent;
    pendingContent = "";
    forward(content);
  };

  return {
    enqueue(content) {
      if (!content) {
        return;
      }

      if (ready && releaseTimer === null) {
        forward(content);
        return;
      }

      pendingContent += content;
    },
    suspend() {
      clearReleaseTimer();
      ready = false;
    },
    resume(delayMs = 0) {
      clearReleaseTimer();

      if (delayMs <= 0) {
        ready = true;
        flushPending();
        return;
      }

      ready = false;
      releaseTimer = scheduler.setTimeout(() => {
        releaseTimer = null;
        ready = true;
        flushPending();
      }, delayMs);
    },
    dispose() {
      clearReleaseTimer();
      ready = false;
      pendingContent = "";
    }
  };
}
