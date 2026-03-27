import { useEffect, useRef, useState, type RefObject } from "react";

const AUTO_HIDE_DELAY_MS = 3000;
const DRAG_START_THRESHOLD_PX = 10;
const REVEAL_DRAG_DISTANCE_PX = 84;
const REVEAL_THRESHOLD = 0.36;
const BOTTOM_THRESHOLD_PX = 12;

export type ConversationFocusTabbarState = "visible" | "hidden" | "dragging";

interface UseConversationFocusTabbarOptions {
  readonly enabled: boolean;
  readonly rootRef: RefObject<HTMLElement>;
  readonly suspended?: boolean;
  readonly resetKey?: string;
}

interface UseConversationFocusTabbarResult {
  readonly state: ConversationFocusTabbarState;
  readonly progress: number;
  readonly isOpen: boolean;
}

interface DragGestureState {
  readonly startY: number;
  readonly scrollElement: HTMLElement;
  readonly pointerType: "touch" | "pointer";
  dragging: boolean;
  latestProgress: number;
}

export function useConversationFocusTabbar({
  enabled,
  rootRef,
  suspended = false,
  resetKey
}: UseConversationFocusTabbarOptions): UseConversationFocusTabbarResult {
  const autoHideTimerRef = useRef<number | null>(null);
  const dragGestureRef = useRef<DragGestureState | null>(null);
  const stateRef = useRef<ConversationFocusTabbarState>("visible");
  const progressRef = useRef(1);
  const [state, setState] = useState<ConversationFocusTabbarState>("visible");
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  function scheduleAutoHide() {
    clearAutoHideTimer(autoHideTimerRef);
    autoHideTimerRef.current = window.setTimeout(() => {
      setState("hidden");
      setProgress(0);
    }, AUTO_HIDE_DELAY_MS);
  }

  function revealTabbar() {
    setState("visible");
    setProgress(1);
    scheduleAutoHide();
  }

  useEffect(() => {
    clearAutoHideTimer(autoHideTimerRef);

    if (!enabled) {
      clearAutoHideTimer(autoHideTimerRef);
      setState("visible");
      setProgress(1);
      return;
    }

    if (suspended) {
      setState("hidden");
      setProgress(0);
      return;
    }

    revealTabbar();

    return () => {
      clearAutoHideTimer(autoHideTimerRef);
    };
  }, [enabled, resetKey, suspended]);

  useEffect(() => {
    return () => {
      clearAutoHideTimer(autoHideTimerRef);
    };
  }, []);

  useEffect(() => {
    if (!enabled || suspended) {
      dragGestureRef.current = null;
      return;
    }

    const rootElement = rootRef.current;

    if (!rootElement) {
      return;
    }

    function handleTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1) {
        dragGestureRef.current = null;
        return;
      }

      const touchPoint = event.touches[0];
      const scrollElement = resolveMessageListFromEventTarget(event.target);

      if (!touchPoint || !scrollElement) {
        dragGestureRef.current = null;
        return;
      }

      dragGestureRef.current = {
        startY: touchPoint.clientY,
        scrollElement,
        pointerType: "touch",
        dragging: false,
        latestProgress: progressRef.current
      };
    }

    function handleTouchMove(event: TouchEvent) {
      const gesture = dragGestureRef.current;

      if (!gesture || gesture.pointerType !== "touch" || stateRef.current === "visible") {
        return;
      }

      const touchPoint = event.touches[0];

      if (!touchPoint || !isScrollContainerAtBottom(gesture.scrollElement)) {
        return;
      }

      const upwardDistance = gesture.startY - touchPoint.clientY;

      // 必须满足“已经到底，再继续向上拽”这个前提，才允许把底部导航拖出来。
      if (upwardDistance <= DRAG_START_THRESHOLD_PX && !gesture.dragging) {
        return;
      }

      event.preventDefault();

      if (upwardDistance <= 0) {
        gesture.dragging = true;
        gesture.latestProgress = 0;
        setState("dragging");
        setProgress(0);
        return;
      }

      gesture.dragging = true;
      gesture.latestProgress = clamp(upwardDistance / REVEAL_DRAG_DISTANCE_PX, 0, 1);
      setState("dragging");
      setProgress(gesture.latestProgress);
    }

    function handleTouchEnd() {
      const gesture = dragGestureRef.current;
      dragGestureRef.current = null;

      if (!gesture?.dragging) {
        return;
      }

      if (gesture.latestProgress >= REVEAL_THRESHOLD) {
        revealTabbar();
        return;
      }

      setState("hidden");
      setProgress(0);
    }

    function handleTouchCancel() {
      const gesture = dragGestureRef.current;
      dragGestureRef.current = null;

      if (!gesture?.dragging) {
        return;
      }

      setState("hidden");
      setProgress(0);
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.pointerType !== "touch") {
        return;
      }

      const scrollElement = resolveMessageListFromEventTarget(event.target);

      if (!scrollElement) {
        dragGestureRef.current = null;
        return;
      }

      dragGestureRef.current = {
        startY: event.clientY,
        scrollElement,
        pointerType: "pointer",
        dragging: false,
        latestProgress: progressRef.current
      };
    }

    function handlePointerMove(event: PointerEvent) {
      const gesture = dragGestureRef.current;

      if (!gesture || gesture.pointerType !== "pointer" || stateRef.current === "visible") {
        return;
      }

      if (!isScrollContainerAtBottom(gesture.scrollElement)) {
        return;
      }

      const upwardDistance = gesture.startY - event.clientY;

      if (upwardDistance <= DRAG_START_THRESHOLD_PX && !gesture.dragging) {
        return;
      }

      event.preventDefault();

      if (upwardDistance <= 0) {
        gesture.dragging = true;
        gesture.latestProgress = 0;
        setState("dragging");
        setProgress(0);
        return;
      }

      gesture.dragging = true;
      gesture.latestProgress = clamp(upwardDistance / REVEAL_DRAG_DISTANCE_PX, 0, 1);
      setState("dragging");
      setProgress(gesture.latestProgress);
    }

    function handlePointerEnd() {
      const gesture = dragGestureRef.current;
      dragGestureRef.current = null;

      if (!gesture?.dragging || gesture.pointerType !== "pointer") {
        return;
      }

      if (gesture.latestProgress >= REVEAL_THRESHOLD) {
        revealTabbar();
        return;
      }

      setState("hidden");
      setProgress(0);
    }

    rootElement.addEventListener("touchstart", handleTouchStart, { passive: true });
    rootElement.addEventListener("touchmove", handleTouchMove, { passive: false });
    rootElement.addEventListener("touchend", handleTouchEnd);
    rootElement.addEventListener("touchcancel", handleTouchCancel);
    rootElement.addEventListener("pointerdown", handlePointerDown, { passive: true });
    rootElement.addEventListener("pointermove", handlePointerMove, { passive: false });
    rootElement.addEventListener("pointerup", handlePointerEnd);
    rootElement.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      rootElement.removeEventListener("touchstart", handleTouchStart);
      rootElement.removeEventListener("touchmove", handleTouchMove);
      rootElement.removeEventListener("touchend", handleTouchEnd);
      rootElement.removeEventListener("touchcancel", handleTouchCancel);
      rootElement.removeEventListener("pointerdown", handlePointerDown);
      rootElement.removeEventListener("pointermove", handlePointerMove);
      rootElement.removeEventListener("pointerup", handlePointerEnd);
      rootElement.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [enabled, rootRef, suspended]);

  const effectiveProgress = enabled && !suspended ? progress : enabled ? 0 : 1;

  return {
    state: suspended && enabled ? "hidden" : state,
    progress: effectiveProgress,
    isOpen: effectiveProgress > 0.01
  };
}

function clearAutoHideTimer(timerRef: { current: number | null }) {
  if (timerRef.current === null) {
    return;
  }

  window.clearTimeout(timerRef.current);
  timerRef.current = null;
}

function isScrollContainerAtBottom(element: HTMLElement) {
  return element.scrollHeight - element.clientHeight - element.scrollTop <= BOTTOM_THRESHOLD_PX;
}

function resolveMessageListFromEventTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest<HTMLElement>(".message-list");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
