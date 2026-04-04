import { useEffect } from "react";

export function DesktopDetachPreviewPage() {
  useEffect(() => {
    const previousHtmlBackground = document.documentElement.style.background;
    const previousBodyBackground = document.body.style.background;

    // 原生预览窗口需要透明根背景，否则卡片外侧会露出整块页面底色。
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";

    return () => {
      document.documentElement.style.background = previousHtmlBackground;
      document.body.style.background = previousBodyBackground;
    };
  }, []);

  return (
    <main className="desktop-detach-preview-page" aria-hidden="true">
      <section className="desktop-detach-preview-card">
        <header className="desktop-detach-preview-bar">
          <strong className="desktop-detach-preview-title">小窗口</strong>
        </header>
        <div className="desktop-detach-preview-body">
          <span className="desktop-detach-preview-badge" />
        </div>
      </section>
    </main>
  );
}
