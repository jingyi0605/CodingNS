import { describe, expect, it } from "vitest";

import { HostResourceService } from "../../../src/modules/system/host-resource-service.js";

describe("HostResourceService", () => {
  it("会返回 CPU、内存和磁盘快照", async () => {
    const cpuSamples = [
      { idle: 120, total: 300 },
      { idle: 150, total: 420 }
    ];
    let cpuSampleIndex = 0;
    const service = new HostResourceService("/tmp/demo", {
      sampleCpu: () => cpuSamples[Math.min(cpuSampleIndex++, cpuSamples.length - 1)]!,
      sleep: async () => undefined,
      statfs: async () => ({
        bsize: 1024,
        blocks: 1000,
        bfree: 220,
        bavail: 200
      }),
      totalMemory: () => 16 * 1024,
      freeMemory: () => 6 * 1024,
      nowIso: () => "2026-06-03T00:00:00.000Z"
    });

    const snapshot = await service.getSnapshot();

    expect(snapshot).toEqual({
      observedAt: "2026-06-03T00:00:00.000Z",
      cpu: {
        usedRatio: 0.75,
        logicalCoreCount: expect.any(Number)
      },
      memory: {
        usedBytes: 10 * 1024,
        totalBytes: 16 * 1024,
        freeBytes: 6 * 1024
      },
      disk: {
        usedBytes: 800 * 1024,
        totalBytes: 1000 * 1024,
        freeBytes: 200 * 1024
      }
    });
  });

  it("会复用上一次 CPU 快照，避免每次都等待采样窗口", async () => {
    const cpuSamples = [
      { idle: 100, total: 200 },
      { idle: 130, total: 260 },
      { idle: 150, total: 320 }
    ];
    let cpuSampleIndex = 0;
    let sleepCallCount = 0;
    const service = new HostResourceService("/tmp/demo", {
      sampleCpu: () => cpuSamples[Math.min(cpuSampleIndex++, cpuSamples.length - 1)]!,
      sleep: async () => {
        sleepCallCount += 1;
      },
      statfs: async () => ({
        bsize: 1,
        blocks: 10,
        bfree: 3,
        bavail: 3
      }),
      totalMemory: () => 10,
      freeMemory: () => 2,
      nowIso: () => "2026-06-03T00:00:00.000Z"
    });

    const firstSnapshot = await service.getSnapshot();
    const secondSnapshot = await service.getSnapshot();

    expect(sleepCallCount).toBe(1);
    expect(firstSnapshot.cpu.usedRatio).toBe(0.5);
    expect(secondSnapshot.cpu.usedRatio).toBeCloseTo(2 / 3, 6);
  });
});
