import { useEffect, useRef, useState } from "react";

const MOBILE_WEB_KEYBOARD_THRESHOLD_PX = 120;

export interface H5ViewportState {
  readonly viewportHeight: number | null;
  readonly keyboardInset: number;
  readonly keyboardOpen: boolean;
}

const DEFAULT_H5_VIEWPORT_STATE: H5ViewportState = {
  viewportHeight: null,
  keyboardInset: 0,
  keyboardOpen: false
};

function isFinitePositiveNumber(value: number | undefined | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.isContentEditable || Boolean(element.closest("[contenteditable='true']"))) {
    return true;
  }

  if (element instanceof HTMLTextAreaElement) {
    return !element.readOnly && !element.disabled;
  }

  if (element instanceof HTMLInputElement) {
    if (element.readOnly || element.disabled) {
      return false;
    }

    const inputType = (element.type || "text").toLowerCase();

    return ![
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit"
    ].includes(inputType);
  }

  return false;
}

function resolveLayoutViewportHeight(): number {
  if (typeof window === "undefined") {
    return 0;
  }

  const candidates = [
    window.innerHeight,
    typeof document !== "undefined" ? document.documentElement?.clientHeight : 0
  ].filter(isFinitePositiveNumber);

  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

function readH5ViewportState(): H5ViewportState {
  if (typeof window === "undefined") {
    return DEFAULT_H5_VIEWPORT_STATE;
  }

  const visualViewport = window.visualViewport;
  const layoutViewportHeight = resolveLayoutViewportHeight();
  const viewportHeightCandidate = visualViewport?.height ?? layoutViewportHeight;
  const viewportHeight = isFinitePositiveNumber(viewportHeightCandidate)
    ? Math.round(viewportHeightCandidate)
    : null;
  const viewportOffsetTop = isFinitePositiveNumber(visualViewport?.offsetTop)
    ? visualViewport?.offsetTop ?? 0
    : 0;
  const keyboardInset =
    viewportHeight === null
      ? 0
      : Math.max(0, Math.round(layoutViewportHeight - viewportHeight - viewportOffsetTop));

  return {
    viewportHeight,
    keyboardInset,
    keyboardOpen:
      isEditableElement(typeof document !== "undefined" ? document.activeElement : null) &&
      keyboardInset >= MOBILE_WEB_KEYBOARD_THRESHOLD_PX
  };
}

function applyDocumentViewportState(enabled: boolean, state: H5ViewportState) {
  if (typeof document === "undefined") {
    return;
  }

  const targets = [document.documentElement, document.body].filter(
    (node): node is HTMLElement => node instanceof HTMLElement
  );

  targets.forEach((node) => {
    if (!enabled) {
      delete node.dataset.mobileKeyboardOpen;
      delete node.dataset.mobileViewportBound;
      node.style.removeProperty("--mobile-shell-viewport-height");
      node.style.removeProperty("--mobile-shell-keyboard-inset");
      return;
    }

    node.dataset.mobileKeyboardOpen = String(state.keyboardOpen);
    node.dataset.mobileViewportBound = "true";

    if (state.viewportHeight === null) {
      node.style.removeProperty("--mobile-shell-viewport-height");
    } else {
      node.style.setProperty("--mobile-shell-viewport-height", `${state.viewportHeight}px`);
    }

    node.style.setProperty("--mobile-shell-keyboard-inset", `${state.keyboardInset}px`);
  });
}

export function useH5ViewportState(enabled: boolean): H5ViewportState {
  const [state, setState] = useState<H5ViewportState>(() =>
    enabled ? readH5ViewportState() : DEFAULT_H5_VIEWPORT_STATE
  );
  const focusTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setState(DEFAULT_H5_VIEWPORT_STATE);
      applyDocumentViewportState(false, DEFAULT_H5_VIEWPORT_STATE);
      return;
    }

    function syncViewportState() {
      setState(readH5ViewportState());
    }

    function scheduleFocusSync() {
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current);
      }

      focusTimerRef.current = window.setTimeout(() => {
        focusTimerRef.current = null;
        syncViewportState();
      }, 0);
    }

    syncViewportState();

    const visualViewport = window.visualViewport;
    window.addEventListener("resize", syncViewportState);
    window.addEventListener("orientationchange", syncViewportState);
    visualViewport?.addEventListener("resize", syncViewportState);
    visualViewport?.addEventListener("scroll", syncViewportState);
    document.addEventListener("focusin", syncViewportState);
    document.addEventListener("focusout", scheduleFocusSync);

    return () => {
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }

      window.removeEventListener("resize", syncViewportState);
      window.removeEventListener("orientationchange", syncViewportState);
      visualViewport?.removeEventListener("resize", syncViewportState);
      visualViewport?.removeEventListener("scroll", syncViewportState);
      document.removeEventListener("focusin", syncViewportState);
      document.removeEventListener("focusout", scheduleFocusSync);
      applyDocumentViewportState(false, DEFAULT_H5_VIEWPORT_STATE);
    };
  }, [enabled]);

  useEffect(() => {
    applyDocumentViewportState(enabled, state);
  }, [enabled, state]);

  return state;
}
