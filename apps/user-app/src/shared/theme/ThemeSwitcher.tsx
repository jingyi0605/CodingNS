import { t } from "../i18n";
import { THEMES, useTheme, type ThemeId } from "./theme";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  function handleChange(newTheme: ThemeId): void {
    setTheme(newTheme);
  }

  return (
    <div className="theme-switcher">
      <span className="theme-switcher-label">{t("theme.switchLabel")}</span>
      <div className="theme-switcher-options">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`theme-option ${theme === t.id ? "active" : ""}`}
            onClick={() => handleChange(t.id)}
            title={t.label}
            aria-label={t.label}
            style={{ "--theme-color": t.color } as React.CSSProperties}
          >
            <span className="theme-option-dot" />
          </button>
        ))}
      </div>
    </div>
  );
}
