import { useEffect, useState, type CSSProperties, type ReactNode, type Ref, type RefObject } from "react";
import { createPortal } from "react-dom";

interface ButlerAnchoredPopoverProps {
  open: boolean;
  id?: string;
  role?: string;
  labelledBy?: string;
  className: string;
  backdropClassName?: string;
  anchorRef: RefObject<HTMLElement | null>;
  popoverRef?: Ref<HTMLDivElement>;
  children: ReactNode;
  maxWidth?: number;
  gap?: number;
  viewportPadding?: number;
  showBackdrop?: boolean;
  onBackdropClick?: () => void;
}

interface PopoverPosition {
  top: number;
  left: number;
  width: number;
  placeAbove: boolean;
  maxHeight: number;
}

const BUTLER_POPOVER_Z_INDEX = 1700;

export function ButlerAnchoredPopover({
  open,
  id,
  role = "dialog",
  labelledBy,
  className,
  backdropClassName,
  anchorRef,
  popoverRef,
  children,
  maxWidth = 360,
  gap = 10,
  viewportPadding = 16,
  showBackdrop = false,
  onBackdropClick
}: ButlerAnchoredPopoverProps) {
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  useEffect(() => {
    if (!open || typeof window === "undefined" || typeof document === "undefined") {
      setPosition(null);
      return;
    }

    let frameId = 0;

    const updatePosition = () => {
      const anchorElement = anchorRef.current;

      if (!anchorElement) {
        return;
      }

      const anchorRect = anchorElement.getBoundingClientRect();
      const width = Math.max(
        180,
        Math.min(maxWidth, window.innerWidth - viewportPadding * 2)
      );
      const left = Math.min(
        Math.max(viewportPadding, anchorRect.right - width),
        Math.max(viewportPadding, window.innerWidth - viewportPadding - width)
      );
      const placeAbove = anchorRect.top >= Math.min(240, window.innerHeight * 0.42);
      const top = Math.round(placeAbove ? anchorRect.top - gap : anchorRect.bottom + gap);
      const availableHeight = placeAbove
        ? anchorRect.top - gap - viewportPadding
        : window.innerHeight - anchorRect.bottom - gap - viewportPadding;
      const maxHeight = Math.max(180, Math.floor(availableHeight));

      setPosition({
        top,
        left: Math.round(left),
        width,
        placeAbove,
        maxHeight
      });
    };

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updatePosition);
    };

    updatePosition();
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
    };
  }, [anchorRef, gap, maxWidth, open, viewportPadding]);

  if (!open || !position || typeof document === "undefined") {
    return null;
  }

  const style: CSSProperties = {
    position: "fixed",
    top: position.top,
    left: position.left,
    width: position.width,
    maxWidth: `calc(100vw - ${viewportPadding * 2}px)`,
    maxHeight: `${position.maxHeight}px`,
    zIndex: BUTLER_POPOVER_Z_INDEX,
    transform: position.placeAbove ? "translateY(-100%)" : undefined
  };

  return createPortal(
    <>
      {showBackdrop ? (
        <button
          type="button"
          className={backdropClassName}
          aria-hidden="true"
          tabIndex={-1}
          onClick={onBackdropClick}
          style={{ zIndex: BUTLER_POPOVER_Z_INDEX - 1 }}
        />
      ) : null}
      <div
        id={id}
        ref={popoverRef}
        role={role}
        aria-labelledby={labelledBy}
        className={className}
        data-placement={position.placeAbove ? "top" : "bottom"}
        style={style}
      >
        {children}
      </div>
    </>,
    document.body
  );
}
