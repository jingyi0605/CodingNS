import { Suspense, lazy, useEffect, useState } from "react";

import { t } from "../shared/i18n";
import { bootstrapApplication } from "./bootstrap-app";

const App = lazy(async () => {
  const module = await import("../app/App");

  return {
    default: module.App
  };
});

export function BootstrapRoot() {
  const [ready, setReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    void bootstrapApplication()
      .then(() => {
        if (disposed) {
          return;
        }

        setReady(true);
      })
      .catch((error) => {
        if (disposed) {
          return;
        }

        setErrorMessage(
          error instanceof Error && error.message.trim()
            ? error.message
            : t("shell.navigationLoadFailed")
        );
      });

    return () => {
      disposed = true;
    };
  }, []);

  if (ready) {
    return (
      <Suspense fallback={null}>
        <App />
      </Suspense>
    );
  }

  return (
    <main className="page-center app-shell">
      <section className="auth-card surface-card">
        <h1>CodingNS</h1>
        <p className="status-text">{t("common.loading")}</p>
        {errorMessage ? (
          <p className="status-text" data-tone="error">
            {errorMessage}
          </p>
        ) : null}
      </section>
    </main>
  );
}
