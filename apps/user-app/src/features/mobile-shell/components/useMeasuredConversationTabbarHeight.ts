import { useEffect, useState, type RefObject } from "react";

export function useMeasuredConversationTabbarHeight(
  rootRef: RefObject<HTMLElement | null>,
  tabbarRef: RefObject<HTMLElement | null>,
  enabled: boolean
) {
  const [measuredHeight, setMeasuredHeight] = useState<string | undefined>(undefined);

  useEffect(() => {
    const rootElement = rootRef.current;
    const tabbarElement = tabbarRef.current;

    if (!enabled || !rootElement || !tabbarElement) {
      setMeasuredHeight(undefined);
      if (rootElement) {
        rootElement.style.removeProperty("--mobile-conversation-tabbar-height");
      }
      return;
    }

    const stableRootElement = rootElement;
    const stableTabbarElement = tabbarElement;

    function syncHeight() {
      if (!rootRef.current || !stableTabbarElement.isConnected) {
        return;
      }

      const nextHeight = `${Math.round(stableTabbarElement.getBoundingClientRect().height)}px`;
      stableRootElement.style.setProperty("--mobile-conversation-tabbar-height", nextHeight);
      setMeasuredHeight(nextHeight);
    }

    syncHeight();

    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncHeight) : null;

    resizeObserver?.observe(stableTabbarElement);
    window.addEventListener("resize", syncHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncHeight);
      stableRootElement.style.removeProperty("--mobile-conversation-tabbar-height");
    };
  }, [enabled, rootRef, tabbarRef]);

  return measuredHeight;
}
