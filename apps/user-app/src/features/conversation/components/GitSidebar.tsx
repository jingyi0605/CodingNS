import { useEffect, useState } from "react";

import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { useToast } from "../../../shared/toast";
import {
  commitDraft,
  createCommitDraft,
  getCommitRules,
  getGitBranches,
  getGitDiff,
  getGitHistory,
  getGitStatus,
  stageGitTargets,
  switchGitBranch,
  syncGitRemote,
  unstageGitTargets,
  validateCommitDraft,
  type CommitDraftDto,
  type CommitRuleProfileDto,
  type CommitValidationResultDto,
  type GitBranchSnapshotDto,
  type GitDiffDto,
  type GitHistoryItemDto,
  type GitStatusDto
} from "../api/git-api";

interface GitSidebarProps {
  workspaceId: string | null | undefined;
}

const EMPTY_DRAFT: CommitDraftDto = {
  subject: "",
  body: "",
  footer: "",
  source: "manual"
};

export function GitSidebar({ workspaceId }: GitSidebarProps) {
  const [status, setStatus] = useState<GitStatusDto | null>(null);
  const [rules, setRules] = useState<CommitRuleProfileDto | null>(null);
  const [history, setHistory] = useState<GitHistoryItemDto[]>([]);
  const [branches, setBranches] = useState<GitBranchSnapshotDto | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedStaged, setSelectedStaged] = useState(false);
  const [diff, setDiff] = useState<GitDiffDto | null>(null);
  const [draft, setDraft] = useState<CommitDraftDto>(EMPTY_DRAFT);
  const [validation, setValidation] = useState<CommitValidationResultDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [branchInput, setBranchInput] = useState("");
  const { showToast } = useToast();

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      if (!workspaceId) {
        setStatus(null);
        setRules(null);
        setHistory([]);
        setBranches(null);
        setDiff(null);
        setValidation(null);
        setDraft(EMPTY_DRAFT);
        return;
      }

      setLoading(true);

      try {
        const [nextStatus, nextRules, nextHistory, nextBranches] = await Promise.all([
          getGitStatus(workspaceId),
          getCommitRules(workspaceId),
          getGitHistory(workspaceId, 5),
          getGitBranches(workspaceId)
        ]);

        if (cancelled) {
          return;
        }

        setStatus(nextStatus);
        setRules(nextRules);
        setHistory(nextHistory.items);
        setBranches(nextBranches);
        setDraft((current) =>
          current.subject || current.body || current.footer
            ? current
            : {
                ...EMPTY_DRAFT,
                footer: nextRules.requireIssue ? "Refs: #TODO" : ""
              }
        );
        setBranchInput(nextBranches.currentBranch);
      } catch (error) {
        if (cancelled) {
          return;
        }

        showToast({
          title: readError(error, t("git.panelLoadFailed")),
          tone: "error"
        });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadAll();

    return () => {
      cancelled = true;
    };
  }, [showToast, workspaceId]);

  useEffect(() => {
    let cancelled = false;

    async function loadDiff() {
      if (!workspaceId || !selectedPath) {
        setDiff(null);
        return;
      }

      try {
        const nextDiff = await getGitDiff(workspaceId, selectedPath, selectedStaged);

        if (!cancelled) {
          setDiff(nextDiff);
        }
      } catch (error) {
        if (!cancelled) {
          setDiff(null);
          showToast({
            title: readError(error, t("git.diffLoadFailed")),
            tone: "error"
          });
        }
      }
    }

    void loadDiff();

    return () => {
      cancelled = true;
    };
  }, [selectedPath, selectedStaged, showToast, workspaceId]);

  async function refreshContext() {
    if (!workspaceId) {
      return;
    }

    try {
      const [nextStatus, nextHistory, nextBranches] = await Promise.all([
        getGitStatus(workspaceId),
        getGitHistory(workspaceId, 5),
        getGitBranches(workspaceId)
      ]);

      setStatus(nextStatus);
      setHistory(nextHistory.items);
      setBranches(nextBranches);
      setBranchInput(nextBranches.currentBranch);
    } catch (error) {
      showToast({
        title: readError(error, t("git.panelLoadFailed")),
        tone: "error"
      });
    }
  }

  async function handleStageToggle(filePath: string, staged: boolean) {
    if (!workspaceId) {
      return;
    }

    setActioning(true);

    try {
      const nextStatus = staged
        ? await unstageGitTargets(workspaceId, [filePath])
        : await stageGitTargets(workspaceId, [filePath]);

      setStatus(nextStatus);
      setSelectedPath(filePath);
      setSelectedStaged(!staged);
    } catch (error) {
      showToast({
        title: readError(error, t("git.stageFailed")),
        tone: "error"
      });
    } finally {
      setActioning(false);
    }
  }

  async function handleDraft(mode: "manual" | "ai") {
    if (!workspaceId) {
      return;
    }

    setActioning(true);

    try {
      const response = await createCommitDraft(workspaceId, mode);
      setRules(response.ruleProfile);
      setDraft({
        subject: response.draft.subject,
        body: response.draft.body ?? "",
        footer: response.draft.footer ?? "",
        source: response.draft.source
      });
      setValidation(response.validation);
    } catch (error) {
      showToast({
        title: readError(error, t("git.draftFailed")),
        tone: "error"
      });
    } finally {
      setActioning(false);
    }
  }

  async function handleValidate() {
    if (!workspaceId) {
      return;
    }

    setActioning(true);

    try {
      const response = await validateCommitDraft(workspaceId, normalizeDraft(draft));
      setRules(response.ruleProfile);
      setValidation(response.validation);
      setDraft(response.validation.normalizedDraft);
    } catch (error) {
      showToast({
        title: readError(error, t("git.validateFailed")),
        tone: "error"
      });
    } finally {
      setActioning(false);
    }
  }

  async function handleCommit() {
    if (!workspaceId) {
      return;
    }

    setActioning(true);

    try {
      const response = await commitDraft(workspaceId, normalizeDraft(draft));
      setValidation(response.validation);
      showToast({
        title: t("git.commitSuccess"),
        tone: "success"
      });
      setDraft({
        subject: "",
        body: "",
        footer: rules?.requireIssue ? "Refs: #TODO" : "",
        source: "manual"
      });
      await refreshContext();
      setSelectedPath(null);
      setDiff(null);
    } catch (error) {
      showToast({
        title: readError(error, t("git.commitFailed")),
        tone: "error"
      });
    } finally {
      setActioning(false);
    }
  }

  async function handleSwitchBranch(create: boolean) {
    if (!workspaceId || !branchInput.trim()) {
      return;
    }

    setActioning(true);

    try {
      const nextBranches = await switchGitBranch(workspaceId, branchInput.trim(), create);
      setBranches(nextBranches);
      setBranchInput(nextBranches.currentBranch);
      await refreshContext();
    } catch (error) {
      showToast({
        title: readError(error, t("git.branchFailed")),
        tone: "error"
      });
    } finally {
      setActioning(false);
    }
  }

  async function handleRemoteSync(action: "fetch" | "pull" | "push" | "publish") {
    if (!workspaceId) {
      return;
    }

    setActioning(true);

    try {
      const result = await syncGitRemote(workspaceId, action);
      showToast({
        title: result.summary,
        tone: "success"
      });
      await refreshContext();
    } catch (error) {
      showToast({
        title: readError(error, t("git.remoteFailed")),
        tone: "error"
      });
    } finally {
      setActioning(false);
    }
  }

  return (
    <section className="conversation-panel surface-card git-sidebar" data-testid="git-sidebar">
      <div className="git-sidebar-header">
        <div>
          <h2>{t("git.title")}</h2>
          <p className="status-text">
            {loading ? t("git.loading") : t("git.subtitle")}
          </p>
        </div>
        <button className="ghost-button" type="button" onClick={() => void refreshContext()} disabled={actioning || !workspaceId}>
          {t("git.refresh")}
        </button>
      </div>

      <section className="git-card">
        <div className="badge-row">
          <span className="badge">{status?.snapshot.branch ?? t("common.unknown")}</span>
          <span className="badge">{t("git.ahead")} {status?.snapshot.ahead ?? 0}</span>
          <span className="badge">{t("git.behind")} {status?.snapshot.behind ?? 0}</span>
          <span className="badge" data-tone={status?.snapshot.isDirty ? "reconnecting" : "success"}>
            {status?.snapshot.isDirty ? t("git.dirty") : t("git.clean")}
          </span>
        </div>
        <p className="status-text">
          {status?.changes.length
            ? t("git.changeCount").replace("{count}", String(status.changes.length))
            : t("git.noChanges")}
        </p>
      </section>

      <section className="git-card">
        <div className="git-section-header">
          <h3>{t("git.changesTitle")}</h3>
          <span className="status-text">{t("git.rulesFirstHint")}</span>
        </div>
        <div className="git-change-list">
          {status?.changes.length ? (
            status.changes.map((item) => (
              <article
                key={`${item.path}-${item.status}`}
                className="git-change-item"
                data-active={selectedPath === item.path}
              >
                <button
                  className="git-change-main"
                  type="button"
                  onClick={() => {
                    setSelectedPath(item.path);
                    setSelectedStaged(item.staged);
                  }}
                >
                  <span className="badge">{item.status}</span>
                  <span className="git-change-path">{item.path}</span>
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void handleStageToggle(item.path, item.staged)}
                  disabled={actioning}
                >
                  {item.staged ? t("git.unstage") : t("git.stage")}
                </button>
              </article>
            ))
          ) : (
            <p className="status-text">{t("git.noChanges")}</p>
          )}
        </div>
        {diff ? (
          <div className="git-diff-card">
            <div className="git-section-header">
              <h3>{t("git.diffTitle")}</h3>
              <span className="status-text">
                {diff.binary ? t("git.binaryDiff") : diff.staged ? t("git.stagedDiff") : t("git.worktreeDiff")}
              </span>
            </div>
            <pre className="git-diff-preview">{diff.binary ? t("git.binaryDiff") : diff.content || t("git.emptyDiff")}</pre>
            {diff.truncated ? (
              <p className="status-text">{t("git.diffTruncated")}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="git-card">
        <div className="git-section-header">
          <h3>{t("git.commitTitle")}</h3>
          <span className="status-text">{rules?.name ?? t("git.defaultRuleName")}</span>
        </div>
        <div className="badge-row">
          <span className="badge">{t("git.language")} {rules?.language ?? "zh"}</span>
          <span className="badge">{t("git.maxLength")} {rules?.maxSubjectLength ?? 72}</span>
          <span className="badge" data-tone={rules?.requireBody ? "reconnecting" : "success"}>
            {rules?.requireBody ? t("git.bodyRequired") : t("git.bodyOptional")}
          </span>
          <span className="badge" data-tone={rules?.requireIssue ? "reconnecting" : "success"}>
            {rules?.requireIssue ? t("git.issueRequired") : t("git.issueOptional")}
          </span>
        </div>
        <div className="field-group">
          <span className="status-text">{t("git.commitSubject")}</span>
          <input
            value={draft.subject}
            onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
            placeholder={t("git.commitSubjectPlaceholder")}
          />
        </div>
        <div className="field-group">
          <span className="status-text">{t("git.commitBody")}</span>
          <textarea
            value={draft.body ?? ""}
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            placeholder={t("git.commitBodyPlaceholder")}
          />
        </div>
        <div className="field-group">
          <span className="status-text">{t("git.commitFooter")}</span>
          <input
            value={draft.footer ?? ""}
            onChange={(event) => setDraft({ ...draft, footer: event.target.value })}
            placeholder={t("git.commitFooterPlaceholder")}
          />
        </div>
        <div className="git-action-row">
          <button className="secondary-button" type="button" onClick={() => void handleDraft("ai")} disabled={actioning}>
            {t("git.generateDraft")}
          </button>
          <button className="secondary-button" type="button" onClick={() => void handleValidate()} disabled={actioning}>
            {t("git.validate")}
          </button>
          <button className="primary-button" type="button" onClick={() => void handleCommit()} disabled={actioning}>
            {t("git.commit")}
          </button>
        </div>
        {validation ? (
          <div className="git-validation-list">
            <p className="status-text" data-tone={validation.passed ? "success" : "error"}>
              {validation.passed ? t("git.validationPassed") : t("git.validationFailed")}
            </p>
            {validation.errors.map((item) => (
              <p key={`${item.code}-${item.field}`} className="status-text" data-tone="error">
                {item.detail}
              </p>
            ))}
            {validation.warnings.map((item) => (
              <p key={`${item.code}-${item.field}`} className="status-text">
                {item.detail}
              </p>
            ))}
          </div>
        ) : null}
      </section>

      <section className="git-card">
        <div className="git-section-header">
          <h3>{t("git.branchTitle")}</h3>
          <span className="status-text">{branches?.currentBranch ?? t("common.unknown")}</span>
        </div>
        <div className="git-branch-list">
          {branches?.local.slice(0, 4).map((item) => (
            <span key={item.name} className="badge" data-tone={item.current ? "success" : undefined}>
              {item.name}
            </span>
          ))}
        </div>
        <div className="git-inline-form">
          <input
            value={branchInput}
            onChange={(event) => setBranchInput(event.target.value)}
            placeholder={t("git.branchPlaceholder")}
          />
          <button className="secondary-button" type="button" onClick={() => void handleSwitchBranch(false)} disabled={actioning}>
            {t("git.switchBranch")}
          </button>
          <button className="secondary-button" type="button" onClick={() => void handleSwitchBranch(true)} disabled={actioning}>
            {t("git.createBranch")}
          </button>
        </div>
      </section>

      <section className="git-card">
        <div className="git-section-header">
          <h3>{t("git.historyTitle")}</h3>
          <span className="status-text">{t("git.historyHint")}</span>
        </div>
        <div className="git-history-list">
          {history.length ? (
            history.map((item) => (
              <article key={item.commitHash} className="git-history-item">
                <strong>{item.subject}</strong>
                <span className="status-text">{item.authorName}</span>
              </article>
            ))
          ) : (
            <p className="status-text">{t("git.noHistory")}</p>
          )}
        </div>
      </section>

      <section className="git-card">
        <div className="git-section-header">
          <h3>{t("git.remoteTitle")}</h3>
          <span className="status-text">
            {status?.snapshot.hasRemote ? t("git.remoteReady") : t("git.remoteMissing")}
          </span>
        </div>
        <div className="git-action-grid">
          <button className="secondary-button" type="button" onClick={() => void handleRemoteSync("fetch")} disabled={actioning || !workspaceId}>
            {t("git.fetch")}
          </button>
          <button className="secondary-button" type="button" onClick={() => void handleRemoteSync("pull")} disabled={actioning || !workspaceId}>
            {t("git.pull")}
          </button>
          <button className="secondary-button" type="button" onClick={() => void handleRemoteSync("push")} disabled={actioning || !workspaceId}>
            {t("git.push")}
          </button>
          <button className="secondary-button" type="button" onClick={() => void handleRemoteSync("publish")} disabled={actioning || !workspaceId}>
            {t("git.publish")}
          </button>
        </div>
      </section>
    </section>
  );
}

function normalizeDraft(draft: CommitDraftDto): CommitDraftDto {
  return {
    subject: draft.subject.trim(),
    body: draft.body?.trim() || null,
    footer: draft.footer?.trim() || null,
    source: draft.source
  };
}

function readError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return mapGitError(error) ?? error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    return (error as Error).message;
  }

  return fallback;
}

function mapGitError(error: ApiError): string | null {
  switch (error.errorCode) {
    case "UNAUTHORIZED":
      return t("git.errors.unauthorized");
    case "WORKSPACE_NOT_FOUND":
      return t("git.errors.workspaceNotFound");
    case "INVALID_WORKSPACE":
      return t("git.errors.invalidWorkspace");
    case "NOT_GIT_REPOSITORY":
      return t("git.errors.notGitRepository");
    case "GIT_REPO_NOT_FOUND":
      return t("git.errors.repoNotFound");
    case "PATH_OUT_OF_WORKSPACE":
      return t("git.errors.pathOutOfWorkspace");
    case "INVALID_TARGET":
      return t("git.errors.invalidTarget");
    case "NOT_STAGED":
      return t("git.errors.notStaged");
    case "EMPTY_STAGED_CHANGES":
      return t("git.errors.emptyStagedChanges");
    case "BRANCH_CONFLICT":
      return t("git.errors.branchConflict");
    case "BRANCH_NOT_FOUND":
      return t("git.errors.branchNotFound");
    case "REMOTE_NOT_FOUND":
      return t("git.errors.remoteNotFound");
    case "GIT_REMOTE_AUTH_FAILED":
      return t("git.errors.remoteAuthFailed");
    case "GIT_PUSH_FAILED":
      return t("git.errors.pushFailed");
    case "GIT_PULL_FAILED":
      return t("git.errors.pullFailed");
    case "GIT_REMOTE_FAILED":
      return t("git.errors.remoteFailed");
    case "COMMIT_VALIDATION_FAILED":
      return t("git.errors.commitValidationFailed");
    case "GIT_COMMAND_TIMEOUT":
      return t("git.errors.commandTimeout");
    default:
      return null;
  }
}
