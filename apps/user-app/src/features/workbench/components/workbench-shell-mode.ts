import type { ViewportClass } from "../../../platform/platform-adapter";

export type WorkbenchShellMode = "desktop" | "mobile";

interface WorkbenchShellModeInput {
  readonly isDesktop: boolean;
  readonly viewportClass: ViewportClass;
}

export function resolveWorkbenchShellMode({
  isDesktop,
  viewportClass
}: WorkbenchShellModeInput): WorkbenchShellMode {
  // 桌面 runtime 永远保留桌面壳；其余 runtime 只要进入宽屏，就统一走桌面壳。
  // 这能把 iPad 横屏从“移动壳里塞桌面面板”的混合状态里彻底拉出来。
  if (isDesktop || viewportClass === "expanded") {
    return "desktop";
  }

  return "mobile";
}
