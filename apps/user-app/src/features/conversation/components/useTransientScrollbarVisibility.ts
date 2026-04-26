import { useEffect, useRef, type MutableRefObject } from "react";

const TRANSIENT_SCROLLBAR_HIDE_DELAY_MS = 5_000;
let cachedClassicScrollbarWidth: number | null = null;

function resolveClassicScrollbarWidth(): number {
  if (cachedClassicScrollbarWidth !== null) {
    return cachedClassicScrollbarWidth;
  }

  if (typeof document === "undefined") {
    cachedClassicScrollbarWidth = 0;
    return cachedClassicScrollbarWidth;
  }

  const probe = document.createElement("div");
  probe.dataset.scrollbarProbe = "true";
  probe.style.position = "absolute";
  probe.style.top = "-9999px";
  probe.style.width = "120px";
  probe.style.height = "120px";
  probe.style.overflow = "scroll";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";

  document.body?.appendChild(probe);

  cachedClassicScrollbarWidth = Math.max(0, probe.offsetWidth - probe.clientWidth);
  probe.remove();

  return cachedClassicScrollbarWidth;
}

function applyScrollbarLayoutMode(element: HTMLElement) {
  const classicScrollbarWidth = resolveClassicScrollbarWidth();

  if (classicScrollbarWidth > 0) {
    element.dataset.scrollbarLayout = "stable";
    return;
  }

  element.removeAttribute("data-scrollbar-layout");
}

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

    applyScrollbarLayoutMode(element);

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

export function __resetTransientScrollbarVisibilityCacheForTest() {
  cachedClassicScrollbarWidth = null;
}
