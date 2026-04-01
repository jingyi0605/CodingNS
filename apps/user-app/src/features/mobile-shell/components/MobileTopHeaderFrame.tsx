import type { HTMLAttributes, ReactNode, Ref } from "react";

interface MobileTopHeaderFrameProps extends HTMLAttributes<HTMLDivElement> {
  readonly children: ReactNode;
  readonly className?: string;
  readonly frameRef?: Ref<HTMLDivElement>;
}

export function MobileTopHeaderFrame({
  children,
  className,
  frameRef,
  ...divProps
}: MobileTopHeaderFrameProps) {
  return (
    <div
      ref={frameRef}
      className={["mobile-top-header-frame", className].filter(Boolean).join(" ")}
      {...divProps}
    >
      {children}
    </div>
  );
}
