import type { AppLanguage } from "../../config/client-config-types";
import { usePreferencesSelector, updatePreferences } from "../../preferences/preferences-store";
import { t } from "./index";

const LANGUAGE_OPTIONS: Array<{ id: AppLanguage; labelKey: string }> = [
  { id: "zh-CN", labelKey: "locale.zhCN" },
  { id: "en-US", labelKey: "locale.enUS" }
];

interface LanguageSwitcherProps {
  variant?: "default" | "compact";
  className?: string;
}

export function LanguageSwitcher({
  variant = "default",
  className
}: LanguageSwitcherProps) {
  const language = usePreferencesSelector((state) => state.profile.language);

  function handleLanguageChange(nextLanguage: AppLanguage): void {
    if (nextLanguage === language) {
      return;
    }

    void updatePreferences({ language: nextLanguage }).catch(() => {});
  }

  return (
    <label
      className={`language-switcher language-switcher-${variant}${className ? ` ${className}` : ""}`}
    >
      <span className="language-switcher-label">{t("common.language")}</span>
      <div className="language-switcher-options" role="group" aria-label={t("common.language")}>
        {LANGUAGE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`language-switcher-option${language === option.id ? " active" : ""}`}
            aria-pressed={language === option.id}
            onClick={() => handleLanguageChange(option.id)}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>
    </label>
  );
}
