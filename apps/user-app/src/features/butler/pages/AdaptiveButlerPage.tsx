import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import { ButlerPage } from "./ButlerPage";
import { MobileButlerPage } from "./MobileButlerPage";

export function AdaptiveButlerPage() {
  const { shellMode } = useWorkbenchShell();

  return shellMode === "mobile" ? <MobileButlerPage /> : <ButlerPage />;
}
