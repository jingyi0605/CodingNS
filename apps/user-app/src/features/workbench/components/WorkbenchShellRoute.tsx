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
  isWeb,
  viewportClass
}: WorkbenchShellRouteInput): WorkbenchShellMode {
  if (isDesktop || (isWeb && viewportClass === "expanded")) {
    return "desktop";
  }

  return "mobile";
}

export function WorkbenchShellRoute() {
  const platform = usePlatform();
  const shellMode = resolveWorkbenchShellMode(platform);

  return <WorkbenchLayout shellMode={shellMode} />;
}
