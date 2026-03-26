import { WorkbenchPlaceholderPage } from "./WorkbenchPlaceholderPage";
import { WorkspaceHomePage } from "../../mobile-workspaces/pages/WorkspaceHomePage";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";

export function WorkbenchLandingPage() {
  const { shellMode } = useWorkbenchShell();

  if (shellMode === "desktop") {
    return <WorkbenchPlaceholderPage />;
  }

  return <WorkspaceHomePage />;
}
