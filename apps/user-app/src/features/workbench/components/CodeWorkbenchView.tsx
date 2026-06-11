import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";

import { t } from "../../../shared/i18n";
import { TerminalPage, type TerminalPageWorkbenchShellOverrides } from "../../terminal/pages/TerminalPage";
import type { CodeTerminalDockOrientation, CodeTerminalDockState } from "../utils/code-terminal-dock-state";

interface CodeWorkbenchViewProps {
  children: ReactNode;
  workspaceId: string | null;
  workspaceName?: string | null;
  terminalDockState: CodeTerminalDockState | null;
  terminalDockVisible?: boolean;
  onCloseTerminalDock: () => void;
  onChangeTerminalDockOrientation: (orientation: CodeTerminalDockOrientation) => void;
  onResizeTerminalDock: (ratio: number) => void;
  terminalWorkbenchShellOverrides?: TerminalPageWorkbenchShellOverrides;
}

const MIN_HORIZONTAL_PRIMARY = 320;
const MIN_HORIZONTAL_TERMINAL = 320;
const MIN_VERTICAL_PRIMARY = 220;
const MIN_VERTICAL_TERMINAL = 180;

export function CodeWorkbenchView({
  children,
  workspaceId,
  workspaceName = null,
  terminalDockState,
  terminalDockVisible = true,
  onCloseTerminalDock,
  onChangeTerminalDockOrientation,
  onResizeTerminalDock,
  terminalWorkbenchShellOverrides
}: CodeWorkbenchViewProps) {
  const dockOpen = Boolean(workspaceId && terminalDockState?.open && terminalDockVisible);
  const orientation = terminalDockState?.orientation ?? "vertical";
  const ratio = orientation === "horizontal"
    ? terminalDockState?.horizontalRatio ?? 0.42
    : terminalDockState?.verticalRatio ?? 0.36;
  const shellRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<{
    pointerId: number;
    orientation: CodeTerminalDockOrientation;
  } | null>(null);

  const shellStyle = useMemo(() => {
    if (!dockOpen) {
      return undefined;
    }

    return {
      "--code-terminal-dock-ratio": `${Math.round(ratio * 10000) / 100}%`
    } as CSSProperties;
  }, [dockOpen, ratio]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      const resizeState = resizeStateRef.current;
      const shellElement = shellRef.current;

      if (!resizeState || !shellElement) {
        return;
      }

      const rect = shellElement.getBoundingClientRect();

      if (resizeState.orientation === "horizontal") {
        const maxTerminalWidth = Math.max(MIN_HORIZONTAL_TERMINAL, rect.width - MIN_HORIZONTAL_PRIMARY);
        const terminalWidth = Math.min(
          maxTerminalWidth,
          Math.max(MIN_HORIZONTAL_TERMINAL, rect.right - event.clientX)
        );
        onResizeTerminalDock(terminalWidth / rect.width);
        return;
      }

      const maxTerminalHeight = Math.max(MIN_VERTICAL_TERMINAL, rect.height - MIN_VERTICAL_PRIMARY);
      const terminalHeight = Math.min(
        maxTerminalHeight,
        Math.max(MIN_VERTICAL_TERMINAL, rect.bottom - event.clientY)
      );
      onResizeTerminalDock(terminalHeight / rect.height);
    }

    function stopResize() {
      resizeStateRef.current = null;
      document.body.removeAttribute("data-code-terminal-dock-resizing");
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [onResizeTerminalDock]);

  function handleResizePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    nextOrientation: CodeTerminalDockOrientation
  ) {
    resizeStateRef.current = {
      pointerId: event.pointerId,
      orientation: nextOrientation
    };
    document.body.setAttribute("data-code-terminal-dock-resizing", "true");
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function stopMouseDownBubble(event: ReactMouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  return (
    <div
      ref={shellRef}
      className="code-workbench-view"
      data-terminal-visible={terminalDockVisible ? "true" : "false"}
      data-terminal-open={dockOpen ? "true" : "false"}
      data-terminal-orientation={dockOpen ? orientation : undefined}
      style={shellStyle}
    >
      <div className="code-workbench-conversation-pane">
        {children}
      </div>

      {dockOpen && workspaceId ? (
        <>
          <button
            type="button"
            className="code-workbench-terminal-resizer"
            data-orientation={orientation}
            role="separator"
            aria-label={t("shell.codeTerminalDockResizeLabel")}
            onPointerDown={(event) => handleResizePointerDown(event, orientation)}
            onMouseDown={stopMouseDownBubble}
          />
          <section
            className="code-workbench-terminal-pane"
            data-orientation={orientation}
            aria-label={t("shell.codeTerminalDockTitle")}
          >
            <div className="code-workbench-terminal-pane-body">
              <TerminalPage
                embeddedMode
                externalWindowWorkspaceId={workspaceId}
                workbenchShellOverrides={terminalWorkbenchShellOverrides}
                embeddedDockControls={{
                  orientation,
                  onChangeOrientation: onChangeTerminalDockOrientation,
                  onClose: onCloseTerminalDock
                }}
              />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
