import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";

import { t } from "../../../shared/i18n";
import {
  resolveContextMenuPosition,
  type ContextMenuAnchorPoint
} from "../../workbench/utils/context-menu-position";
import { MoreActionIcon } from "./ConversationActionIcons";
import { SessionButlerActionButton } from "./SessionButlerActionButton";

import type { SessionSummaryDto } from "../api/conversation-api";

const MENU_ESTIMATED_HEIGHT_PX = 340;

export function MobileConversationSessionActions({
  session,
  onOpenBranchTree
}: {
  session: SessionSummaryDto | null;
  onOpenBranchTree?: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchorPoint, setMenuAnchorPoint] = useState<ContextMenuAnchorPoint | null>(null);
  const [menuPositionStyle, setMenuPositionStyle] = useState<CSSProperties | null>(null);
  const [assistantOpenRequestKey, setAssistantOpenRequestKey] = useState(0);

  useEffect(() => {
    setMenuOpen(false);
    setMenuAnchorPoint(null);
  }, [location.pathname, location.search]);

  useLayoutEffect(() => {
    if (!menuOpen || !menuAnchorPoint || typeof window === "undefined") {
      setMenuPositionStyle(null);
      return;
    }

    const updateMenuPosition = () => {
      const nextPosition = resolveContextMenuPosition(
        menuAnchorPoint,
        {
          width: menuRef.current?.offsetWidth ?? 0,
          height: menuRef.current?.offsetHeight ?? 0
        },
        {
          width: window.innerWidth,
          height: window.innerHeight
        },
        {
          estimatedHeightPx: MENU_ESTIMATED_HEIGHT_PX
        }
      );

      setMenuPositionStyle({
        position: "fixed",
        left: `${Math.round(nextPosition.left)}px`,
        top: `${Math.round(nextPosition.top)}px`,
        width: `${Math.round(nextPosition.width)}px`,
        maxWidth: "calc(100vw - 24px)",
        maxHeight: `${Math.round(nextPosition.maxHeight)}px`,
        transformOrigin: nextPosition.transformOrigin
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;

      if (target && !menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        closeMenu();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    updateMenuPosition();
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuAnchorPoint, menuOpen]);

  function openMenu() {
    const triggerRect = triggerRef.current?.getBoundingClientRect();

    if (!triggerRect) {
      return;
    }

    setMenuAnchorPoint({
      x: triggerRect.right,
      y: triggerRect.bottom
    });
    setMenuOpen(true);
  }

  function closeMenu() {
    setMenuOpen(false);
    setMenuAnchorPoint(null);
  }

  function handleNavigate(path: string) {
    navigate(path);
    closeMenu();
  }

  function handleSelectToolPanel(nextPanel: "files" | "git" | "processes") {
    const nextSearchParams = new URLSearchParams(location.search);
    nextSearchParams.set("toolPanel", nextPanel);
    handleNavigate(`${location.pathname}?${nextSearchParams.toString()}`);
  }

  function handleToggleMenu() {
    if (menuOpen) {
      closeMenu();
      return;
    }

    openMenu();
  }

  function handleKeyboardContextMenu(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openMenu();
  }

  if (!session) {
    return null;
  }

  const menuItems = [
    {
      key: "assistant",
      label: t("shell.butlerEntry"),
      onSelect: () => {
        setAssistantOpenRequestKey((current) => current + 1);
        closeMenu();
      }
    },
    ...(onOpenBranchTree
      ? [
          {
            key: "branch",
            label: t("conversation.branchAction"),
            onSelect: () => {
              onOpenBranchTree();
              closeMenu();
            }
          }
        ]
      : []),
    {
      key: "files",
      label: t("shell.filesEntry"),
      onSelect: () => {
        handleSelectToolPanel("files");
      }
    },
    {
      key: "git",
      label: t("shell.gitEntry"),
      onSelect: () => {
        handleSelectToolPanel("git");
      }
    },
    {
      key: "processes",
      label: t("shell.mobileConversationToolProcessesTab"),
      onSelect: () => {
        handleSelectToolPanel("processes");
      }
    }
  ];
  const sessionActionMenu =
    menuOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            className="session-action-menu mobile-conversation-action-menu surface-card"
            role="menu"
            aria-label={t("conversation.moreSessionActions")}
            style={
              menuPositionStyle ?? {
                position: "fixed",
                top: 0,
                left: 0,
                visibility: "hidden"
              }
            }
            onClick={(event) => event.stopPropagation()}
          >
            {menuItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className="session-action-menu-item mobile-conversation-action-menu-item"
                role="menuitem"
                onClick={item.onSelect}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <div className="mobile-conversation-session-actions">
        <button
          ref={triggerRef}
          type="button"
          className="conversation-header-ai-button mobile-conversation-more-button"
          aria-label={t("conversation.moreSessionActions")}
          title={t("conversation.moreSessionActions")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={handleToggleMenu}
          onKeyDown={handleKeyboardContextMenu}
        >
          <span className="conversation-header-ai-button-label" aria-hidden="true">
            <MoreActionIcon />
          </span>
        </button>
        <SessionButlerActionButton
          session={session}
          showTrigger={false}
          openRequestKey={assistantOpenRequestKey}
        />
      </div>
      {sessionActionMenu}
    </>
  );
}
