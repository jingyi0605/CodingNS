import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { t } from "../../../shared/i18n";
import { ApiError } from "../../../shared/network/api-error";
import { useToast } from "../../../shared/toast";
import {
  getFilePreview,
  saveFileContent,
  type FilePreviewDto
} from "../api/file-context-api";

interface FileViewerModalProps {
  workspaceId: string | null | undefined;
  filePath: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: (filePath: string) => Promise<void> | void;
  diffContent?: string | null;
}

type ViewerMode = "preview" | "edit";
type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "keyword"
  | "number"
  | "operator"
  | "tag"
  | "attr"
  | "boolean"
  | "null";

interface CodeToken {
  text: string;
  kind: TokenKind;
}

const SCRIPT_KEYWORDS = new Set([
  "abstract",
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield"
]);

const PYTHON_KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "False",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "None",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "True",
  "try",
  "while",
  "with",
  "yield"
]);

const SHELL_KEYWORDS = new Set([
  "case",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "export",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "local",
  "readonly",
  "return",
  "then",
  "until",
  "while"
]);

const SQL_KEYWORDS = new Set([
  "add",
  "alter",
  "and",
  "as",
  "asc",
  "between",
  "by",
  "create",
  "delete",
  "desc",
  "drop",
  "from",
  "group",
  "having",
  "insert",
  "into",
  "join",
  "left",
  "like",
  "limit",
  "not",
  "null",
  "offset",
  "on",
  "or",
  "order",
  "right",
  "select",
  "set",
  "table",
  "union",
  "update",
  "values",
  "where"
]);

const DOCKERFILE_KEYWORDS = new Set([
  "add",
  "arg",
  "cmd",
  "copy",
  "entrypoint",
  "env",
  "expose",
  "from",
  "healthcheck",
  "label",
  "maintainer",
  "onbuild",
  "run",
  "shell",
  "stopsignal",
  "user",
  "volume",
  "workdir",
  "as"
]);

const LOG_LEVELS = new Set([
  "trace",
  "debug",
  "info",
  "warn",
  "warning",
  "error",
  "fatal"
]);

export function FileViewerModal({
  workspaceId,
  filePath,
  open,
  onClose,
  onSaved,
  diffContent
}: FileViewerModalProps) {
  const [preview, setPreview] = useState<FilePreviewDto | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<ViewerMode>("preview");
  const { showToast } = useToast();
  const onCloseRef = useRef(onClose);
  const showToastRef = useRef(showToast);

  const detectedLanguage = useMemo(() => detectLanguage(filePath), [filePath]);
  const isMarkdown = detectedLanguage === "markdown";
  const canEdit = Boolean(preview?.supported && preview.kind === "text");

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setEditorContent("");
      setLoading(false);
      setSaving(false);
      setMode("preview");
      return;
    }

    if (!workspaceId || !filePath) {
      return;
    }

    const safeWorkspaceId = workspaceId;
    const safeFilePath = filePath;
    let cancelled = false;

    async function loadPreview() {
      setLoading(true);

      try {
        const nextPreview = await getFilePreview(safeWorkspaceId, safeFilePath);

        if (!cancelled) {
          setPreview(nextPreview);
          setEditorContent(nextPreview.content ?? "");
          setMode(isMarkdownFile(safeFilePath) ? "preview" : "preview");
        }
      } catch (error) {
        if (!cancelled) {
          showToastRef.current({
            title: readError(error, t("conversation.filePanelOpenFailed")),
            tone: "error"
          });
          onCloseRef.current();
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [filePath, open, workspaceId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open || !filePath || typeof document === "undefined") {
    return null;
  }

  const safeFilePath = filePath;
  const safeWorkspaceId = workspaceId;

  async function handleSave() {
    if (!safeWorkspaceId || !preview?.version || !canEdit) {
      return;
    }

    setSaving(true);

    try {
      await saveFileContent(safeWorkspaceId, safeFilePath, editorContent, preview.version);
      const nextPreview = await getFilePreview(safeWorkspaceId, safeFilePath);
      setPreview(nextPreview);
      setEditorContent(nextPreview.content ?? "");
      await onSaved(safeFilePath);
      showToast({
        title: t("conversation.filePanelSaveSuccess"),
        tone: "success"
      });
      setMode(isMarkdown ? "preview" : "preview");
    } catch (error) {
      showToast({
        title: readError(error, t("conversation.filePanelSaveFailed")),
        tone: "error"
      });
    } finally {
      setSaving(false);
    }
  }

  const currentContent = preview?.content ?? "";
  const isDirty = canEdit && editorContent !== currentContent;

  return createPortal(
    <div className="workbench-modal-layer">
      <button
        type="button"
        className="workbench-modal-backdrop"
        aria-label={t("common.close")}
        onClick={onClose}
      />
      <section
        className="workbench-modal-card surface-card file-viewer-modal"
        role="dialog"
        aria-modal="true"
        aria-label={filePath}
      >
        <div className="workbench-modal-header">
          <div className="workbench-modal-title-wrap">
            <h2>{filePath}</h2>
            <p>{t("conversation.fileViewerHint").replace("{language}", formatLanguageLabel(detectedLanguage))}</p>
          </div>
          <button
            type="button"
            className="workbench-modal-close"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="file-viewer-toolbar">
          <div className="file-viewer-tabs" role="tablist" aria-label={t("conversation.fileViewerModeLabel")}>
            <button
              type="button"
              className="file-viewer-tab"
              data-active={mode === "preview"}
              role="tab"
              aria-selected={mode === "preview"}
              onClick={() => setMode("preview")}
            >
              {isMarkdown ? t("conversation.fileViewerPreview") : t("conversation.fileViewerCode")}
            </button>
            <button
              type="button"
              className="file-viewer-tab"
              data-active={mode === "edit"}
              role="tab"
              aria-selected={mode === "edit"}
              onClick={() => setMode("edit")}
              disabled={!canEdit}
            >
              {t("conversation.fileViewerEdit")}
            </button>
          </div>
          <div className="file-viewer-actions">
            <span className="file-viewer-language">{formatLanguageLabel(detectedLanguage)}</span>
            <button
              type="button"
              className="primary-button"
              onClick={() => void handleSave()}
              disabled={!isDirty || saving}
            >
              {saving ? t("conversation.filePanelSaving") : t("conversation.filePanelSave")}
            </button>
          </div>
        </div>

        <div className="workbench-modal-body file-viewer-body">
          {loading ? (
            <p className="status-text">{t("common.loading")}</p>
          ) : preview?.supported === false ? (
            <p className="status-text">{preview.reason ?? t("conversation.filePanelUnsupported")}</p>
          ) : diffContent ? (
            <DiffPreview content={diffContent} />
          ) : mode === "edit" ? (
            <textarea
              className="file-viewer-editor"
              data-testid="file-viewer-editor"
              value={editorContent}
              onChange={(event) => setEditorContent(event.target.value)}
              spellCheck={false}
            />
          ) : isMarkdown ? (
            <MarkdownPreview content={editorContent} />
          ) : (
            <CodePreview content={editorContent} language={detectedLanguage} />
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="markdown-content file-viewer-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const codeClassName = typeof props.className === "string" ? props.className : "";
            const match = /language-([\w-]+)/.exec(codeClassName);

            if (match) {
              return (
                <CodePreview
                  content={String(props.children).replace(/\n$/, "")}
                  language={normalizeLanguage(match[1] ?? "plain")}
                />
              );
            }

            return <code className={codeClassName || undefined}>{props.children}</code>;
          }
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}

function CodePreview({
  content,
  language
}: {
  content: string;
  language: string;
}) {
  const lines = content.split(/\r?\n/);

  return (
    <div className="file-viewer-code-block">
      <div className="file-viewer-code-header">{formatLanguageLabel(language)}</div>
      <div className="file-viewer-code-body">
        {lines.map((line, index) => {
          const tokens = tokenizeLine(line, language);

          return (
            <div key={`${index}-${line}`} className="file-viewer-code-line">
              <span className="file-viewer-code-gutter">{index + 1}</span>
              <code className="file-viewer-code-content">
                {tokens.length ? (
                  tokens.map((token, tokenIndex) => (
                    <span
                      key={`${index}-${tokenIndex}-${token.text}`}
                      className={`code-token ${token.kind}`}
                    >
                      {token.text}
                    </span>
                  ))
                ) : (
                  <span className="code-token plain"> </span>
                )}
              </code>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function tokenizeLine(line: string, language: string): CodeToken[] {
  const normalizedLanguage = normalizeLanguage(language);

  if (normalizedLanguage === "json") {
    return tokenizeJsonLine(line);
  }

  if (normalizedLanguage === "yaml") {
    return tokenizeYamlLine(line);
  }

  if (normalizedLanguage === "toml") {
    return tokenizeTomlLine(line);
  }

  if (normalizedLanguage === "ini") {
    return tokenizeIniLine(line);
  }

  if (normalizedLanguage === "env") {
    return tokenizeEnvLine(line);
  }

  if (normalizedLanguage === "properties") {
    return tokenizePropertiesLine(line);
  }

  if (normalizedLanguage === "conf") {
    return tokenizeConfLine(line);
  }

  if (normalizedLanguage === "editorconfig") {
    return tokenizeEditorConfigLine(line);
  }

  if (normalizedLanguage === "dockerfile") {
    return tokenizeDockerfileLine(line);
  }

  if (normalizedLanguage === "gitignore") {
    return tokenizeGitIgnoreLine(line);
  }

  if (normalizedLanguage === "log") {
    return tokenizeLogLine(line);
  }

  if (normalizedLanguage === "python") {
    return tokenizeWithWordSet(line, PYTHON_KEYWORDS, "#");
  }

  if (normalizedLanguage === "shell") {
    return tokenizeWithWordSet(line, SHELL_KEYWORDS, "#");
  }

  if (normalizedLanguage === "sql") {
    return tokenizeSqlLine(line);
  }

  if (normalizedLanguage === "html" || normalizedLanguage === "xml") {
    return tokenizeMarkupLine(line);
  }

  if (normalizedLanguage === "css") {
    return tokenizeCssLine(line);
  }

  if (normalizedLanguage === "markdown") {
    return [{ text: line, kind: "plain" }];
  }

  return tokenizeWithWordSet(line, SCRIPT_KEYWORDS, "//");
}

function tokenizeWithWordSet(line: string, keywords: ReadonlySet<string>, commentPrefix: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);

    if (rest.startsWith(commentPrefix)) {
      tokens.push({ text: rest, kind: "comment" });
      break;
    }

    const stringMatch = /^(?:'[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*"|`[^`\\]*(?:\\.[^`\\]*)*`)/.exec(rest);

    if (stringMatch) {
      tokens.push({ text: stringMatch[0], kind: "string" });
      index += stringMatch[0].length;
      continue;
    }

    const numberMatch = /^(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/.exec(rest);

    if (numberMatch) {
      tokens.push({ text: numberMatch[0], kind: "number" });
      index += numberMatch[0].length;
      continue;
    }

    const wordMatch = /^[A-Za-z_][\w$-]*/.exec(rest);

    if (wordMatch) {
      const word = wordMatch[0];
      const lowerWord = word.toLowerCase();

      if (word === "true" || word === "false" || lowerWord === "true" || lowerWord === "false") {
        tokens.push({ text: word, kind: "boolean" });
      } else if (word === "null" || word === "None" || lowerWord === "none") {
        tokens.push({ text: word, kind: "null" });
      } else if (keywords.has(word) || keywords.has(lowerWord)) {
        tokens.push({ text: word, kind: "keyword" });
      } else {
        tokens.push({ text: word, kind: "plain" });
      }

      index += word.length;
      continue;
    }

    const operatorMatch = /^(?:===|!==|==|!=|<=|>=|=>|&&|\|\||[+\-*/%=<>!?:|&^~]+)/.exec(rest);

    if (operatorMatch) {
      tokens.push({ text: operatorMatch[0], kind: "operator" });
      index += operatorMatch[0].length;
      continue;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function tokenizeJsonLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);
    const stringMatch = /^"(?:[^"\\]|\\.)*"/.exec(rest);

    if (stringMatch) {
      const nextChar = line.slice(index + stringMatch[0].length).trimStart()[0];
      tokens.push({
        text: stringMatch[0],
        kind: nextChar === ":" ? "attr" : "string"
      });
      index += stringMatch[0].length;
      continue;
    }

    const numberMatch = /^(?:-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(rest);

    if (numberMatch) {
      tokens.push({ text: numberMatch[0], kind: "number" });
      index += numberMatch[0].length;
      continue;
    }

    const literalMatch = /^(?:true|false|null)\b/.exec(rest);

    if (literalMatch) {
      const kind = literalMatch[0] === "null" ? "null" : "boolean";
      tokens.push({ text: literalMatch[0], kind });
      index += literalMatch[0].length;
      continue;
    }

    const operatorMatch = /^(?::|,|\{|\}|\[|\])/.exec(rest);

    if (operatorMatch) {
      tokens.push({ text: operatorMatch[0], kind: "operator" });
      index += operatorMatch[0].length;
      continue;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function tokenizeMarkupLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);

    if (rest.startsWith("<!--")) {
      tokens.push({ text: rest, kind: "comment" });
      break;
    }

    const tagMatch = /^(<\/?[\w:-]+)/.exec(rest);

    if (tagMatch) {
      tokens.push({ text: tagMatch[0], kind: "tag" });
      index += tagMatch[0].length;
      continue;
    }

    const attrMatch = /^([\w:-]+)(=)/.exec(rest);

    if (attrMatch) {
      tokens.push({ text: attrMatch[1] ?? "", kind: "attr" });
      tokens.push({ text: attrMatch[2] ?? "", kind: "operator" });
      index += attrMatch[0].length;
      continue;
    }

    const stringMatch = /^(?:'[^']*'|"[^"]*")/.exec(rest);

    if (stringMatch) {
      tokens.push({ text: stringMatch[0], kind: "string" });
      index += stringMatch[0].length;
      continue;
    }

    const operatorMatch = /^(?:\/?>)/.exec(rest);

    if (operatorMatch) {
      tokens.push({ text: operatorMatch[0], kind: "operator" });
      index += operatorMatch[0].length;
      continue;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function tokenizeCssLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);

    if (rest.startsWith("/*")) {
      tokens.push({ text: rest, kind: "comment" });
      break;
    }

    const stringMatch = /^(?:'[^']*'|"[^"]*")/.exec(rest);

    if (stringMatch) {
      tokens.push({ text: stringMatch[0], kind: "string" });
      index += stringMatch[0].length;
      continue;
    }

    const attrMatch = /^([A-Za-z-]+)(\s*:)/.exec(rest);

    if (attrMatch) {
      tokens.push({ text: attrMatch[1] ?? "", kind: "attr" });
      tokens.push({ text: attrMatch[2] ?? "", kind: "operator" });
      index += attrMatch[0].length;
      continue;
    }

    const numberMatch = /^(?:#(?:[\da-fA-F]{3,8})|\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)?)/.exec(rest);

    if (numberMatch) {
      tokens.push({ text: numberMatch[0], kind: "number" });
      index += numberMatch[0].length;
      continue;
    }

    const keywordMatch = /^(?:@media|@supports|@import|@keyframes)\b/.exec(rest);

    if (keywordMatch) {
      tokens.push({ text: keywordMatch[0], kind: "keyword" });
      index += keywordMatch[0].length;
      continue;
    }

    const operatorMatch = /^(?:[{}:;(),.>])/.exec(rest);

    if (operatorMatch) {
      tokens.push({ text: operatorMatch[0], kind: "operator" });
      index += operatorMatch[0].length;
      continue;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function tokenizeSqlLine(line: string): CodeToken[] {
  return tokenizeWithWordSet(line, SQL_KEYWORDS, "--");
}

function tokenizeYamlLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);

    if (rest.startsWith("#")) {
      tokens.push({ text: rest, kind: "comment" });
      break;
    }

    const keyMatch = /^([A-Za-z0-9_.-]+)(\s*:)/.exec(rest);

    if (keyMatch) {
      tokens.push({ text: keyMatch[1] ?? "", kind: "attr" });
      tokens.push({ text: keyMatch[2] ?? "", kind: "operator" });
      index += keyMatch[0].length;
      continue;
    }

    const stringMatch = /^(?:'[^']*'|"[^"]*")/.exec(rest);

    if (stringMatch) {
      tokens.push({ text: stringMatch[0], kind: "string" });
      index += stringMatch[0].length;
      continue;
    }

    const numberMatch = /^(?:-?\d+(?:\.\d+)?)/.exec(rest);

    if (numberMatch) {
      tokens.push({ text: numberMatch[0], kind: "number" });
      index += numberMatch[0].length;
      continue;
    }

    const literalMatch = /^(?:true|false|yes|no|null|~)\b/i.exec(rest);

    if (literalMatch) {
      const lowerLiteral = literalMatch[0].toLowerCase();
      const kind: TokenKind =
        lowerLiteral === "null" || lowerLiteral === "~" ? "null" : "boolean";
      tokens.push({ text: literalMatch[0], kind });
      index += literalMatch[0].length;
      continue;
    }

    const operatorMatch = /^(?:[-?:,[\]{}|>])/.exec(rest);

    if (operatorMatch) {
      tokens.push({ text: operatorMatch[0], kind: "operator" });
      index += operatorMatch[0].length;
      continue;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function tokenizeTomlLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);

    if (rest.startsWith("#")) {
      tokens.push({ text: rest, kind: "comment" });
      break;
    }

    const sectionMatch = /^(\[\[?[^\]]+\]?\])/.exec(rest);

    if (sectionMatch) {
      tokens.push({ text: sectionMatch[0], kind: "tag" });
      index += sectionMatch[0].length;
      continue;
    }

    const keyMatch = /^([A-Za-z0-9_.-]+)(\s*=)/.exec(rest);

    if (keyMatch) {
      tokens.push({ text: keyMatch[1] ?? "", kind: "attr" });
      tokens.push({ text: keyMatch[2] ?? "", kind: "operator" });
      index += keyMatch[0].length;
      continue;
    }

    const valueTokens = readConfigScalar(rest, {
      trueValues: ["true"],
      falseValues: ["false"],
      nullValues: []
    });

    if (valueTokens) {
      tokens.push(...valueTokens.tokens);
      index += valueTokens.length;
      continue;
    }

    const operatorMatch = /^(?:[,[\]{}])/.exec(rest);

    if (operatorMatch) {
      tokens.push({ text: operatorMatch[0], kind: "operator" });
      index += operatorMatch[0].length;
      continue;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function tokenizeIniLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);
    const trimmedRest = rest.trimStart();

    if (trimmedRest.startsWith(";") || trimmedRest.startsWith("#")) {
      tokens.push({ text: rest, kind: "comment" });
      break;
    }

    const sectionMatch = /^(\[[^\]]+\])/.exec(rest);

    if (sectionMatch) {
      tokens.push({ text: sectionMatch[0], kind: "tag" });
      index += sectionMatch[0].length;
      continue;
    }

    const keyMatch = /^([A-Za-z0-9_.-]+)(\s*[=:])/.exec(rest);

    if (keyMatch) {
      tokens.push({ text: keyMatch[1] ?? "", kind: "attr" });
      tokens.push({ text: keyMatch[2] ?? "", kind: "operator" });
      index += keyMatch[0].length;
      continue;
    }

    const valueTokens = readConfigScalar(rest, {
      trueValues: ["true", "yes", "on"],
      falseValues: ["false", "no", "off"],
      nullValues: ["null"]
    });

    if (valueTokens) {
      tokens.push(...valueTokens.tokens);
      index += valueTokens.length;
      continue;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function tokenizeEnvLine(line: string): CodeToken[] {
  const trimmedLine = line.trimStart();

  if (trimmedLine.startsWith("#")) {
    return [{ text: line, kind: "comment" }];
  }

  const exportMatch = /^(\s*)(export)(\s+)/.exec(line);
  const keyStart = exportMatch ? exportMatch[0].length : 0;
  const tokens: CodeToken[] = [];

  if (exportMatch) {
    tokens.push({ text: exportMatch[1] ?? "", kind: "plain" });
    tokens.push({ text: exportMatch[2] ?? "", kind: "keyword" });
    tokens.push({ text: exportMatch[3] ?? "", kind: "plain" });
  }

  const rest = line.slice(keyStart);
  const keyMatch = /^([A-Za-z_][A-Za-z0-9_]*)(=)/.exec(rest);

  if (!keyMatch) {
    return tokenizeIniLine(line);
  }

  tokens.push({ text: keyMatch[1] ?? "", kind: "attr" });
  tokens.push({ text: keyMatch[2] ?? "", kind: "operator" });

  const valueText = rest.slice(keyMatch[0].length);
  const valueTokens = readConfigScalar(valueText, {
    trueValues: ["true"],
    falseValues: ["false"],
    nullValues: ["null"]
  });

  if (valueTokens) {
    tokens.push(...valueTokens.tokens);
    return tokens;
  }

  tokens.push({ text: valueText, kind: "plain" });
  return tokens;
}

function tokenizePropertiesLine(line: string): CodeToken[] {
  return tokenizeConfigEntryLine(line, {
    commentPrefixes: ["#", "!"],
    allowSection: false,
    delimiters: ["=", ":"]
  });
}

function tokenizeConfLine(line: string): CodeToken[] {
  return tokenizeConfigEntryLine(line, {
    commentPrefixes: ["#", ";"],
    allowSection: true,
    delimiters: ["=", ":"]
  });
}

function tokenizeEditorConfigLine(line: string): CodeToken[] {
  return tokenizeConfigEntryLine(line, {
    commentPrefixes: ["#", ";"],
    allowSection: true,
    delimiters: ["="]
  });
}

function tokenizeDockerfileLine(line: string): CodeToken[] {
  return tokenizeWithWordSet(line, DOCKERFILE_KEYWORDS, "#");
}

function tokenizeGitIgnoreLine(line: string): CodeToken[] {
  const trimmedLine = line.trimStart();

  if (!trimmedLine) {
    return [];
  }

  if (trimmedLine.startsWith("#")) {
    return [{ text: line, kind: "comment" }];
  }

  if (trimmedLine.startsWith("!")) {
    const leadingWhitespaceLength = line.length - trimmedLine.length;
    const leadingWhitespace = line.slice(0, leadingWhitespaceLength);
    const pattern = trimmedLine.slice(1);

    return [
      { text: leadingWhitespace, kind: "plain" },
      { text: "!", kind: "operator" },
      { text: pattern, kind: "string" }
    ];
  }

  return [{ text: line, kind: "string" }];
}

function tokenizeLogLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);

    if (rest.startsWith("#")) {
      tokens.push({ text: rest, kind: "comment" });
      break;
    }

    const timestampMatch =
      /^(?:\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{3,6})?(?:Z|[+-]\d{2}:\d{2})?)/.exec(rest);

    if (timestampMatch) {
      tokens.push({ text: timestampMatch[0], kind: "tag" });
      index += timestampMatch[0].length;
      continue;
    }

    const bracketLevelMatch = /^(?:\[(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\])/.exec(rest);

    if (bracketLevelMatch) {
      tokens.push({ text: rest.slice(0, bracketLevelMatch[0].length), kind: "keyword" });
      index += bracketLevelMatch[0].length;
      continue;
    }

    const wordMatch = /^[A-Za-z_][\w-]*/.exec(rest);

    if (wordMatch) {
      const word = wordMatch[0];

      if (LOG_LEVELS.has(word.toLowerCase())) {
        tokens.push({ text: word, kind: "keyword" });
      } else {
        tokens.push({ text: word, kind: "plain" });
      }

      index += word.length;
      continue;
    }

    const numberMatch = /^(?:\d+(?:\.\d+)?)/.exec(rest);

    if (numberMatch) {
      tokens.push({ text: numberMatch[0], kind: "number" });
      index += numberMatch[0].length;
      continue;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function tokenizeConfigEntryLine(
  line: string,
  options: {
    commentPrefixes: string[];
    allowSection: boolean;
    delimiters: string[];
  }
): CodeToken[] {
  const trimmedLine = line.trimStart();

  if (options.commentPrefixes.some((prefix) => trimmedLine.startsWith(prefix))) {
    return [{ text: line, kind: "comment" }];
  }

  if (options.allowSection) {
    const sectionMatch = /^(\[[^\]]+\])/.exec(line);

    if (sectionMatch) {
      return [{ text: sectionMatch[0], kind: "tag" }];
    }
  }

  const keyMatch = /^([A-Za-z0-9_.\-*?]+)(\s*(?:=|:))/.exec(line);

  if (!keyMatch) {
    return [{ text: line, kind: "plain" }];
  }

  const delimiter = (keyMatch[2] ?? "").trim();

  if (!options.delimiters.includes(delimiter)) {
    return [{ text: line, kind: "plain" }];
  }

  const tokens: CodeToken[] = [
    { text: keyMatch[1] ?? "", kind: "attr" },
    { text: keyMatch[2] ?? "", kind: "operator" }
  ];
  const valueText = line.slice(keyMatch[0].length);
  const valueTokens = tokenizeConfigValue(valueText);

  if (valueTokens.length) {
    tokens.push(...valueTokens);
  }

  return tokens;
}

function tokenizeConfigValue(text: string): CodeToken[] {
  if (!text) {
    return [];
  }

  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < text.length) {
    const rest = text.slice(index);
    const valueTokens = readConfigScalar(rest, {
      trueValues: ["true", "yes", "on"],
      falseValues: ["false", "no", "off"],
      nullValues: ["null"]
    });

    if (valueTokens) {
      tokens.push(...valueTokens.tokens);
      index += valueTokens.length;
      continue;
    }

    if (rest.startsWith("#") || rest.startsWith(";")) {
      tokens.push({ text: rest, kind: "comment" });
      break;
    }

    tokens.push({ text: rest[0] ?? "", kind: "plain" });
    index += 1;
  }

  return tokens;
}

function readConfigScalar(
  text: string,
  literals: {
    trueValues: string[];
    falseValues: string[];
    nullValues: string[];
  }
): { tokens: CodeToken[]; length: number } | null {
  const stringMatch = /^(?:'[^']*'|"[^"]*")/.exec(text);

  if (stringMatch) {
    return {
      tokens: [{ text: stringMatch[0], kind: "string" }],
      length: stringMatch[0].length
    };
  }

  const numberMatch = /^(?:-?\d+(?:\.\d+)?)/.exec(text);

  if (numberMatch) {
    return {
      tokens: [{ text: numberMatch[0], kind: "number" }],
      length: numberMatch[0].length
    };
  }

  const wordMatch = /^[A-Za-z0-9_.:+/-]+/.exec(text);

  if (!wordMatch) {
    return null;
  }

  const word = wordMatch[0];
  const lowerWord = word.toLowerCase();

  if (literals.trueValues.includes(lowerWord)) {
    return {
      tokens: [{ text: word, kind: "boolean" }],
      length: word.length
    };
  }

  if (literals.falseValues.includes(lowerWord)) {
    return {
      tokens: [{ text: word, kind: "boolean" }],
      length: word.length
    };
  }

  if (literals.nullValues.includes(lowerWord)) {
    return {
      tokens: [{ text: word, kind: "null" }],
      length: word.length
    };
  }

  return {
    tokens: [{ text: word, kind: "plain" }],
    length: word.length
  };
}

function detectLanguage(filePath: string | null): string {
  if (!filePath) {
    return "plain";
  }

  const fileName = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? "";

  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return "env";
  }

  if (fileName === ".editorconfig") {
    return "editorconfig";
  }

  if (fileName === "dockerfile" || fileName.endsWith(".dockerfile")) {
    return "dockerfile";
  }

  if (fileName === ".gitignore") {
    return "gitignore";
  }

  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";

  switch (extension) {
    case "md":
    case "markdown":
      return "markdown";
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
      return "json";
    case "log":
      return "log";
    case "properties":
      return "properties";
    case "toml":
      return "toml";
    case "ini":
      return "ini";
    case "conf":
      return "conf";
    case "dockerfile":
      return "dockerfile";
    case "css":
    case "scss":
    case "less":
      return "css";
    case "html":
    case "htm":
      return "html";
    case "xml":
    case "svg":
      return "xml";
    case "py":
      return "python";
    case "sh":
    case "bash":
    case "zsh":
      return "shell";
    case "sql":
      return "sql";
    case "yml":
    case "yaml":
      return "yaml";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "java":
      return "java";
    case "c":
    case "h":
    case "cpp":
    case "cc":
    case "hpp":
      return "cpp";
    default:
      return "plain";
  }
}

function normalizeLanguage(language: string): string {
  const lowerLanguage = language.toLowerCase();

  switch (lowerLanguage) {
    case "ts":
    case "tsx":
    case "typescript":
      return "typescript";
    case "js":
    case "jsx":
    case "javascript":
      return "javascript";
    case "bash":
    case "shell":
    case "sh":
    case "zsh":
      return "shell";
    case "md":
    case "markdown":
      return "markdown";
    case "properties":
      return "properties";
    case "toml":
      return "toml";
    case "ini":
      return "ini";
    case "env":
      return "env";
    case "conf":
      return "conf";
    case "editorconfig":
      return "editorconfig";
    case "dockerfile":
      return "dockerfile";
    case "gitignore":
      return "gitignore";
    case "log":
      return "log";
    default:
      return lowerLanguage;
  }
}

function formatLanguageLabel(language: string): string {
  const normalizedLanguage = normalizeLanguage(language);

  switch (normalizedLanguage) {
    case "typescript":
      return "TypeScript";
    case "javascript":
      return "JavaScript";
    case "markdown":
      return "Markdown";
    case "json":
      return "JSON";
    case "properties":
      return "Properties";
    case "toml":
      return "TOML";
    case "ini":
      return "INI";
    case "env":
      return "ENV";
    case "conf":
      return "CONF";
    case "editorconfig":
      return "EditorConfig";
    case "dockerfile":
      return "Dockerfile";
    case "gitignore":
      return "GitIgnore";
    case "log":
      return "Log";
    case "css":
      return "CSS";
    case "html":
      return "HTML";
    case "xml":
      return "XML";
    case "python":
      return "Python";
    case "shell":
      return "Shell";
    case "sql":
      return "SQL";
    case "yaml":
      return "YAML";
    case "rust":
      return "Rust";
    case "go":
      return "Go";
    case "java":
      return "Java";
    case "cpp":
      return "C/C++";
    default:
      return t("conversation.fileViewerPlainText");
  }
}

function isMarkdownFile(filePath: string) {
  return detectLanguage(filePath) === "markdown";
}

function readError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return fallback;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ==================== Git Diff 解析与渲染 ====================

interface GitDiffLine {
  kind: "context" | "add" | "remove" | "hunk" | "meta";
  text: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

function parseGitDiffContent(content: string): GitDiffLine[] {
  const lines: GitDiffLine[] = [];
  const rawLines = content.replace(/\r\n/g, "\n").split("\n");
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of rawLines) {
    // diff header lines
    if (rawLine.startsWith("diff --git") || rawLine.startsWith("index ") || rawLine.startsWith("--- ") || rawLine.startsWith("+++ ")) {
      lines.push({ kind: "meta", text: rawLine, oldLineNo: null, newLineNo: null });
      continue;
    }

    // hunk header
    const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      lines.push({ kind: "hunk", text: rawLine, oldLineNo: null, newLineNo: null });
      continue;
    }

    // context line
    if (rawLine.startsWith(" ") || rawLine === "") {
      lines.push({ kind: "context", text: rawLine.slice(1), oldLineNo: oldLine, newLineNo: newLine });
      oldLine++;
      newLine++;
      continue;
    }

    // added line
    if (rawLine.startsWith("+")) {
      lines.push({ kind: "add", text: rawLine.slice(1), oldLineNo: null, newLineNo: newLine });
      newLine++;
      continue;
    }

    // removed line
    if (rawLine.startsWith("-")) {
      lines.push({ kind: "remove", text: rawLine.slice(1), oldLineNo: oldLine, newLineNo: null });
      oldLine++;
      continue;
    }

    // 其他行（如 No newline at end of file）
    lines.push({ kind: "meta", text: rawLine, oldLineNo: null, newLineNo: null });
  }

  return lines;
}

function DiffPreview({ content }: { content: string }) {
  const lines = useMemo(() => parseGitDiffContent(content), [content]);
  const totalLines = lines.length;

  // 收集变更行用于滚动条标识
  const changeMarkers = useMemo(() => {
    const markers: Array<{ index: number; kind: "add" | "remove" | "hunk" }> = [];
    lines.forEach((line, index) => {
      if (line.kind === "add" || line.kind === "remove" || line.kind === "hunk") {
        markers.push({ index, kind: line.kind });
      }
    });
    return markers;
  }, [lines]);

  const bodyRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="file-viewer-diff-shell">
      <div className="file-viewer-diff-body" ref={bodyRef}>
        {lines.map((line, index) => (
          <div key={`${index}-${line.kind}`} className={`file-viewer-diff-line is-${line.kind}`}>
            <span className="file-viewer-diff-old-no">{line.oldLineNo ?? ""}</span>
            <span className="file-viewer-diff-new-no">{line.newLineNo ?? ""}</span>
            <code className="file-viewer-diff-text">{line.text || " "}</code>
          </div>
        ))}
      </div>
      {totalLines > 0 ? (
        <DiffOverviewRuler markers={changeMarkers} totalLines={totalLines} scrollBodyRef={bodyRef} />
      ) : null}
    </div>
  );
}

function DiffOverviewRuler({
  markers,
  totalLines,
  scrollBodyRef
}: {
  markers: Array<{ index: number; kind: "add" | "remove" | "hunk" }>;
  totalLines: number;
  scrollBodyRef: React.RefObject<HTMLDivElement | null>;
}) {
  const rulerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const body = scrollBodyRef.current;
    const ruler = rulerRef.current;
    if (!body || !ruler) return;

    function handleScroll() {
      if (!body || !ruler) return;
      ruler.style.top = `${-(body.scrollTop / body.scrollHeight) * ruler.parentElement!.offsetHeight}px`;
    }

    body.addEventListener("scroll", handleScroll, { passive: true });
    return () => body.removeEventListener("scroll", handleScroll);
  }, [scrollBodyRef]);

  return (
    <div className="diff-overview-ruler" ref={rulerRef}>
      {markers.map((marker, i) => {
        const top = (marker.index / totalLines) * 100;
        const height = Math.max(1, (1 / totalLines) * 100);
        return (
          <div
            key={i}
            className={`diff-overview-marker is-${marker.kind}`}
            style={{ top: `${top}%`, height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}
