import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  getCustomServerOptionValue,
  getServerSelectValue,
  normalizeServerBaseUrl,
  serverConfigStore,
  useServerConfigSelector
} from "../../../config/server-config";
import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { getBootstrapStatus } from "../api/auth-api";
import { authStore, useAuthSelector } from "../store/auth-store";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("123456aA?!");
  const persistedServerBaseUrl = useServerConfigSelector((state) => state.baseUrl);
  const serverOptions = useServerConfigSelector((state) => state.options);
  const [serverBaseUrlInput, setServerBaseUrlInput] = useState(persistedServerBaseUrl);
  const [probeServerBaseUrl, setProbeServerBaseUrl] = useState(persistedServerBaseUrl);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const authStatus = useAuthSelector((state) => state.status);
  const returnTo = useMemo(() => searchParams.get("returnTo") ?? "/", [searchParams]);
  const customServerOptionValue = getCustomServerOptionValue();
  const normalizedServerBaseUrl = useMemo(() => {
    try {
      return normalizeServerBaseUrl(serverBaseUrlInput);
    } catch {
      return null;
    }
  }, [serverBaseUrlInput]);
  const selectedServerOption = getServerSelectValue(
    normalizedServerBaseUrl ?? serverBaseUrlInput,
    serverOptions
  );

  useEffect(() => {
    if (authStatus === "authenticated") {
      navigate(returnTo, { replace: true });
      return;
    }

    if (!probeServerBaseUrl) {
      return;
    }

    let disposed = false;

    void getBootstrapStatus(probeServerBaseUrl)
      .then((status) => {
        if (!disposed && !status.initialized) {
          const changed = serverConfigStore.setBaseUrl(probeServerBaseUrl);

          if (changed) {
            authStore.clear();
          }

          navigate("/bootstrap", { replace: true });
        }
      })
      .catch(() => {
        if (!disposed) {
          setStatusText(t("auth.authUnavailable"));
        }
      });

    return () => {
      disposed = true;
    };
  }, [authStatus, navigate, probeServerBaseUrl, returnTo]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!normalizedServerBaseUrl) {
      setStatusText(t("auth.serverInvalid"));
      return;
    }

    setLoading(true);
    setStatusText(null);
    setProbeServerBaseUrl(normalizedServerBaseUrl);

    try {
      const changed = serverConfigStore.setBaseUrl(normalizedServerBaseUrl);

      if (changed) {
        authStore.clear();
      }

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

  function handleServerBlur(): void {
    if (!normalizedServerBaseUrl) {
      return;
    }

    setServerBaseUrlInput(normalizedServerBaseUrl);
    setProbeServerBaseUrl(normalizedServerBaseUrl);
  }

  return (
    <main className="page-center app-shell">
      <section className="auth-card surface-card">
        <h1>{t("auth.loginTitle")}</h1>
        <p className="status-text">{t("auth.loginSubtitle")}</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field-group">
            <span>{t("auth.serverPreset")}</span>
            <select
              value={selectedServerOption}
              onChange={(event) => {
                const nextValue = event.target.value;

                if (nextValue === customServerOptionValue) {
                  return;
                }

                setServerBaseUrlInput(nextValue);
                setProbeServerBaseUrl(nextValue);
                setStatusText(null);
              }}
            >
              {serverOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={customServerOptionValue}>{t("auth.serverCustomOption")}</option>
            </select>
          </label>
          <label className="field-group">
            <span>{t("auth.serverAddress")}</span>
            <input
              value={serverBaseUrlInput}
              placeholder={t("auth.serverPlaceholder")}
              onBlur={handleServerBlur}
              onChange={(event) => setServerBaseUrlInput(event.target.value)}
            />
          </label>
          <p className="status-text">{t("auth.serverHint")}</p>
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
