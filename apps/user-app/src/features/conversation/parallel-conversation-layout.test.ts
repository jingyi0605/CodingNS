import { describe, expect, it } from "vitest";

import {
  resolveParallelMinimumPaneWidth,
  resolveParallelDesktopResizeTarget,
  resolveParallelTargetPaneWidth
} from "./parallel-conversation-layout";

describe("parallel-conversation-layout", () => {
  it("会为每个并行 pane 给出明确的最小宽度", () => {
    expect(resolveParallelMinimumPaneWidth(2)).toBe(496);
    expect(resolveParallelMinimumPaneWidth(3)).toBe(408);
    expect(resolveParallelMinimumPaneWidth(4)).toBe(344);
  });

  it("会根据成员数量收窄目标分屏宽度", () => {
    expect(resolveParallelTargetPaneWidth(2)).toBeGreaterThan(resolveParallelTargetPaneWidth(3));
    expect(resolveParallelTargetPaneWidth(3)).toBeGreaterThan(resolveParallelTargetPaneWidth(4));
  });

  it("当前每屏宽度已经足够时不会继续扩窗", () => {
    expect(
      resolveParallelDesktopResizeTarget({
        memberCount: 2,
        currentWidth: 1320,
        monitorWidth: 1720
      })
    ).toBe(1320);
  });

  it("扩窗时会遵守监视器宽度和 50% 上限", () => {
    expect(
      resolveParallelDesktopResizeTarget({
        memberCount: 4,
        currentWidth: 940,
        monitorWidth: 1280
      })
    ).toBe(1208);

    expect(
      resolveParallelDesktopResizeTarget({
        memberCount: 4,
        currentWidth: 900,
        monitorWidth: 1800
      })
    ).toBe(1350);
  });
});
