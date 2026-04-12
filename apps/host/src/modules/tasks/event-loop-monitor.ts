import { monitorEventLoopDelay } from "node:perf_hooks";

export interface EventLoopDelaySnapshot {
  readonly enabled: boolean;
  readonly resolutionMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly stddevMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
}

export class EventLoopMonitor {
  private histogram: ReturnType<typeof monitorEventLoopDelay> | null = null;

  constructor(private readonly resolutionMs = 20) {
    // 默认不启动采样，只有显式打开调试观测时才开始收集。
  }

  observe(): EventLoopDelaySnapshot {
    if (!this.histogram) {
      return {
        enabled: false,
        resolutionMs: this.resolutionMs,
        minMs: 0,
        maxMs: 0,
        meanMs: 0,
        stddevMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0
      };
    }

    return {
      enabled: true,
      resolutionMs: this.resolutionMs,
      minMs: toMilliseconds(this.histogram.min),
      maxMs: toMilliseconds(this.histogram.max),
      meanMs: toMilliseconds(this.histogram.mean),
      stddevMs: toMilliseconds(this.histogram.stddev),
      p50Ms: toMilliseconds(this.histogram.percentile(50)),
      p95Ms: toMilliseconds(this.histogram.percentile(95)),
      p99Ms: toMilliseconds(this.histogram.percentile(99))
    };
  }

  start(): void {
    if (this.histogram) {
      return;
    }

    this.histogram = monitorEventLoopDelay({
      resolution: this.resolutionMs
    });
    this.histogram.enable();
  }

  stop(): void {
    if (!this.histogram) {
      return;
    }

    this.histogram.disable();
    this.histogram = null;
  }

  reset(): void {
    this.histogram?.reset();
  }

  dispose(): void {
    this.stop();
  }
}

function toMilliseconds(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return value / 1_000_000;
}
