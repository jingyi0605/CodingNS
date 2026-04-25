import { useEffect, useRef, type MutableRefObject } from "react";

const TRANSIENT_SCROLLBAR_HIDE_DELAY_MS = 5_000;

export function useTransientScrollbarVisibility<T extends HTMLElement>(
  externalRef?: MutableRefObject<T | null>
) {
  const internalRef = useRef<T | null>(null);
  const elementRef = externalRef ?? internalRef;

  useEffect(() => {
    const element = elementRef.current;

    if (!element || typeof globalThis.window === "undefined") {
      return;
    }

    let hideTimerId: number | null = null;

    const clearHideTimer = () => {
      if (hideTimerId !== null) {
        window.clearTimeout(hideTimerId);
        hideTimerId = null;
      }
    };

    const hideScrollbar = () => {
      clearHideTimer();
      element.removeAttribute("data-scrolling");
    };

    const showScrollbar = () => {
      element.setAttribute("data-scrolling", "true");
      clearHideTimer();
      hideTimerId = window.setTimeout(() => {
        element.removeAttribute("data-scrolling");
        hideTimerId = null;
      }, TRANSIENT_SCROLLBAR_HIDE_DELAY_MS);
    };

    const handleScroll = () => {
      showScrollbar();
    };

    element.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      element.removeEventListener("scroll", handleScroll);
      hideScrollbar();
    };
  }, [elementRef]);

  return elementRef;
}
