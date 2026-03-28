import type { ReactNode } from "react";

interface MobileTopHeaderFrameProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export function MobileTopHeaderFrame({ children, className }: MobileTopHeaderFrameProps) {
  return (
    <div className={["mobile-top-header-frame", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
