import { useEffect, useMemo, useState, type FormEvent } from "react";

import { t } from "../../../shared/i18n";
import { WorkspaceImportBrowserModal } from "../../conversation/components/WorkspaceImportBrowserModal";
import type {
  ButlerLanguageId,
  ButlerProviderId,
  ButlerRiskPreferenceId,
  ButlerSummaryStyleId,
  ButlerToneId
} from "../api/butler-api";

import "../pages/ButlerPage.css";

export type ButlerReportPriorityPresetId =
  | "risk-first"
  | "blocker-first"
  | "verification-first"
  | "progress-first";

export interface ButlerInitFormState {
  displayName: string;
  providerId: ButlerProviderId;
  agentsMode: "inline" | "file";
  personaTone: ButlerToneId;
  personaLanguage: ButlerLanguageId;
  personaSummaryStyle: ButlerSummaryStyleId;
  focusRiskPreference: ButlerRiskPreferenceId;
  reportPriorityPreset: ButlerReportPriorityPresetId;
}

export const DEFAULT_BUTLER_INIT_FORM_STATE: ButlerInitFormState = {
  displayName: "",
  providerId: "codex",
  agentsMode: "inline",
  personaTone: "direct",
  personaLanguage: "zh-CN",
  personaSummaryStyle: "brief",
  focusRiskPreference: "conservative",
  reportPriorityPreset: "risk-first"
};

interface AffairsLibraryInitValue {
  enabled: boolean;
  rootDir: string;
}

interface ButlerInitFormProps {
  form: ButlerInitFormState;
  onChange: (updater: (current: ButlerInitFormState) => ButlerInitFormState) => void;
  submitting: boolean;
  submitLabel: string;
  previewName: string;
  previewAvatar: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  previewRuleLabel?: string;
  affairsLibrary?: {
    value: AffairsLibraryInitValue;
    onChange: (next: AffairsLibraryInitValue) => void;
  };
}

export function ButlerInitForm({
  form,
  onChange,
  submitting,
  submitLabel,
  previewName,
  previewAvatar,
  onSubmit,
  previewRuleLabel,
  affairsLibrary
}: ButlerInitFormProps) {
  const [browserOpen, setBrowserOpen] = useState(false);
  const [rootDirInput, setRootDirInput] = useState(affairsLibrary?.value.rootDir ?? "");

  useEffect(() => {
    setRootDirInput(affairsLibrary?.value.rootDir ?? "");
  }, [affairsLibrary?.value.rootDir]);

  const agentsModeOptions = useMemo(
    () => [
      { value: "inline", label: t("shell.butlerAgentsModeInline") },
      { value: "file", label: t("shell.butlerAgentsModeFile") }
    ] satisfies Array<{ value: "inline" | "file"; label: string }>,
    []
  );
  const toneOptions = useMemo(
    () => [
      { value: "direct", label: t("shell.butlerToneDirect") },
      { value: "steady", label: t("shell.butlerToneSteady") },
      { value: "friendly", label: t("shell.butlerToneFriendly") }
    ] satisfies Array<{ value: ButlerToneId; label: string }>,
    []
  );
  const languageOptions = useMemo(
    () => [
      { value: "zh-CN", label: t("shell.butlerLanguageZhCn") },
      { value: "en-US", label: t("shell.butlerLanguageEnUs") },
      { value: "bilingual", label: t("shell.butlerLanguageBilingual") }
    ] satisfies Array<{ value: ButlerLanguageId; label: string }>,
    []
  );
  const summaryStyleOptions = useMemo(
    () => [
      { value: "brief", label: t("shell.butlerSummaryBrief") },
      { value: "structured", label: t("shell.butlerSummaryStructured") },
      { value: "thorough", label: t("shell.butlerSummaryThorough") }
    ] satisfies Array<{ value: ButlerSummaryStyleId; label: string }>,
    []
  );
  const riskPreferenceOptions = useMemo(
    () => [
      { value: "conservative", label: t("shell.butlerRiskConservative") },
      { value: "balanced", label: t("shell.butlerRiskBalanced") },
      { value: "proactive", label: t("shell.butlerRiskProactive") }
    ] satisfies Array<{ value: ButlerRiskPreferenceId; label: string }>,
    []
  );
  const reportPriorityPresetOptions = useMemo(
    () => [
      { value: "risk-first", label: t("shell.butlerReportRiskFirst") },
      { value: "blocker-first", label: t("shell.butlerReportBlockerFirst") },
      { value: "verification-first", label: t("shell.butlerReportVerificationFirst") },
      { value: "progress-first", label: t("shell.butlerReportProgressFirst") }
    ] satisfies Array<{ value: ButlerReportPriorityPresetId; label: string }>,
    []
  );
  const selectedAgentsModeLabel = resolveOptionLabel(agentsModeOptions, form.agentsMode);
  const selectedToneLabel = resolveOptionLabel(toneOptions, form.personaTone);
  const selectedLanguageLabel = resolveOptionLabel(languageOptions, form.personaLanguage);
  const selectedSummaryStyleLabel = resolveOptionLabel(summaryStyleOptions, form.personaSummaryStyle);
  const selectedRiskPreferenceLabel = resolveOptionLabel(riskPreferenceOptions, form.focusRiskPreference);
  const selectedReportPriorityLabel = resolveOptionLabel(reportPriorityPresetOptions, form.reportPriorityPreset);
  const selectedAgentsModeDescription =
    form.agentsMode === "inline"
      ? t("shell.butlerAgentsModeInlineDescription")
      : t("shell.butlerAgentsModeFileDescription");
  const previewTags = [
    selectedAgentsModeLabel,
    selectedLanguageLabel,
    selectedRiskPreferenceLabel
  ];

  function handlePickDirectory() {
    if (!affairsLibrary) {
      return;
    }
    setBrowserOpen(true);
  }

  return (
    <>
      <div className="butler-init-backdrop" aria-hidden="true">
        <span className="butler-init-glow butler-init-glow-primary" />
        <span className="butler-init-glow butler-init-glow-secondary" />
      </div>

      <div className="butler-init-layout">
        <aside className="butler-init-sidebar">
          <section className="butler-init-hero-card">
            <div className="butler-init-hero-copy">
              <h1>{t("shell.butlerInitTitle")}</h1>
              <p>{t("shell.butlerInitDescription")}</p>
            </div>
          </section>

          <section className="butler-init-preview-card">
            <header className="butler-init-section-header">
              <div>
                <h2>{t("shell.butlerInitPreviewTitle")}</h2>
              </div>
            </header>

            <div className="butler-init-preview-identity">
              <div className="butler-init-preview-nameplate">
                <div className="butler-chat-avatar butler-init-preview-avatar">
                  <span>{previewAvatar}</span>
                </div>
                <strong>{previewName}</strong>
              </div>
            </div>

            <div className="butler-init-chip-list">
              {previewTags.map((tag) => (
                <span key={tag} className="butler-init-chip">
                  {tag}
                </span>
              ))}
            </div>

            <div className="butler-init-preview-rows">
              <div className="butler-init-preview-row">
                <span>{t("shell.butlerPersonaToneLabel")}</span>
                <strong>{selectedToneLabel}</strong>
              </div>
              <div className="butler-init-preview-row">
                <span>{previewRuleLabel ?? t("shell.butlerInitPreviewRuleLabel")}</span>
                <strong>{selectedAgentsModeLabel}</strong>
              </div>
              <div className="butler-init-preview-row">
                <span>{t("shell.butlerPersonaSummaryStyleLabel")}</span>
                <strong>{selectedSummaryStyleLabel}</strong>
              </div>
              <div className="butler-init-preview-row">
                <span>{t("shell.butlerReportPriorityPresetLabel")}</span>
                <strong>{selectedReportPriorityLabel}</strong>
              </div>
              {affairsLibrary ? (
                <div className="butler-init-preview-row">
                  <span>{t("shell.affairsLibraryNav")}</span>
                  <strong>
                    {affairsLibrary.value.enabled
                      ? t("shell.affairsLibraryEnabledState")
                      : t("shell.affairsLibraryDisabledState")}
                  </strong>
                </div>
              ) : null}
            </div>
          </section>
        </aside>

        <form className="butler-init-form" onSubmit={onSubmit}>
          <section className="butler-init-form-section">
            <header className="butler-init-section-header">
              <div>
                <h2>{t("shell.butlerInitBasicsTitle")}</h2>
              </div>
            </header>

            <div className="butler-init-form-grid butler-init-basic-grid">
              <label className="butler-form-field">
                <span>{t("shell.butlerDisplayNameLabel")}</span>
                <input
                  className="butler-form-control"
                  value={form.displayName}
                  onChange={(event) => onChange((current) => ({
                    ...current,
                    displayName: event.target.value
                  }))}
                  placeholder={t("shell.butlerDisplayNamePlaceholder")}
                />
                <small>{t("shell.butlerDisplayNameHint")}</small>
              </label>

              <label className="butler-form-field butler-form-field-wide">
                <span>{t("shell.butlerAgentsModeLabel")}</span>
                <select
                  className="butler-form-control"
                  value={form.agentsMode}
                  onChange={(event) => onChange((current) => ({
                    ...current,
                    agentsMode: event.target.value as "inline" | "file"
                  }))}
                >
                  {agentsModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small>{selectedAgentsModeDescription}</small>
              </label>
            </div>
          </section>

          <section className="butler-init-form-section">
            <header className="butler-init-section-header">
              <div>
                <h2>{t("shell.butlerInitPersonaTitle")}</h2>
              </div>
            </header>

            <div className="butler-init-form-grid butler-init-persona-grid">
              <label className="butler-form-field">
                <span>{t("shell.butlerPersonaToneLabel")}</span>
                <select
                  className="butler-form-control"
                  value={form.personaTone}
                  onChange={(event) => onChange((current) => ({
                    ...current,
                    personaTone: event.target.value as ButlerToneId
                  }))}
                >
                  {toneOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="butler-form-field">
                <span>{t("shell.butlerPersonaLanguageLabel")}</span>
                <select
                  className="butler-form-control"
                  value={form.personaLanguage}
                  onChange={(event) => onChange((current) => ({
                    ...current,
                    personaLanguage: event.target.value as ButlerLanguageId
                  }))}
                >
                  {languageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="butler-form-field">
                <span>{t("shell.butlerPersonaSummaryStyleLabel")}</span>
                <select
                  className="butler-form-control"
                  value={form.personaSummaryStyle}
                  onChange={(event) => onChange((current) => ({
                    ...current,
                    personaSummaryStyle: event.target.value as ButlerSummaryStyleId
                  }))}
                >
                  {summaryStyleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="butler-init-form-section">
            <header className="butler-init-section-header">
              <div>
                <h2>{t("shell.butlerInitPreferenceTitle")}</h2>
              </div>
            </header>

            <div className="butler-init-form-grid butler-init-preferences-grid">
              <label className="butler-form-field">
                <span>{t("shell.butlerFocusRiskPreferenceLabel")}</span>
                <select
                  className="butler-form-control"
                  value={form.focusRiskPreference}
                  onChange={(event) => onChange((current) => ({
                    ...current,
                    focusRiskPreference: event.target.value as ButlerRiskPreferenceId
                  }))}
                >
                  {riskPreferenceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="butler-form-field">
                <span>{t("shell.butlerReportPriorityPresetLabel")}</span>
                <select
                  className="butler-form-control"
                  value={form.reportPriorityPreset}
                  onChange={(event) => onChange((current) => ({
                    ...current,
                    reportPriorityPreset: event.target.value as ButlerReportPriorityPresetId
                  }))}
                >
                  {reportPriorityPresetOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {affairsLibrary ? (
            <section className="butler-init-form-section">
              <header className="butler-init-section-header">
                <div>
                  <h2>{t("shell.affairsInitLibraryTitle")}</h2>
                  <p>{t("shell.affairsInitLibraryDescription")}</p>
                </div>
              </header>

              <div className="butler-init-basic-grid">
                <label className="butler-form-field butler-form-field-wide">
                  <span>{t("shell.affairsInitLibraryEnabledLabel")}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={affairsLibrary.value.enabled}
                    className={affairsLibrary.value.enabled ? "butler-switch-field active" : "butler-switch-field"}
                    onClick={() => affairsLibrary.onChange({
                      ...affairsLibrary.value,
                      enabled: !affairsLibrary.value.enabled
                    })}
                  >
                    <span className="butler-switch-control" aria-hidden="true">
                      <span className="butler-switch-thumb" />
                    </span>
                    <span className="butler-switch-copy">
                      <strong>
                        {affairsLibrary.value.enabled
                          ? t("shell.affairsLibraryEnableAction")
                          : t("shell.affairsLibraryDisableAction")}
                      </strong>
                      <small>
                        {affairsLibrary.value.enabled
                          ? t("shell.affairsLibraryEnabledState")
                          : t("shell.affairsLibraryDisabledState")}
                      </small>
                    </span>
                  </button>
                  <small>{t("shell.affairsInitLibraryEnabledHint")}</small>
                </label>

                {affairsLibrary.value.enabled ? (
                  <label className="butler-form-field butler-form-field-wide">
                    <span>{t("shell.affairsLibraryBindingFieldLabel")}</span>
                    <input
                      className="butler-form-control"
                      value={rootDirInput}
                      onChange={(event) => {
                        const nextRootDir = event.target.value;
                        setRootDirInput(nextRootDir);
                        affairsLibrary.onChange({
                          ...affairsLibrary.value,
                          rootDir: nextRootDir
                        });
                      }}
                      placeholder={t("shell.affairsLibraryBindingFieldPlaceholder")}
                    />
                    <small>{t("shell.affairsInitLibraryPathHint")}</small>
                  </label>
                ) : null}
              </div>

              {affairsLibrary.value.enabled ? (
                <div className="butler-init-inline-actions">
                  <button
                    type="button"
                    className="secondary-button butler-library-pick-button"
                    onClick={() => {
                      void handlePickDirectory();
                    }}
                  >
                    {t("shell.affairsLibraryBindingBrowseAction")}
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="butler-init-actions">
            <button
              className="butler-init-submit"
              type="submit"
              disabled={submitting}
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>

      {affairsLibrary ? (
        <WorkspaceImportBrowserModal
          open={browserOpen}
          mode="select-directory"
          title={t("shell.affairsLibraryBindingPickerTitle")}
          description={t("shell.affairsLibraryBindingPickerDescription")}
          submitLabel={t("shell.affairsLibraryBindingUseThisDirectory")}
          initialPath={rootDirInput || null}
          onClose={() => setBrowserOpen(false)}
          onSelectedPath={async (selectedPath) => {
            setRootDirInput(selectedPath);
            affairsLibrary.onChange({
              ...affairsLibrary.value,
              rootDir: selectedPath
            });
            setBrowserOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function resolveOptionLabel<T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>,
  value: T
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
