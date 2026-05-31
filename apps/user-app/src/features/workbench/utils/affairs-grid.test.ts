import { describe, expect, it } from "vitest";

import {
  AFFAIRS_GRID_COLUMN_GAP,
  AFFAIRS_GRID_ITEM_HEIGHT,
  AFFAIRS_GRID_ROW_GAP,
  AFFAIRS_GRID_TRACK_MIN_WIDTH,
  AFFAIRS_GRID_VIRTUALIZATION_MIN_ITEMS,
  computeVirtualGridMetrics,
  resolveAffairsGridColumnCount,
  shouldVirtualizeAffairsGrid
} from "./affairs-grid";

describe("affairs-grid", () => {
  it("会按真实列宽和列间距计算图标列数", () => {
    const contentWidth = AFFAIRS_GRID_TRACK_MIN_WIDTH * 6 + AFFAIRS_GRID_COLUMN_GAP * 5;

    expect(resolveAffairsGridColumnCount(contentWidth)).toBe(6);
    expect(resolveAffairsGridColumnCount(contentWidth - 1)).toBe(5);
  });

  it("虚拟列表总高度不会凭空多出最后一行间距", () => {
    const metrics = computeVirtualGridMetrics(20, 900, 640, 0);
    const expectedColumns = resolveAffairsGridColumnCount(900);
    const expectedRows = Math.ceil(20 / expectedColumns);

    expect(metrics.columns).toBe(expectedColumns);
    expect(metrics.totalHeight).toBe(
      expectedRows * AFFAIRS_GRID_ITEM_HEIGHT + Math.max(0, expectedRows - 1) * AFFAIRS_GRID_ROW_GAP
    );
  });

  it("小数量图标卡片默认不走虚拟渲染", () => {
    expect(shouldVirtualizeAffairsGrid(
      AFFAIRS_GRID_VIRTUALIZATION_MIN_ITEMS - 1,
      960,
      720
    )).toBe(false);
    expect(shouldVirtualizeAffairsGrid(
      AFFAIRS_GRID_VIRTUALIZATION_MIN_ITEMS,
      960,
      720
    )).toBe(true);
  });
});
