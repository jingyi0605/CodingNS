const PARALLEL_DESKTOP_RESIZE_MAX_RATIO = 1.5;
const PARALLEL_DESKTOP_RESIZE_MIN_DELTA = 24;
const PARALLEL_DESKTOP_EDGE_MARGIN = 72;
const PARALLEL_DESKTOP_CHROME_WIDTH = 296;
const PARALLEL_DESKTOP_GAP_WIDTH = 16;
const PARALLEL_TARGET_PANE_WIDTH_BY_COUNT: Record<number, number> = {
  2: 496,
  3: 408,
  4: 344
};

export interface ParallelDesktopResizeInput {
  memberCount: number;
  currentWidth: number;
  monitorWidth: number;
}

export function resolveParallelTargetPaneWidth(memberCount: number) {
  return PARALLEL_TARGET_PANE_WIDTH_BY_COUNT[memberCount] ?? PARALLEL_TARGET_PANE_WIDTH_BY_COUNT[4];
}

export function resolveParallelDesktopResizeTarget({
  memberCount,
  currentWidth,
  monitorWidth
}: ParallelDesktopResizeInput) {
  if (memberCount < 2 || currentWidth <= 0 || monitorWidth <= 0) {
    return currentWidth;
  }

  const chromeWidth = PARALLEL_DESKTOP_CHROME_WIDTH;
  const gapWidth = Math.max(0, memberCount - 1) * PARALLEL_DESKTOP_GAP_WIDTH;
  const availablePaneWidth = Math.max(0, (currentWidth - chromeWidth - gapWidth) / memberCount);
  const targetPaneWidth = resolveParallelTargetPaneWidth(memberCount);

  // 当前每屏已经够用时，不再做无意义扩窗。
  if (availablePaneWidth >= targetPaneWidth - 16) {
    return currentWidth;
  }

  const desiredWidth = chromeWidth + gapWidth + memberCount * targetPaneWidth;
  const maxWidth = Math.min(
    currentWidth * PARALLEL_DESKTOP_RESIZE_MAX_RATIO,
    Math.max(currentWidth, monitorWidth - PARALLEL_DESKTOP_EDGE_MARGIN)
  );
  const targetWidth = Math.min(Math.max(currentWidth, desiredWidth), maxWidth);

  if (targetWidth <= currentWidth + PARALLEL_DESKTOP_RESIZE_MIN_DELTA) {
    return currentWidth;
  }

  return targetWidth;
}
