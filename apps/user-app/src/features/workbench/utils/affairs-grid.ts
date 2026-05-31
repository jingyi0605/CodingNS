export const AFFAIRS_GRID_TRACK_MIN_WIDTH = 134;
export const AFFAIRS_GRID_COLUMN_GAP = 10;
export const AFFAIRS_GRID_ITEM_HEIGHT = 104;
export const AFFAIRS_GRID_ROW_GAP = 12;
export const AFFAIRS_GRID_VIRTUAL_OVERSCAN_ROWS = 2;
export const AFFAIRS_GRID_VIRTUALIZATION_MIN_ITEMS = 80;

export function resolveAffairsGridColumnCount(contentWidth: number) {
  const safeWidth = Math.max(contentWidth, AFFAIRS_GRID_TRACK_MIN_WIDTH);
  return Math.max(
    1,
    Math.floor((safeWidth + AFFAIRS_GRID_COLUMN_GAP) / (AFFAIRS_GRID_TRACK_MIN_WIDTH + AFFAIRS_GRID_COLUMN_GAP))
  );
}

export function shouldVirtualizeAffairsGrid(
  itemCount: number,
  contentWidth: number,
  viewportHeight: number
) {
  return itemCount >= AFFAIRS_GRID_VIRTUALIZATION_MIN_ITEMS
    && contentWidth >= AFFAIRS_GRID_TRACK_MIN_WIDTH
    && viewportHeight >= AFFAIRS_GRID_ITEM_HEIGHT;
}

export function computeVirtualGridMetrics(
  itemCount: number,
  contentWidth: number,
  viewportHeight: number,
  scrollTop: number
) {
  const columns = resolveAffairsGridColumnCount(contentWidth);
  const rowStride = AFFAIRS_GRID_ITEM_HEIGHT + AFFAIRS_GRID_ROW_GAP;
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
      ? totalRows * AFFAIRS_GRID_ITEM_HEIGHT + Math.max(0, totalRows - 1) * AFFAIRS_GRID_ROW_GAP
      : 0
  };
}
