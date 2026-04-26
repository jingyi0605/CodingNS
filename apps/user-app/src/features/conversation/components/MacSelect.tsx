import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export interface MacSelectOption {
  value: string;
  label: string;
}

const MAC_SELECT_MIN_WIDTH = 144;
const MAC_SELECT_DEFAULT_WIDTH = 196;
const MAC_SELECT_COMPACT_WIDTH = 124;
const MAC_SELECT_OPTION_EXTRA_WIDTH = 72;

let macSelectMeasureCanvas: HTMLCanvasElement | null = null;

function measureMacSelectTextWidth(referenceElement: HTMLElement, text: string): number {
  if (typeof document === "undefined") {
    return text.length * 8;
  }

  macSelectMeasureCanvas ??= document.createElement("canvas");
  const context = macSelectMeasureCanvas.getContext("2d");

  if (!context) {
    return text.length * 8;
  }

  const computedStyle = window.getComputedStyle(referenceElement);
  const fontStyle = computedStyle.fontStyle || "normal";
  const fontWeight = computedStyle.fontWeight || "600";
  const fontSize = computedStyle.fontSize || "13px";
  const fontFamily = computedStyle.fontFamily || "system-ui";
  context.font = `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`;

  return context.measureText(text).width;
}

export function resolveMacSelectPopoverWidth({
  labels,
  triggerWidth,
  maxWidth,
  preferredWidth,
  measureText
}: {
  labels: string[];
  triggerWidth: number;
  maxWidth: number;
  preferredWidth: number;
  measureText: (text: string) => number;
}): number {
  const contentWidth = labels.reduce((widest, label) => {
    return Math.max(widest, Math.ceil(measureText(label) + MAC_SELECT_OPTION_EXTRA_WIDTH));
  }, 0);

  return Math.min(
    maxWidth,
    Math.max(triggerWidth, MAC_SELECT_MIN_WIDTH, preferredWidth, contentWidth)
  );
}

export function MacSelect({
  triggerId,
  ariaLabel,
  value,
  options,
  onChange,
  disabled = false,
  compact = false,
  className
}: {
  triggerId?: string;
  ariaLabel: string;
  value: string;
  options: MacSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const listboxId = useId();
  const selectedOption = options.find((option) => option.value === value) ?? options[0] ?? null;
  const optionLabels = useMemo(() => options.map((option) => option.label), [options]);

  const updatePopoverStyle = useCallback(() => {
    const trigger = triggerRef.current;

    if (!trigger || typeof window === "undefined") {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const edgePadding = 12;
    const gap = 10;
    const maxWidth = Math.max(MAC_SELECT_MIN_WIDTH, viewportWidth - edgePadding * 2);
    const preferredWidth = compact ? MAC_SELECT_COMPACT_WIDTH : MAC_SELECT_DEFAULT_WIDTH;
    const width = resolveMacSelectPopoverWidth({
      labels: optionLabels,
      triggerWidth: rect.width,
      maxWidth,
      preferredWidth,
      measureText: (text) => measureMacSelectTextWidth(trigger, text)
    });
    const left = Math.min(
      Math.max(edgePadding, rect.left),
      Math.max(edgePadding, viewportWidth - width - edgePadding)
    );
    const spaceAbove = rect.top - edgePadding;
    const spaceBelow = viewportHeight - rect.bottom - edgePadding;
    const shouldPlaceAbove = spaceAbove >= 180 || spaceAbove >= spaceBelow;

    setPopoverStyle({
      position: "fixed",
      left,
      width,
      maxWidth,
      zIndex: 1905,
      top: shouldPlaceAbove ? undefined : rect.bottom + gap,
      bottom: shouldPlaceAbove ? viewportHeight - rect.top + gap : undefined
    });
  }, [compact, optionLabels]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (
        !wrapperRef.current?.contains(target)
        && !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", updatePopoverStyle);
    window.addEventListener("scroll", updatePopoverStyle, true);
    updatePopoverStyle();

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", updatePopoverStyle);
      window.removeEventListener("scroll", updatePopoverStyle, true);
    };
  }, [open, updatePopoverStyle]);

  if (!selectedOption) {
    return null;
  }

  return (
    <div
      ref={wrapperRef}
      className={`composer-mac-select ${compact ? "is-compact" : ""}${className ? ` ${className}` : ""}`}
      data-open={open ? "true" : "false"}
    >
      <button
        id={triggerId}
        ref={triggerRef}
        type="button"
        className="composer-mac-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="composer-mac-select-label">{selectedOption.label}</span>
        <svg
          className="composer-mac-select-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 14 12 8 18 14" />
        </svg>
      </button>

      {open && popoverStyle && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              className="composer-mac-select-popover"
              style={popoverStyle}
              role="presentation"
            >
              <div
                id={listboxId}
                className="composer-mac-select-list"
                role="listbox"
                aria-label={ariaLabel}
              >
                {options.map((option) => {
                  const selected = option.value === value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`composer-mac-select-option ${selected ? "is-selected" : ""}`}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                    >
                      <span className="composer-mac-select-option-check" aria-hidden="true">
                        {selected ? "✓" : ""}
                      </span>
                      <span className="composer-mac-select-option-label">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
