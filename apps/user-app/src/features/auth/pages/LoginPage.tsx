import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { getBootstrapStatus } from "../api/auth-api";
import { authStore, useAuthSelector } from "../store/auth-store";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("password123");
  const [statusText, setStatusText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const authStatus = useAuthSelector((state) => state.status);
  const returnTo = useMemo(() => searchParams.get("returnTo") ?? "/", [searchParams]);

  useEffect(() => {
    if (authStatus === "authenticated") {
      navigate(returnTo, { replace: true });
      return;
    }

    void getBootstrapStatus()
      .then((status) => {
        if (!status.initialized) {
          navigate("/bootstrap", { replace: true });
        }
      })
      .catch(() => {
        setStatusText(t("auth.authUnavailable"));
      });
  }, [authStatus, navigate, returnTo]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatusText(null);

    try {
      await authStore.login(username, password);
      navigate(returnTo, { replace: true });
    } catch (error) {
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
        <h1>{t("auth.loginTitle")}</h1>
        <p className="status-text">{t("auth.loginSubtitle")}</p>
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
          {statusText ? (
            <p className="status-text" data-tone="error">
              {statusText}
            </p>
          ) : null}
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? t("common.loading") : t("auth.submitLogin")}
          </button>
        </form>
      </section>
    </main>
  );
}
