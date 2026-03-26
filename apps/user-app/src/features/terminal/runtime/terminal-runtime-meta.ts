import { t } from "../../../shared/i18n";

export type SelectableTerminalRuntimeType = "" | "tmux" | "embedded-pty";

export interface TerminalRuntimeOption {
  value: SelectableTerminalRuntimeType;
  label: string;
  description: string;
}

export function listTerminalRuntimeOptions(): TerminalRuntimeOption[] {
  return [
    {
      value: "",
      label: t("terminal.runtimeAutoOption"),
      description: t("terminal.runtimeAutoDescription")
    },
    {
      value: "tmux",
      label: "tmux",
      description: t("terminal.runtimeTmuxDescription")
    },
    {
      value: "embedded-pty",
      label: "embedded-pty",
      description: t("terminal.runtimeEmbeddedDescription")
    }
  ];
}

export function getTerminalRuntimeLabel(runtimeType?: string | null): string {
  if (!runtimeType) {
    return t("terminal.runtimeAutoOption");
  }

  return runtimeType;
}

export function getTerminalRuntimeShortLabel(runtimeType?: string | null): string {
  if (!runtimeType) {
    return t("terminal.runtimeAutoShortLabel");
  }

  if (runtimeType === "embedded-pty") {
    return "pty";
  }

  return runtimeType;
}
