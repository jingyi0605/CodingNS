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
            iconText: ">_",
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
  });
});
