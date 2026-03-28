import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { canConfigureHostBaseUrl } from "../../../config/client-config-service";
import { serverConfigStore, useServerConfigSelector } from "../../../config/server-config";
import { authGateway } from "../../../auth/auth-gateway";
import { probeHost } from "../../../network/host-probe";
import { usePlatform } from "../../../platform/platform-provider";
import { LanguageSwitcher, t, useT } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { useTheme } from "../../../shared/theme";
import { authStore, useAuthSelector } from "../store/auth-store";
import {
  clearRememberedLoginCredentials,
  persistRememberedLoginCredentials,
  readRememberedLoginCredentials,
  supportsRememberPassword
} from "../store/remembered-login";
import { ServerSettingsModal } from "../components/ServerSettingsModal";

// Animated background particles
function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    const handleResize = () => {
      resize();
      createParticles();
    };
    let particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      opacity: number;
    }> = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const createParticles = () => {
      particles = [];
      const count = Math.min(50, Math.floor((canvas.width * canvas.height) / 25000));
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
          size: Math.random() * 2 + 1,
          opacity: Math.random() * 0.5 + 0.2
        });
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw particles
      particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(10, 132, 255, ${p.opacity})`;
        ctx.fill();

        // Draw connections
        particles.slice(i + 1).forEach(p2 => {
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(10, 132, 255, ${0.1 * (1 - dist / 150)})`;
            ctx.stroke();
          }
        });
      });

      animationId = requestAnimationFrame(draw);
    };

    resize();
    createParticles();
    draw();

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return <canvas ref={canvasRef} className="particle-canvas" />;
}

// Glitch text effect
function GlitchText({ text }: { text: string }) {
  return (
    <span className="glitch-text" data-text={text}>
      {text}
    </span>
  );
}

// Typewriter effect for subtitle
function TypewriterText({ text }: { text: string }) {
  const [displayText, setDisplayText] = useState("");
  const [showCursor, setShowCursor] = useState(true);

  useEffect(() => {
    let index = 0;
    let cursorTimeoutId: number | null = null;
    const interval = setInterval(() => {
      if (index <= text.length) {
        setDisplayText(text.slice(0, index));
        index++;
      } else {
        clearInterval(interval);
        // Hide cursor after typing complete
        cursorTimeoutId = window.setTimeout(() => setShowCursor(false), 1000);
      }
    }, 50);

    return () => {
      clearInterval(interval);

      if (cursorTimeoutId !== null) {
        window.clearTimeout(cursorTimeoutId);
      }
    };
  }, [text]);

  return (
    <span className="typewriter-text">
      {displayText}
      {showCursor && <span className="typewriter-cursor">_</span>}
    </span>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const t = useT();
  const [searchParams] = useSearchParams();
  const platform = usePlatform();
  const canConfigureServerAddress = canConfigureHostBaseUrl(platform.platform);
  const rememberPasswordSupported = useMemo(() => supportsRememberPassword(platform), [platform]);
  const rememberedLogin = useMemo(
    () => (rememberPasswordSupported ? readRememberedLoginCredentials() : null),
    [rememberPasswordSupported]
  );
  const rememberedServerBaseUrl = rememberedLogin?.serverBaseUrl ?? null;
  const [username, setUsername] = useState(() => rememberedLogin?.username ?? "admin");
  const [password, setPassword] = useState(() => rememberedLogin?.password ?? "");
  const [rememberPassword, setRememberPassword] = useState(() => Boolean(rememberedLogin));
  const persistedServerBaseUrl = useServerConfigSelector((state) => state.baseUrl);
  const [probeServerBaseUrl, setProbeServerBaseUrl] = useState(persistedServerBaseUrl);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showServerModal, setShowServerModal] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const authStatus = useAuthSelector((state) => state.status);
  const returnTo = useMemo(() => searchParams.get("returnTo") ?? "/", [searchParams]);
  const { theme } = useTheme();

  // Map app theme to login page theme (light or dark)
  const loginTheme = useMemo(() => {
    return theme === "light" ? "light" : "dark";
  }, [theme]);

  useEffect(() => {
    if (
      !rememberPasswordSupported ||
      !rememberedServerBaseUrl ||
      rememberedServerBaseUrl === persistedServerBaseUrl
    ) {
      return;
    }

    serverConfigStore.setBaseUrl(rememberedServerBaseUrl);
    setProbeServerBaseUrl(rememberedServerBaseUrl);
  }, [persistedServerBaseUrl, rememberPasswordSupported, rememberedServerBaseUrl]);

  useEffect(() => {
    if (authStatus === "authenticated") {
      navigate(returnTo, { replace: true });
      return;
    }

    if (!probeServerBaseUrl) {
      return;
    }

    let disposed = false;

    void probeHost(probeServerBaseUrl)
      .then((status) => {
        if (!disposed && status.reachable && !status.initialized) {
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
  }, [authStatus, navigate, probeServerBaseUrl, returnTo, t]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setStatusText(null);
    setProbeServerBaseUrl(persistedServerBaseUrl);

    if (rememberPasswordSupported && !rememberPassword) {
      clearRememberedLoginCredentials();
    }

    try {
      await authGateway.login(username, password, persistedServerBaseUrl);

      if (rememberPasswordSupported && rememberPassword) {
        persistRememberedLoginCredentials({
          username,
          password,
          serverBaseUrl: persistedServerBaseUrl
        });
      }

      navigate(returnTo, { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.errorCode === "BOOTSTRAP_REQUIRED") {
          navigate("/bootstrap", { replace: true });
          return;
        }
        setStatusText(error.message);
      } else {
        setStatusText(t("auth.authUnavailable"));
      }
    } finally {
      setLoading(false);
    }
  }

  function handleServerSettingsSave(baseUrl: string): void {
    setProbeServerBaseUrl(baseUrl);
    setStatusText(null);
  }

  const usernameInputId = "login-username";
  const passwordInputId = "login-password";

  return (
    <main className="cyber-login-page" data-theme={loginTheme}>
      {/* Animated Background */}
      <div className="cyber-bg">
        <div className="cyber-grid" />
        <div className="cyber-glow cyber-glow-1" />
        <div className="cyber-glow cyber-glow-2" />
        <ParticleField />
      </div>

      {/* Scanline overlay */}
      <div className="scanlines" />

      {/* Main Content */}
      <div className="cyber-login-container">
        <div className="cyber-login-toolbar">
          <LanguageSwitcher variant="compact" />
        </div>

        {/* Logo / Brand */}
        <div className="cyber-brand">
          <div className="cyber-logo">
            <img src="/logo.svg" alt="CodingNS" className="cyber-logo-svg" />
          </div>
          <h1 className="cyber-brand-title">
            <GlitchText text="CODING NS" />
          </h1>
          <p className="cyber-brand-subtitle">
            <TypewriterText text={t("auth.loginSubtitle")} />
          </p>
        </div>

        {/* Login Card */}
        <div className="cyber-card">
          {/* Decorative corners */}
          <div className="cyber-corner corner-tl" />
          <div className="cyber-corner corner-tr" />
          <div className="cyber-corner corner-bl" />
          <div className="cyber-corner corner-br" />

          {/* Header line */}
          <div className="cyber-card-header">
            <div className="cyber-line" />
            <span className="cyber-card-label">
              {t("auth.loginTitle").toUpperCase()}
            </span>
            <div className="cyber-line" />
          </div>

          <form className="cyber-form" onSubmit={handleSubmit}>
            {/* Username Field */}
            <div className={`cyber-field ${focusedField === "username" ? "focused" : ""}`}>
              <div className="cyber-field-border">
                <div className="cyber-field-border-glow" />
              </div>
              <label className="cyber-field-label" htmlFor={usernameInputId}>
                <span className="cyber-field-icon">❯</span>
                {t("auth.username")}
              </label>
              <input
                id={usernameInputId}
                aria-label={t("auth.username")}
                className="cyber-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setFocusedField("username")}
                onBlur={() => setFocusedField(null)}
                autoComplete="username"
              />
            </div>

            {/* Password Field */}
            <div className={`cyber-field ${focusedField === "password" ? "focused" : ""}`}>
              <div className="cyber-field-border">
                <div className="cyber-field-border-glow" />
              </div>
              <label className="cyber-field-label" htmlFor={passwordInputId}>
                <span className="cyber-field-icon">⚷</span>
                {t("auth.password")}
              </label>
              <input
                id={passwordInputId}
                aria-label={t("auth.password")}
                className="cyber-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocusedField("password")}
                onBlur={() => setFocusedField(null)}
                autoComplete="current-password"
              />
            </div>

            {rememberPasswordSupported ? (
              <label className="cyber-remember-toggle">
                <input
                  aria-label={t("auth.rememberPassword")}
                  type="checkbox"
                  checked={rememberPassword}
                  onChange={(event) => setRememberPassword(event.target.checked)}
                />
                <span>{t("auth.rememberPassword")}</span>
              </label>
            ) : null}

            {/* Status Message */}
            {statusText ? (
              <div className="cyber-status" data-tone="error">
                <span className="cyber-status-icon">⚠</span>
                <span>{statusText}</span>
              </div>
            ) : null}

            {/* Submit Button */}
            <button
              className={`cyber-submit ${loading ? "loading" : ""}`}
              type="submit"
              disabled={loading}
            >
              <span className="cyber-submit-glow" />
              <span className="cyber-submit-border" />
              <span className="cyber-submit-text">
                {loading ? (
                  <>
                    <span className="cyber-spinner" />
                    {t("common.loading")}
                  </>
                ) : (
                  <>
                    <span className="cyber-submit-icon">➤</span>
                    {t("auth.submitLogin")}
                  </>
                )}
              </span>
            </button>
          </form>

          {/* Server Settings Button */}
          {canConfigureServerAddress ? (
            <div className="cyber-footer">
              <div className="cyber-divider">
                <span className="cyber-divider-line" />
                <span className="cyber-divider-text">//</span>
                <span className="cyber-divider-line" />
              </div>
              <button
                className="cyber-server-btn"
                onClick={() => setShowServerModal(true)}
                type="button"
              >
                <span className="cyber-server-icon">⚙</span>
                <span className="cyber-server-text">{t("auth.serverSettings")}</span>
                <span className="cyber-server-current">{persistedServerBaseUrl}</span>
              </button>
            </div>
          ) : null}
        </div>

        {/* Version / Credits */}
        <div className="cyber-version">
          <span className="cyber-version-text">v1.0.0</span>
          <span className="cyber-version-divider">|</span>
          <span className="cyber-version-text">SYSTEM READY</span>
        </div>
      </div>

      {/* Server Settings Modal */}
      {canConfigureServerAddress ? (
        <ServerSettingsModal
          isOpen={showServerModal}
          onClose={() => setShowServerModal(false)}
          onSave={handleServerSettingsSave}
          theme={loginTheme}
        />
      ) : null}
    </main>
  );
}
