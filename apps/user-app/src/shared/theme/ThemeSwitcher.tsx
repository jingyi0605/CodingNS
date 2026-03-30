import { t } from "../i18n";
import { THEMES, getThemeLabel, useTheme, type ThemeId } from "./theme";
import { updatePreferences } from "../../preferences/preferences-store";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  function handleChange(newTheme: ThemeId): void {
    setTheme(newTheme);
    void updatePreferences({ theme: newTheme }).catch(() => {});
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
            title={getThemeLabel(t)}
            aria-label={getThemeLabel(t)}
            style={{ "--theme-color": t.color } as React.CSSProperties}
          >
            <span className="theme-option-dot" />
          </button>
        ))}
      </div>
    </div>
  );
}
