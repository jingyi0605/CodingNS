import { t } from "../../../shared/i18n";
import type { PlatformOsFamily } from "../../../platform/platform-adapter";

export type SelectableTerminalRuntimeType = "" | "tmux" | "embedded-pty";
type OsFamily = PlatformOsFamily;

export interface TerminalRuntimeOption {
  value: SelectableTerminalRuntimeType;
  label: string;
  description: string;
}

export function listTerminalRuntimeOptions(osFamily: OsFamily): TerminalRuntimeOption[] {
  return [
    {
      value: "",
      label: t("terminal.runtimeAutoOption"),
      description: t("terminal.runtimeAutoDescription")
    },
    {
      value: "tmux",
      label: osFamily === "windows" ? t("terminal.runtimePersistentLabel") : "tmux",
      description:
        osFamily === "windows"
          ? t("terminal.runtimeWindowsPersistentDescription")
          : t("terminal.runtimeTmuxDescription")
    },
    {
      value: "embedded-pty",
      label: "embedded-pty",
      description: t("terminal.runtimeEmbeddedDescription")
    }
  ];
}

export function getTerminalRuntimeLabel(runtimeType?: string | null, osFamily?: OsFamily): string {
  if (!runtimeType) {
    return t("terminal.runtimeAutoOption");
  }

  if (runtimeType === "conpty-powershell") {
    return t("terminal.runtimeConptyPowerShellLabel");
  }

  if (runtimeType === "conpty-cmd") {
    return t("terminal.runtimeConptyCmdLabel");
  }

  if (runtimeType === "conpty-git-bash") {
    return t("terminal.runtimeConptyGitBashLabel");
  }

  if (runtimeType === "tmux" && osFamily === "windows") {
    return t("terminal.runtimePersistentLabel");
  }

  return runtimeType;
}

export function getTerminalRuntimeShortLabel(
  runtimeType?: string | null,
  osFamily?: OsFamily
): string {
  if (!runtimeType) {
    return t("terminal.runtimeAutoShortLabel");
  }

  if (runtimeType === "embedded-pty") {
    return "pty";
  }

  if (
    runtimeType === "conpty-powershell" ||
    runtimeType === "conpty-cmd" ||
    runtimeType === "conpty-git-bash" ||
    (runtimeType === "tmux" && osFamily === "windows")
  ) {
    return t("terminal.runtimePersistentShortLabel");
  }

  return runtimeType;
}
