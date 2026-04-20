import { WorkbenchLayout } from "../../conversation/components/WorkbenchLayout";
import { usePlatform } from "../../../platform/platform-provider";
import { resolveWorkbenchShellMode } from "./workbench-shell-mode";

import "../../../app/workbench-native.css";

export function WorkbenchShellRoute() {
  const platform = usePlatform();
  const shellMode = resolveWorkbenchShellMode(platform);

  return <WorkbenchLayout shellMode={shellMode} />;
}
