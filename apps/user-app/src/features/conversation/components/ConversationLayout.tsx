import type { PropsWithChildren, ReactNode } from "react";

interface ConversationLayoutProps extends PropsWithChildren {
  header: ReactNode;
  banner: ReactNode;
  sidebar: ReactNode;
  composer: ReactNode;
}

export function ConversationLayout({
  header,
  banner,
  sidebar,
  composer,
  children
}: ConversationLayoutProps) {
  return (
    <main className="conversation-layout app-shell">
      {header}
      <div className="conversation-stage">
        <div className="conversation-stage-inner">
          <section className="conversation-main">
            {banner}
            {children}
            {composer}
          </section>
          <aside className="side-panel">{sidebar}</aside>
        </div>
      </div>
    </main>
  );
}
