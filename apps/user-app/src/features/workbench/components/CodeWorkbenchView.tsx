import type { ReactNode } from "react";

interface CodeWorkbenchViewProps {
  children: ReactNode;
}

export function CodeWorkbenchView({ children }: CodeWorkbenchViewProps) {
  return <>{children}</>;
}
