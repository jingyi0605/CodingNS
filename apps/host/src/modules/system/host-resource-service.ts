import fs from "node:fs/promises";
import os from "node:os";

import { nowIso } from "../../shared/utils/time.js";

export interface HostResourceSnapshot {
  observedAt: string;
  cpu: {
    usedRatio: number;
    logicalCoreCount: number;
  };
  memory: {
    usedBytes: number;
    totalBytes: number;
    freeBytes: number;
  };
  disk: {
    usedBytes: number;
    totalBytes: number;
    freeBytes: number;
  };
}

interface CpuSample {
  idle: number;
  total: number;
}

interface StatFsLike {
  bsize: number;
  blocks: number;
  bfree: number;
  bavail: number;
}

interface HostResourceServiceOptions {
  readonly statfs?: (targetPath: string) => Promise<StatFsLike>;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly sampleCpu?: () => CpuSample;
  readonly totalMemory?: () => number;
  readonly freeMemory?: () => number;
  readonly nowIso?: () => string;
}

const DEFAULT_CPU_SAMPLE_DELAY_MS = 120;

export class HostResourceService {
  private previousCpuSample: CpuSample | null = null;

  constructor(
    private readonly diskProbePath: string,
    private readonly options: HostResourceServiceOptions = {}
  ) {}

  async getSnapshot(): Promise<HostResourceSnapshot> {
    const [cpu, stat] = await Promise.all([
      this.readCpuUsage(),
      this.readDiskUsage()
    ]);
    const totalMemory = Math.max(0, this.readTotalMemory());
    const freeMemory = clampBytes(this.readFreeMemory(), totalMemory);
    const usedMemory = clampBytes(totalMemory - freeMemory, totalMemory);

    return {
      observedAt: this.options.nowIso?.() ?? nowIso(),
      cpu,
      memory: {
        usedBytes: usedMemory,
        totalBytes: totalMemory,
        freeBytes: freeMemory
      },
      disk: stat
    };
  }

  private async readCpuUsage(): Promise<HostResourceSnapshot["cpu"]> {
    const currentSample = this.captureCpuSample();
    const previousSample = this.previousCpuSample;

    if (!previousSample || currentSample.total <= previousSample.total) {
      await this.sleep(DEFAULT_CPU_SAMPLE_DELAY_MS);
      const nextSample = this.captureCpuSample();
      this.previousCpuSample = nextSample;
      return buildCpuUsageSnapshot(currentSample, nextSample);
    }

    this.previousCpuSample = currentSample;
    return buildCpuUsageSnapshot(previousSample, currentSample);
  }

  private async readDiskUsage(): Promise<HostResourceSnapshot["disk"]> {
    const stat = await (this.options.statfs ?? fs.statfs)(this.diskProbePath);
    const blockSize = Math.max(1, Number(stat.bsize) || 4096);
    const totalBytes = Math.max(0, Number(stat.blocks) * blockSize);
    const freeBlocks = Number.isFinite(stat.bavail) ? Number(stat.bavail) : Number(stat.bfree);
    const freeBytes = clampBytes(freeBlocks * blockSize, totalBytes);
    const usedBytes = clampBytes(totalBytes - freeBytes, totalBytes);

    return {
      usedBytes,
      totalBytes,
      freeBytes
    };
  }

  private captureCpuSample(): CpuSample {
    return (this.options.sampleCpu ?? sampleCpuTotals)();
  }

  private readTotalMemory(): number {
    return (this.options.totalMemory ?? os.totalmem)();
  }

  private readFreeMemory(): number {
    return (this.options.freeMemory ?? os.freemem)();
  }

  private async sleep(delayMs: number): Promise<void> {
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }));
    await sleep(delayMs);
  }
}

function sampleCpuTotals(): CpuSample {
  let idle = 0;
  let total = 0;

  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }

  return { idle, total };
}

function buildCpuUsageSnapshot(
  previousSample: CpuSample,
  currentSample: CpuSample
): HostResourceSnapshot["cpu"] {
  const totalDelta = currentSample.total - previousSample.total;
  const idleDelta = currentSample.idle - previousSample.idle;
  const busyRatio = totalDelta > 0 ? 1 - idleDelta / totalDelta : 0;

  return {
    usedRatio: clampRatio(busyRatio),
    logicalCoreCount: Math.max(1, os.cpus().length)
  };
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
}

function clampBytes(value: number, maxValue: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.min(Math.round(value), Math.max(0, Math.round(maxValue)));
}
