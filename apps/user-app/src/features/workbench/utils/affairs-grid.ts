export const AFFAIRS_GRID_TRACK_MIN_WIDTH = 134;
export const AFFAIRS_GRID_COLUMN_GAP = 10;
export const AFFAIRS_GRID_ITEM_HEIGHT = 104;
export const AFFAIRS_GRID_ROW_GAP = 12;
export const AFFAIRS_GRID_VIRTUAL_OVERSCAN_ROWS = 2;
export const AFFAIRS_GRID_VIRTUALIZATION_MIN_ITEMS = 80;

export function resolveAffairsGridColumnCount(
  contentWidth: number,
  options?: {
    trackMinWidth?: number;
    columnGap?: number;
  }
) {
  const trackMinWidth = Math.max(1, options?.trackMinWidth ?? AFFAIRS_GRID_TRACK_MIN_WIDTH);
  const columnGap = Math.max(0, options?.columnGap ?? AFFAIRS_GRID_COLUMN_GAP);
  const safeWidth = Math.max(contentWidth, trackMinWidth);
  return Math.max(
    1,
    Math.floor((safeWidth + columnGap) / (trackMinWidth + columnGap))
  );
}

export function shouldVirtualizeAffairsGrid(
  itemCount: number,
  contentWidth: number,
  viewportHeight: number,
  options?: {
    itemHeight?: number;
    trackMinWidth?: number;
  }
) {
  const itemHeight = Math.max(1, options?.itemHeight ?? AFFAIRS_GRID_ITEM_HEIGHT);
  const trackMinWidth = Math.max(1, options?.trackMinWidth ?? AFFAIRS_GRID_TRACK_MIN_WIDTH);
  return itemCount >= AFFAIRS_GRID_VIRTUALIZATION_MIN_ITEMS
    && contentWidth >= trackMinWidth
    && viewportHeight >= itemHeight;
}

export function computeVirtualGridMetrics(
  itemCount: number,
  contentWidth: number,
  viewportHeight: number,
  scrollTop: number,
  options?: {
    columns?: number;
    itemHeight?: number;
    rowGap?: number;
    trackMinWidth?: number;
    columnGap?: number;
  }
) {
  const columns = Math.max(
    1,
    options?.columns ?? resolveAffairsGridColumnCount(contentWidth, {
      trackMinWidth: options?.trackMinWidth,
      columnGap: options?.columnGap
    })
  );
  const itemHeight = Math.max(1, options?.itemHeight ?? AFFAIRS_GRID_ITEM_HEIGHT);
  const rowGap = Math.max(0, options?.rowGap ?? AFFAIRS_GRID_ROW_GAP);
  const rowStride = itemHeight + rowGap;
  const totalRows = Math.ceil(itemCount / columns);
  const visibleRows = Math.max(1, Math.ceil(Math.max(viewportHeight, rowStride) / rowStride));
  const startRow = Math.max(0, Math.floor(scrollTop / rowStride) - AFFAIRS_GRID_VIRTUAL_OVERSCAN_ROWS);
  const endRow = Math.min(
    totalRows,
    startRow + visibleRows + AFFAIRS_GRID_VIRTUAL_OVERSCAN_ROWS * 2
  );

  return {
    columns,
    startIndex: startRow * columns,
    endIndex: Math.min(itemCount, endRow * columns),
    offsetTop: startRow * rowStride,
    totalHeight: totalRows > 0
      ? totalRows * itemHeight + Math.max(0, totalRows - 1) * rowGap
      : 0
  };
}
