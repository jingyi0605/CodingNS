import { Navigate } from "react-router-dom";

import { WorkbenchPlaceholderPage } from "./WorkbenchPlaceholderPage";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";

export function WorkbenchLandingPage() {
  const { shellMode } = useWorkbenchShell();

  if (shellMode === "mobile") {
    return <Navigate to="/workspaces" replace />;
  }

  return <WorkbenchPlaceholderPage />;
}
