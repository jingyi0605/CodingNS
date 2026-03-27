import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";

import { t } from "../../../shared/i18n";

const QUICK_NAV_STORAGE_KEY = "mobile.conversation.quick-nav.position";
const BUBBLE_SIZE_PX = 54;
const WHEEL_SIZE_PX = 320;
const ACTION_ORBIT_RADIUS_PX = 118;
const EDGE_MARGIN_PX = 12;
const BOTTOM_CLEARANCE_PX = 118;
const DRAG_THRESHOLD_PX = 6;
const LONG_PRESS_DURATION_MS = 3000;
const MENU_ANIMATION_MS = 220;

type QuickNavDockSide = "left" | "right";

interface StoredQuickNavPosition {
  readonly side?: QuickNavDockSide;
  readonly xRatio?: number;
  readonly yRatio: number;
}

interface FloatingQuickNavPosition {
  readonly side: QuickNavDockSide;
  readonly y: number;
}

interface RadialQuickNavAction extends ConversationFocusQuickNavAction {
  readonly angleDeg: number;
}

export interface ConversationFocusQuickNavAction {
  readonly key: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly onSelect: () => void;
}

export function ConversationFocusQuickNav({
  actions
}: {
  actions: readonly ConversationFocusQuickNavAction[];
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const repositionTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [position, setPosition] = useState<FloatingQuickNavPosition | null>(null);
  const [isRepositioning, setIsRepositioning] = useState(false);
  const [isPreparingReposition, setIsPreparingReposition] = useState(false);
  const [activeActionKey, setActiveActionKey] = useState<string | null>(null);
  const pointerStateRef = useRef<{
    readonly startX: number;
    readonly startY: number;
    longPressTriggered: boolean;
  } | null>(null);
  const ignoreClickRef = useRef(false);
  const dockSide = position?.side ?? "right";
  const bubbleBounds = getBubbleBounds(rootRef.current?.parentElement ?? null);

  const radialActions = useMemo<readonly RadialQuickNavAction[]>(
    () => actions.map((action, index) => ({
      ...action,
      angleDeg: resolveActionAngle(index, actions.length, dockSide)
    })),
    [actions, dockSide]
  );

  useEffect(() => {
    const nextPosition = resolveInitialPosition(rootRef.current?.parentElement ?? null);
    setPosition(nextPosition);
  }, []);

  useEffect(() => {
    if (open) {
      setMenuVisible(true);
      return undefined;
    }

    setActiveActionKey(null);

    if (!menuVisible) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setMenuVisible(false);
    }, MENU_ANIMATION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [menuVisible, open]);

  useEffect(() => {
    function handleWindowResize() {
      setPosition((current) =>
        clampPosition(rootRef.current?.parentElement ?? null, current ?? null)
      );
    }

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

  useEffect(() => {
    return () => {
      clearLongPressTimer(longPressTimerRef);
      clearLongPressTimer(repositionTimerRef);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const rootElement = rootRef.current;
      if (!rootElement || rootElement.contains(event.target as Node)) {
        return;
      }

      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (typeof event.button === "number" && event.button !== 0) {
      return;
    }

    pointerStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      longPressTriggered: false
    };

    event.currentTarget.setPointerCapture?.(event.pointerId);
    clearLongPressTimer(longPressTimerRef);
    longPressTimerRef.current = window.setTimeout(() => {
      const pointerState = pointerStateRef.current;
      if (!pointerState) {
        return;
      }

      pointerState.longPressTriggered = true;
      ignoreClickRef.current = true;
      setOpen(false);
      const shouldDelayReposition = open || menuVisible;

      if (shouldDelayReposition) {
        setIsPreparingReposition(true);
        clearLongPressTimer(repositionTimerRef);
        repositionTimerRef.current = window.setTimeout(() => {
          if (!pointerStateRef.current?.longPressTriggered) {
            return;
          }

          setIsPreparingReposition(false);
          setIsRepositioning(true);
        }, MENU_ANIMATION_MS);
        return;
      }

      setIsRepositioning(true);
    }, LONG_PRESS_DURATION_MS);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointerState = pointerStateRef.current;
    if (!pointerState) {
      return;
    }

    if (isRepositioning || pointerState.longPressTriggered) {
      if (!isRepositioning) {
        return;
      }

      setPosition(resolveDockedPositionFromPointer(rootRef.current?.parentElement ?? null, event.clientX, event.clientY));
      return;
    }

    if (
      Math.abs(event.clientX - pointerState.startX) > DRAG_THRESHOLD_PX
      || Math.abs(event.clientY - pointerState.startY) > DRAG_THRESHOLD_PX
    ) {
      clearLongPressTimer(longPressTimerRef);
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointerState = pointerStateRef.current;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    clearLongPressTimer(longPressTimerRef);
    clearLongPressTimer(repositionTimerRef);

    if (!pointerState) {
      return;
    }

    pointerStateRef.current = null;
    setIsPreparingReposition(false);

    if (isRepositioning) {
      const nextPosition = resolveDockedPositionFromPointer(
        rootRef.current?.parentElement ?? null,
        event.clientX,
        event.clientY
      );
      setPosition(nextPosition);
      setIsRepositioning(false);
      writeStoredPosition(rootRef.current?.parentElement ?? null, nextPosition);
    }
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    clearLongPressTimer(longPressTimerRef);
    clearLongPressTimer(repositionTimerRef);
    pointerStateRef.current = null;
    setIsPreparingReposition(false);
    setIsRepositioning(false);
  }

  function handleBubbleClick() {
    if (ignoreClickRef.current) {
      ignoreClickRef.current = false;
      return;
    }

    setOpen((current) => !current);
  }

  function handleBubbleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    setOpen((current) => !current);
  }

  function handleActionClick(action: ConversationFocusQuickNavAction) {
    setActiveActionKey(null);
    setOpen(false);
    action.onSelect();
  }

  return (
    <div
      ref={rootRef}
      className="mobile-floating-nav"
      data-open={open}
      data-menu-visible={menuVisible}
      data-side={dockSide}
      data-preparing-reposition={isPreparingReposition}
      data-repositioning={isRepositioning}
      style={position ? { left: `${resolveBubbleX(bubbleBounds, dockSide)}px`, top: `${position.y}px` } : undefined}
    >
      <button
        type="button"
        className="mobile-floating-nav-bubble"
        aria-label={t("shell.mobileQuickNavigationAction")}
        aria-expanded={open}
        aria-haspopup="menu"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClick={handleBubbleClick}
        onKeyDown={handleBubbleKeyDown}
      >
        {dockSide === "left" ? (
          <>
            <span className="mobile-floating-nav-grip" aria-hidden="true" />
            <span className="mobile-floating-nav-main-icon" aria-hidden="true">
              {open ? <CloseIcon /> : <QuickNavIcon side={dockSide} />}
            </span>
          </>
        ) : (
          <>
            <span className="mobile-floating-nav-main-icon" aria-hidden="true">
              {open ? <CloseIcon /> : <QuickNavIcon side={dockSide} />}
            </span>
            <span className="mobile-floating-nav-grip" aria-hidden="true" />
          </>
        )}
      </button>

      {menuVisible ? (
        <div className="mobile-radial-nav-panel" role="presentation">
          <div className="mobile-radial-nav-wheel" aria-label={t("shell.mobileQuickNavigationTitle")}>
            <div className="mobile-radial-nav-core" aria-hidden="true" />
            {radialActions.map((action, index) => {
              const style = buildActionStyle(action.angleDeg, index);

              return (
                <button
                  key={action.key}
                  type="button"
                  className="mobile-radial-nav-action"
                  data-active={activeActionKey === action.key}
                  aria-label={action.label}
                  style={style}
                  onPointerDown={() => setActiveActionKey(action.key)}
                  onPointerUp={() => setActiveActionKey(null)}
                  onPointerCancel={() => setActiveActionKey(null)}
                  onPointerLeave={() => setActiveActionKey((current) => (current === action.key ? null : current))}
                  onFocus={() => setActiveActionKey(action.key)}
                  onBlur={() => setActiveActionKey((current) => (current === action.key ? null : current))}
                  onClick={() => handleActionClick(action)}
                >
                  <span className="mobile-radial-nav-action-icon" aria-hidden="true">
                    {action.icon}
                  </span>
                  <span className="mobile-radial-nav-action-label">{action.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function resolveInitialPosition(shellElement: HTMLElement | null) {
  const bounds = getBubbleBounds(shellElement);
  const storedPosition = readStoredPosition();

  if (storedPosition) {
    return positionFromStored(bounds, storedPosition);
  }

  return {
    side: "right",
    y: bounds.maxY
  };
}

function clearLongPressTimer(timerRef: { current: number | null }) {
  if (timerRef.current === null) {
    return;
  }

  window.clearTimeout(timerRef.current);
  timerRef.current = null;
}

function clampPosition(
  shellElement: HTMLElement | null,
  position: FloatingQuickNavPosition | null
) {
  const bounds = getBubbleBounds(shellElement);

  if (!position) {
    return {
      side: "right",
      y: bounds.maxY
    };
  }

  return {
    side: position.side,
    y: clamp(position.y, bounds.minY, bounds.maxY)
  };
}

function getBubbleBounds(shellElement: HTMLElement | null) {
  const width =
    shellElement && shellElement.clientWidth > BUBBLE_SIZE_PX
      ? shellElement.clientWidth
      : window.innerWidth;
  const height =
    shellElement && shellElement.clientHeight > BUBBLE_SIZE_PX
      ? shellElement.clientHeight
      : window.innerHeight;
  const maxX = Math.max(0, width - BUBBLE_SIZE_PX);
  const maxY = Math.max(EDGE_MARGIN_PX, height - BUBBLE_SIZE_PX - BOTTOM_CLEARANCE_PX);

  return {
    minX: 0,
    maxX,
    minY: EDGE_MARGIN_PX,
    maxY
  };
}

function resolveBubbleX(
  bounds: ReturnType<typeof getBubbleBounds>,
  side: QuickNavDockSide
) {
  return side === "left" ? bounds.minX : bounds.maxX;
}

function resolveDockedPositionFromPointer(
  shellElement: HTMLElement | null,
  clientX: number,
  clientY: number
): FloatingQuickNavPosition {
  const bounds = getBubbleBounds(shellElement);
  const shellRect = shellElement?.getBoundingClientRect();
  const hasMeasuredShell = Boolean(shellRect && shellRect.width > BUBBLE_SIZE_PX);
  const localX = hasMeasuredShell && shellRect ? clientX - shellRect.left : clientX;
  const localY = hasMeasuredShell && shellRect ? clientY - shellRect.top : clientY;
  const shellWidth = hasMeasuredShell && shellRect ? shellRect.width : window.innerWidth;

  return {
    side: localX <= shellWidth / 2 ? "left" : "right",
    y: clamp(localY - BUBBLE_SIZE_PX / 2, bounds.minY, bounds.maxY)
  };
}

function buildActionStyle(angleDeg: number, index: number) {
  const radians = (angleDeg * Math.PI) / 180;
  const x = Math.cos(radians) * ACTION_ORBIT_RADIUS_PX;
  const y = Math.sin(radians) * ACTION_ORBIT_RADIUS_PX;

  return {
    "--radial-nav-index": `${index}`,
    "--radial-nav-x": `${x}px`,
    "--radial-nav-y": `${y}px`
  } as CSSProperties;
}

function resolveActionAngle(
  index: number,
  actionCount: number,
  side: QuickNavDockSide
) {
  if (actionCount <= 1) {
    return side === "right" ? 180 : 0;
  }

  const startAngle = side === "right" ? 252 : 288;
  const endAngle = side === "right" ? 108 : 72;
  const progress = index / (actionCount - 1);

  return normalizeAngle(interpolateArcAngle(startAngle, endAngle, progress));
}

function interpolateArcAngle(startAngle: number, endAngle: number, progress: number) {
  const normalizedStart = normalizeAngle(startAngle);
  const normalizedEnd = normalizeAngle(endAngle);
  const delta = normalizeSignedAngle(normalizedEnd - normalizedStart);

  return normalizedStart + delta * progress;
}

function normalizeSignedAngle(angleDeg: number) {
  const normalized = ((angleDeg + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
}

function normalizeAngle(angleDeg: number) {
  const normalized = angleDeg % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function readStoredPosition(): StoredQuickNavPosition | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(QUICK_NAV_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<StoredQuickNavPosition>;
    if (typeof parsed.yRatio !== "number") {
      return null;
    }

    return {
      side: parsed.side === "left" || parsed.side === "right" ? parsed.side : undefined,
      xRatio: typeof parsed.xRatio === "number" ? clamp(parsed.xRatio, 0, 1) : undefined,
      yRatio: clamp(parsed.yRatio, 0, 1)
    };
  } catch {
    return null;
  }
}

function positionFromStored(
  bounds: ReturnType<typeof getBubbleBounds>,
  storedPosition: StoredQuickNavPosition
): FloatingQuickNavPosition {
  const yRange = bounds.maxY - bounds.minY;
  const side = resolveStoredDockSide(storedPosition);

  return {
    side,
    y: bounds.minY + yRange * storedPosition.yRatio
  };
}

function resolveStoredDockSide(storedPosition: StoredQuickNavPosition): QuickNavDockSide {
  if (storedPosition.side === "left" || storedPosition.side === "right") {
    return storedPosition.side;
  }

  if (typeof storedPosition.xRatio === "number") {
    return storedPosition.xRatio <= 0.5 ? "left" : "right";
  }

  return "right";
}

function writeStoredPosition(
  shellElement: HTMLElement | null,
  position: FloatingQuickNavPosition
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const bounds = getBubbleBounds(shellElement);
    const yRange = Math.max(1, bounds.maxY - bounds.minY);
    const nextStoredPosition: StoredQuickNavPosition = {
      side: position.side,
      yRatio: clamp((position.y - bounds.minY) / yRange, 0, 1)
    };

    window.localStorage.setItem(QUICK_NAV_STORAGE_KEY, JSON.stringify(nextStoredPosition));
  } catch {
    // 忽略存储失败，避免影响对话操作
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function QuickNavIcon({ side }: { side: QuickNavDockSide }) {
  const pointsLeft = side === "right";

  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {pointsLeft ? (
        <>
          <path d="M15.5 7.5 9.5 12l6 4.5" />
          <path d="M9 12h7.5" />
        </>
      ) : (
        <>
          <path d="M8.5 7.5 14.5 12l-6 4.5" />
          <path d="M15 12H7.5" />
        </>
      )}
      <path d="M12 7.5v9" opacity="0.4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}
