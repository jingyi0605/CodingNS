const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit"
]);

export interface MacOsCopyShortcutFallbackOptions {
  window: Window;
  document: Document;
  writeClipboardText: (text: string) => Promise<boolean>;
}

function isTextInputElement(element: Element | null): element is HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) {
    return false;
  }

  return !NON_TEXT_INPUT_TYPES.has(element.type.toLowerCase());
}

function readSelectedTextFromEditableElement(document: Document): string | null {
  const activeElement = document.activeElement;

  if (isTextInputElement(activeElement) || activeElement instanceof HTMLTextAreaElement) {
    const selectionStart = activeElement.selectionStart ?? 0;
    const selectionEnd = activeElement.selectionEnd ?? selectionStart;

    if (selectionEnd <= selectionStart) {
      return null;
    }

    return activeElement.value.slice(selectionStart, selectionEnd);
  }

  return null;
}

export function readSelectedText(document: Document): string | null {
  const editableSelection = readSelectedTextFromEditableElement(document);

  if (editableSelection !== null) {
    return editableSelection;
  }

  const selection = document.getSelection();

  if (!selection || selection.isCollapsed) {
    return null;
  }

  const text = selection.toString();
  return text.length > 0 ? text : null;
}

function copyTextWithExecCommand(document: Document, text: string): boolean {
  const execCommand = document.execCommand?.bind(document);

  if (typeof execCommand !== "function") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  try {
    return execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

async function writeSelectedText(
  document: Document,
  text: string,
  writeClipboardText: (text: string) => Promise<boolean>
): Promise<void> {
  try {
    if (await writeClipboardText(text)) {
      return;
    }
  } catch {
    // Tauri 剪贴板失败时继续尝试浏览器回退，不把复制彻底做成死路。
  }

  const navigator = document.defaultView?.navigator;

  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 某些 WebView 会拒绝 clipboard API，继续走同步老回退。
    }
  }

  copyTextWithExecCommand(document, text);
}

export function installMacOsCopyShortcutFallback(
  options: MacOsCopyShortcutFallbackOptions
): () => void {
  const { window, document, writeClipboardText } = options;

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || !event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (event.key.toLowerCase() !== "c") {
      return;
    }

    const selectedText = readSelectedText(document);

    if (!selectedText) {
      return;
    }

    event.preventDefault();
    void writeSelectedText(document, selectedText, writeClipboardText);
  }

  window.addEventListener("keydown", handleKeyDown, true);

  return () => {
    window.removeEventListener("keydown", handleKeyDown, true);
  };
}
