import type { ReactNode } from "react";

import { MobileTopHeaderFrame } from "./MobileTopHeaderFrame";

interface MobilePageHeaderProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly content?: ReactNode;
  readonly className?: string;
}

export function MobilePageHeader({
  title,
  description,
  actions,
  content,
  className
}: MobilePageHeaderProps) {
  return (
    <MobileTopHeaderFrame className={className}>
      <section className="mobile-workspace-home-header mobile-page-header">
        <h1 className="mobile-workspace-switcher-heading">{title}</h1>
        <div className="mobile-workspace-home-toolbar-top mobile-page-header-main">
          <div className="mobile-page-header-copy">
            <div className="mobile-workspace-home-switcher mobile-page-header-static-title">
              <span className="mobile-workspace-home-switcher-label">{title}</span>
            </div>
          </div>
          {actions ? <div className="mobile-workspace-home-toolbar-actions mobile-page-header-actions">{actions}</div> : null}
        </div>
        {description ? <p className="mobile-workspace-home-path mobile-page-header-description">{description}</p> : null}
        {content ? <div className="mobile-page-header-content">{content}</div> : null}
      </section>
    </MobileTopHeaderFrame>
  );
}
