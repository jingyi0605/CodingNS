import type { ReactNode, Ref } from "react";

interface MobileTopHeaderFrameProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly frameRef?: Ref<HTMLDivElement>;
}

export function MobileTopHeaderFrame({ children, className, frameRef }: MobileTopHeaderFrameProps) {
  return (
    <div ref={frameRef} className={["mobile-top-header-frame", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
