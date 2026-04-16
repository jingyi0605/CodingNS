export interface TerminalAttachInputGate {
  enqueue(content: string): void;
  suspend(): void;
  resume(delayMs?: number): void;
  dispose(): void;
}

const TMUX_ATTACH_PROBE_FILTER_TAIL_MS = 250;
const TERMINAL_ATTACH_PROBE_RESPONSE_PATTERN = /\u001b\[\?(?:\d+;)*\d+c|\u001b\[>(?:\d+;)*\d+c/g;

/**
 * tmux 重新 attach 后会立刻探测终端能力。
 * 这些响应如果在 attach 尚未稳定时落进 pane，就会直接污染 shell 输入。
 * 这里先缓冲，再在稳定窗口结束后剔除探测响应，只放行真实用户输入。
 */
export function createTerminalAttachInputGate(
  forward: (content: string) => void,
  scheduler: Pick<typeof window, "setTimeout" | "clearTimeout"> = window
): TerminalAttachInputGate {
  let ready = false;
  let pendingContent = "";
  let releaseTimer: number | null = null;
  let probeFilterTailTimer: number | null = null;
  let sanitizePendingContent = false;

  const clearReleaseTimer = () => {
    if (releaseTimer === null) {
      return;
    }

    scheduler.clearTimeout(releaseTimer);
    releaseTimer = null;
  };

  const clearProbeFilterTailTimer = () => {
    if (probeFilterTailTimer === null) {
      return;
    }

    scheduler.clearTimeout(probeFilterTailTimer);
    probeFilterTailTimer = null;
  };

  const flushPending = () => {
    if (!ready || releaseTimer !== null || probeFilterTailTimer !== null || pendingContent.length === 0) {
      return;
    }

    const content = sanitizePendingContent
      ? stripTerminalAttachProbeResponses(pendingContent)
      : pendingContent;
    pendingContent = "";
    sanitizePendingContent = false;

    if (!content) {
      return;
    }

    forward(content);
  };

  return {
    enqueue(content) {
      if (!content) {
        return;
      }

      if (ready && releaseTimer === null && probeFilterTailTimer === null) {
        forward(content);
        return;
      }

      pendingContent += content;
    },
    suspend() {
      clearReleaseTimer();
      clearProbeFilterTailTimer();
      ready = false;
    },
    resume(delayMs = 0) {
      clearReleaseTimer();
      clearProbeFilterTailTimer();

      if (delayMs <= 0) {
        ready = true;
        flushPending();
        return;
      }

      ready = false;
      sanitizePendingContent = true;
      releaseTimer = scheduler.setTimeout(() => {
        releaseTimer = null;
        ready = true;
        probeFilterTailTimer = scheduler.setTimeout(() => {
          probeFilterTailTimer = null;
          flushPending();
        }, TMUX_ATTACH_PROBE_FILTER_TAIL_MS);
      }, delayMs);
    },
    dispose() {
      clearReleaseTimer();
      clearProbeFilterTailTimer();
      ready = false;
      pendingContent = "";
      sanitizePendingContent = false;
    }
  };
}

function stripTerminalAttachProbeResponses(content: string): string {
  return content.replace(TERMINAL_ATTACH_PROBE_RESPONSE_PATTERN, "");
}
