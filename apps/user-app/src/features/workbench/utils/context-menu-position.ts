const DEFAULT_CONTEXT_MENU_GAP_PX = 8;
const DEFAULT_CONTEXT_MENU_VIEWPORT_MARGIN_PX = 12;
const DEFAULT_CONTEXT_MENU_MIN_WIDTH_PX = 160;
const DEFAULT_CONTEXT_MENU_MIN_HEIGHT_PX = 96;

export interface ContextMenuAnchorPoint {
  readonly x: number;
  readonly y: number;
}

export interface ContextMenuPositionOptions {
  readonly gapPx?: number;
  readonly viewportMarginPx?: number;
  readonly defaultWidthPx?: number;
  readonly estimatedHeightPx?: number;
  readonly minHeightPx?: number;
}

export interface ContextMenuPosition {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly maxHeight: number;
  readonly transformOrigin: string;
}

export function resolveContextMenuPosition(
  anchorPoint: ContextMenuAnchorPoint,
  menuSize: { width: number; height: number },
  viewport: { width: number; height: number },
  options: ContextMenuPositionOptions = {}
): ContextMenuPosition {
  const gapPx = options.gapPx ?? DEFAULT_CONTEXT_MENU_GAP_PX;
  const viewportMarginPx = options.viewportMarginPx ?? DEFAULT_CONTEXT_MENU_VIEWPORT_MARGIN_PX;
  const defaultWidthPx = options.defaultWidthPx ?? DEFAULT_CONTEXT_MENU_MIN_WIDTH_PX;
  const estimatedHeightPx = options.estimatedHeightPx ?? DEFAULT_CONTEXT_MENU_MIN_HEIGHT_PX;
  const minHeightPx = options.minHeightPx ?? DEFAULT_CONTEXT_MENU_MIN_HEIGHT_PX;
  const viewportWidth = Math.max(0, viewport.width);
  const viewportHeight = Math.max(0, viewport.height);
  const viewportMaxHeight = Math.max(0, viewportHeight - viewportMarginPx * 2);
  const maxMenuWidth = Math.max(0, viewportWidth - viewportMarginPx * 2);
  const safeMenuWidth = clampNumber(
    Math.max(menuSize.width || defaultWidthPx, defaultWidthPx),
    0,
    maxMenuWidth
  );
  const measuredMenuHeight = Math.max(menuSize.height || estimatedHeightPx, estimatedHeightPx);
  const spaceRight = Math.max(0, viewportWidth - anchorPoint.x - viewportMarginPx);
  const spaceLeft = Math.max(0, anchorPoint.x - viewportMarginPx);
  const shouldOpenLeftward = spaceRight < safeMenuWidth && spaceLeft > spaceRight;
  const spaceBelow = Math.max(0, viewportHeight - anchorPoint.y - gapPx - viewportMarginPx);
  const spaceAbove = Math.max(0, anchorPoint.y - gapPx - viewportMarginPx);
  const shouldOpenUpward = spaceBelow < measuredMenuHeight && spaceAbove > spaceBelow;
  const availableHeight = shouldOpenUpward ? spaceAbove : spaceBelow;
  const safeMaxHeight = clampNumber(
    Math.max(availableHeight, minHeightPx),
    0,
    viewportMaxHeight
  );
  const visibleMenuHeight = Math.min(measuredMenuHeight, safeMaxHeight);
  const unclampedLeft = shouldOpenLeftward ? anchorPoint.x - safeMenuWidth : anchorPoint.x;
  const maxLeft = Math.max(
    viewportMarginPx,
    viewportWidth - viewportMarginPx - safeMenuWidth
  );
  const unclampedTop = shouldOpenUpward
    ? anchorPoint.y - gapPx - visibleMenuHeight
    : anchorPoint.y + gapPx;
  const maxTop = Math.max(
    viewportMarginPx,
    viewportHeight - viewportMarginPx - visibleMenuHeight
  );
  const left = clampNumber(unclampedLeft, viewportMarginPx, maxLeft);
  const top = clampNumber(unclampedTop, viewportMarginPx, maxTop);
  const horizontalOrigin = shouldOpenLeftward || left < anchorPoint.x ? "right" : "left";

  return {
    top,
    left,
    width: safeMenuWidth,
    maxHeight: Math.max(0, safeMaxHeight),
    transformOrigin: `${shouldOpenUpward ? "bottom" : "top"} ${horizontalOrigin}`
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}
