import type { ReactNode } from "react";

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
    <section className={["mobile-page-header", className].filter(Boolean).join(" ")}>
      <div className="mobile-page-header-main">
        <div className="mobile-page-header-copy">
          <h1 className="mobile-page-header-title">{title}</h1>
          {description ? <p className="mobile-page-header-description">{description}</p> : null}
        </div>
        {actions ? <div className="mobile-page-header-actions">{actions}</div> : null}
      </div>
      {content ? <div className="mobile-page-header-content">{content}</div> : null}
    </section>
  );
}
