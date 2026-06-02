export function throwIfAborted(signal?: AbortSignal, fallbackMessage = "事务文档库任务已取消"): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error(fallbackMessage);
  }
}

export async function yieldToEventLoop(signal?: AbortSignal, fallbackMessage?: string): Promise<void> {
  throwIfAborted(signal, fallbackMessage);
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  throwIfAborted(signal, fallbackMessage);
}
