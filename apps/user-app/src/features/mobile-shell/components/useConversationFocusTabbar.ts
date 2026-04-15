import { useEffect, useRef, useState, type RefObject } from "react";

const AUTO_HIDE_DELAY_MS = 3000;
const DRAG_START_THRESHOLD_PX = 10;
const REVEAL_DRAG_DISTANCE_PX = 84;
const REVEAL_THRESHOLD = 0.36;

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
  readonly surface: "composer" | "conversation";
  readonly startX: number;
  readonly startY: number;
  readonly pointerType: "touch" | "pointer";
  readonly initialState: "visible" | "hidden";
  readonly touchId?: number;
  readonly pointerId?: number;
  readonly captureTarget?: Element | null;
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
      hideTabbar();
    }, AUTO_HIDE_DELAY_MS);
  }

  function hideTabbar() {
    setState("hidden");
    setProgress(0);
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
      const gestureSurface = resolveConversationGestureSurface(event.target);

      if (!touchPoint || !gestureSurface) {
        dragGestureRef.current = null;
        return;
      }

      dragGestureRef.current = {
        surface: gestureSurface,
        startX: touchPoint.clientX,
        startY: touchPoint.clientY,
        pointerType: "touch",
        initialState: stateRef.current === "visible" ? "visible" : "hidden",
        touchId: touchPoint.identifier,
        dragging: false,
        latestProgress: progressRef.current
      };

      if (stateRef.current === "visible") {
        clearAutoHideTimer(autoHideTimerRef);
      }
    }

    function handleTouchMove(event: TouchEvent) {
      const gesture = dragGestureRef.current;

      if (!gesture || gesture.pointerType !== "touch") {
        return;
      }

      const touchPoint = resolveTrackedTouch(event.touches, gesture.touchId);

      if (!touchPoint) {
        return;
      }

      const horizontalDistance = touchPoint.clientX - gesture.startX;
      const verticalDistance = touchPoint.clientY - gesture.startY;

      if (gesture.surface === "conversation") {
        if (
          Math.abs(verticalDistance) <= DRAG_START_THRESHOLD_PX
          || Math.abs(verticalDistance) <= Math.abs(horizontalDistance)
        ) {
          return;
        }

        dragGestureRef.current = null;

        if (gesture.initialState === "visible") {
          hideTabbar();
        }

        return;
      }

      const dragDistance =
        gesture.initialState === "hidden" ? -verticalDistance : verticalDistance;

      if (dragDistance <= DRAG_START_THRESHOLD_PX && !gesture.dragging) {
        return;
      }

      preventDefaultIfCancelable(event);

      gesture.dragging = true;
      gesture.latestProgress = resolveDragProgress(gesture.initialState, dragDistance);
      setState("dragging");
      setProgress(gesture.latestProgress);
    }

    function handleTouchEnd(event: TouchEvent) {
      const gesture = dragGestureRef.current;

      if (!gesture || gesture.pointerType !== "touch") {
        return;
      }

      const touchPoint = resolveTrackedTouch(event.changedTouches, gesture.touchId);

      if (!touchPoint) {
        return;
      }

      dragGestureRef.current = null;

      if (!gesture.dragging) {
        if (gesture.initialState === "visible") {
          scheduleAutoHide();
        }
        return;
      }

      finalizeDragGesture(gesture.initialState, gesture.latestProgress, revealTabbar, setState, setProgress);
    }

    function handleTouchCancel(event: TouchEvent) {
      const gesture = dragGestureRef.current;

      if (!gesture || gesture.pointerType !== "touch") {
        return;
      }

      const touchPoint = resolveTrackedTouch(event.changedTouches, gesture.touchId);

      if (!touchPoint) {
        return;
      }

      dragGestureRef.current = null;

      if (!gesture.dragging) {
        if (gesture.initialState === "visible") {
          scheduleAutoHide();
        }
        return;
      }

      if (gesture.initialState === "visible") {
        revealTabbar();
        return;
      }

      setState("hidden");
      setProgress(0);
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.pointerType !== "touch") {
        return;
      }

      const gestureSurface = resolveConversationGestureSurface(event.target);

      if (!gestureSurface) {
        dragGestureRef.current = null;
        return;
      }

      dragGestureRef.current = {
        surface: gestureSurface,
        startX: event.clientX,
        startY: event.clientY,
        pointerType: "pointer",
        initialState: stateRef.current === "visible" ? "visible" : "hidden",
        pointerId: event.pointerId,
        captureTarget: event.target instanceof Element ? event.target : null,
        dragging: false,
        latestProgress: progressRef.current
      };

      if (event.target instanceof Element) {
        try {
          event.target.setPointerCapture(event.pointerId);
        } catch {
          // 某些浏览器或测试环境不支持 pointer capture，这里降级为普通事件流。
        }
      }

      if (stateRef.current === "visible") {
        clearAutoHideTimer(autoHideTimerRef);
      }
    }

    function handlePointerMove(event: PointerEvent) {
      const gesture = dragGestureRef.current;

      if (!gesture || gesture.pointerType !== "pointer") {
        return;
      }

      const horizontalDistance = event.clientX - gesture.startX;
      const verticalDistance = event.clientY - gesture.startY;

      if (gesture.surface === "conversation") {
        if (
          Math.abs(verticalDistance) <= DRAG_START_THRESHOLD_PX
          || Math.abs(verticalDistance) <= Math.abs(horizontalDistance)
        ) {
          return;
        }

        dragGestureRef.current = null;

        if (gesture.initialState === "visible") {
          hideTabbar();
        }

        return;
      }

      const dragDistance =
        gesture.initialState === "hidden" ? -verticalDistance : verticalDistance;

      if (dragDistance <= DRAG_START_THRESHOLD_PX && !gesture.dragging) {
        return;
      }

      preventDefaultIfCancelable(event);

      gesture.dragging = true;
      gesture.latestProgress = resolveDragProgress(gesture.initialState, dragDistance);
      setState("dragging");
      setProgress(gesture.latestProgress);
    }

    function handlePointerEnd(event: PointerEvent) {
      const gesture = dragGestureRef.current;

      if (
        !gesture ||
        gesture.pointerType !== "pointer" ||
        gesture.pointerId !== event.pointerId
      ) {
        return;
      }

      dragGestureRef.current = null;
      releasePointerCaptureSafely(gesture);

      if (!gesture.dragging) {
        if (gesture.initialState === "visible") {
          scheduleAutoHide();
        }
        return;
      }

      finalizeDragGesture(gesture.initialState, gesture.latestProgress, revealTabbar, setState, setProgress);
    }

    rootElement.addEventListener("touchstart", handleTouchStart, { passive: true });
    rootElement.addEventListener("pointerdown", handlePointerDown, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchCancel);
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      rootElement.removeEventListener("touchstart", handleTouchStart);
      rootElement.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchCancel);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
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

function resolveDragProgress(
  initialState: "visible" | "hidden",
  dragDistance: number
) {
  if (initialState === "hidden") {
    return clamp(dragDistance / REVEAL_DRAG_DISTANCE_PX, 0, 1);
  }

  return clamp(1 - dragDistance / REVEAL_DRAG_DISTANCE_PX, 0, 1);
}

function finalizeDragGesture(
  initialState: "visible" | "hidden",
  latestProgress: number,
  revealTabbar: () => void,
  setState: (state: ConversationFocusTabbarState) => void,
  setProgress: (progress: number) => void
) {
  if (initialState === "hidden") {
    if (latestProgress >= REVEAL_THRESHOLD) {
      revealTabbar();
      return;
    }

    setState("hidden");
    setProgress(0);
    return;
  }

  if (latestProgress <= 1 - REVEAL_THRESHOLD) {
    setState("hidden");
    setProgress(0);
    return;
  }

  revealTabbar();
}

function releasePointerCaptureSafely(gesture: DragGestureState) {
  if (
    gesture.pointerType !== "pointer" ||
    typeof gesture.pointerId !== "number" ||
    !(gesture.captureTarget instanceof Element)
  ) {
    return;
  }

  try {
    if (gesture.captureTarget.hasPointerCapture(gesture.pointerId)) {
      gesture.captureTarget.releasePointerCapture(gesture.pointerId);
    }
  } catch {
    // 测试环境和部分浏览器可能没有完整实现，忽略即可。
  }
}

function resolveTrackedTouch(touchList: TouchList, touchId?: number) {
  if (typeof touchId !== "number") {
    return touchList[0] ?? null;
  }

  for (let index = 0; index < touchList.length; index += 1) {
    const touch = touchList[index];

    if (touch?.identifier === touchId) {
      return touch;
    }
  }

  return null;
}

function resolveConversationGestureSurface(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return null;
  }

  if (target.closest(".composer-panel")) {
    return "composer";
  }

  if (
    target.closest(
      ".message-list, .message-timeline, .mobile-conversation-main, .conversation-page-shell, .mobile-butler-main-stage, .mobile-butler-chat-body, .mobile-butler-page-shell"
    )
  ) {
    return "conversation";
  }

  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function preventDefaultIfCancelable(event: Pick<Event, "cancelable" | "preventDefault">) {
  if (event.cancelable) {
    event.preventDefault();
  }
}
