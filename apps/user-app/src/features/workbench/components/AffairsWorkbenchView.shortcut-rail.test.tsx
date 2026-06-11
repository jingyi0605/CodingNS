import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { t } from "../../../shared/i18n";
import { SharedAffairsShortcutRail } from "./AffairsWorkbenchView";

describe("SharedAffairsShortcutRail", () => {
  it("系统快捷应用支持显示右上角数量角标", () => {
    render(
      <SharedAffairsShortcutRail
        standalone
        shortcutApps={[]}
        editing={false}
        addingShortcut={false}
        collapsed={false}
        systemItems={[
          {
            id: "terminal",
            title: t("shell.codeShortcutTerminalTitle"),
            iconText: (
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <rect x="4" y="5" width="16" height="14" rx="3" />
              </svg>
            ),
            actionLabel: t("shell.codeShortcutTerminalAction"),
            badge: "3",
            badgeLabel: `${t("terminalManager.terminalCountLabel")}: 3`
          }
        ]}
        onOpenShortcutApp={vi.fn()}
      />
    );

    const badge = screen.getByText("3");
    expect(badge).toHaveClass("affairs-shortcut-rail-icon-badge");
    expect(screen.getByRole("button", { name: t("shell.codeShortcutTerminalAction") }).querySelector("svg")).not.toBeNull();
  });
});
