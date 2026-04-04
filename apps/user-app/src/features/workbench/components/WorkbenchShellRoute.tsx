import { WorkbenchLayout, type WorkbenchShellMode } from "../../conversation/components/WorkbenchLayout";
import { usePlatform } from "../../../platform/platform-provider";
import type { ViewportClass } from "../../../platform/platform-adapter";

interface WorkbenchShellRouteInput {
  readonly isDesktop: boolean;
  readonly isWeb: boolean;
  readonly viewportClass: ViewportClass;
}

export function resolveWorkbenchShellMode({
  isDesktop,
  viewportClass
}: WorkbenchShellRouteInput): WorkbenchShellMode {
  // 桌面 runtime 永远保留桌面壳；其余 runtime 只要进入宽屏，就统一走桌面壳。
  // 这能把 iPad 横屏从“移动壳里塞桌面面板”的混合状态里彻底拉出来。
  if (isDesktop || viewportClass === "expanded") {
    return "desktop";
  }

  return "mobile";
}

export function WorkbenchShellRoute() {
  const platform = usePlatform();
  const shellMode = resolveWorkbenchShellMode(platform);

  return <WorkbenchLayout shellMode={shellMode} />;
}
