import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useServerConfigSelector } from "../../../config/server-config";
import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { authStore } from "../store/auth-store";

export function BootstrapPage() {
  const navigate = useNavigate();
  const serverBaseUrl = useServerConfigSelector((state) => state.baseUrl);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("123456aA?!");
  const [confirmPassword, setConfirmPassword] = useState("123456aA?!");
  const [statusText, setStatusText] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"error" | "success">("error");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password !== confirmPassword) {
      setStatusTone("error");
      setStatusText(t("auth.bootstrapMismatch"));
      return;
    }

    setLoading(true);
    setStatusText(null);

    try {
      await authStore.bootstrap(username, password);
      setStatusTone("success");
      setStatusText(t("auth.bootstrapSuccess"));
      window.setTimeout(() => navigate("/login", { replace: true }), 500);
    } catch (error) {
      setStatusTone("error");
      if (error instanceof ApiError) {
        setStatusText(error.message);
      } else {
        setStatusText(t("auth.authUnavailable"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-center app-shell">
      <section className="auth-card surface-card">
        <h1>{t("auth.bootstrapTitle")}</h1>
        <p className="status-text">{t("auth.bootstrapSubtitle")}</p>
        <div className="field-group">
          <span>{t("auth.serverCurrent")}</span>
          <span className="auth-server-value">{serverBaseUrl}</span>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field-group">
            <span>{t("auth.username")}</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label className="field-group">
            <span>{t("auth.password")}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="field-group">
            <span>{t("auth.confirmPassword")}</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          {statusText ? (
            <p className="status-text" data-tone={statusTone}>
              {statusText}
            </p>
          ) : null}
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? t("common.loading") : t("auth.submitBootstrap")}
          </button>
        </form>
      </section>
    </main>
  );
}
