import { t } from "../../../shared/i18n";
import type { PlatformOsFamily } from "../../../platform/platform-adapter";
import type { TerminalShellOptionDto } from "../api/terminal-api";

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

export function normalizeSelectableTerminalRuntimeType(
  runtimeType?: string | null
): SelectableTerminalRuntimeType {
  if (!runtimeType) {
    return "";
  }

  if (runtimeType === "embedded-pty") {
    return "embedded-pty";
  }

  return "tmux";
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

export function resolveTargetTerminalOsFamily(
  shellOptions: TerminalShellOptionDto[],
  targetHostId: string | null | undefined,
  fallbackOsFamily: OsFamily
): OsFamily {
  if (looksLikeWindowsShellOptions(shellOptions)) {
    return "windows";
  }

  if (targetHostId) {
    return fallbackOsFamily;
  }

  return fallbackOsFamily;
}

export function looksLikeWindowsShellOptions(shellOptions: TerminalShellOptionDto[]): boolean {
  if (shellOptions.length === 0) {
    return false;
  }

  return shellOptions.some((option) => {
    const shellValue = option.shell.trim().toLowerCase();
    const optionId = option.id.trim().toLowerCase();

    return (
      optionId === "cmd" ||
      optionId === "powershell" ||
      optionId === "git-bash" ||
      shellValue.endsWith(".exe") ||
      shellValue.includes("\\windows\\") ||
      shellValue.includes("\\program files\\git\\")
    );
  });
}
