import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import "../../../app/styles.css";
import { clientConfigStore } from "../../../config/client-config-store";
import { t } from "../../../shared/i18n";
import { ToastProvider } from "../../../shared/toast";
import type { FilePreviewDto } from "../api/file-context-api";
import { FileViewerModal, FileViewerPanel } from "./FileViewerModal";

const fileApiMock = vi.hoisted(() => ({
  getFilePreview: vi.fn(),
  saveFileContent: vi.fn()
}));
const presentationExportApiMock = vi.hoisted(() => ({
  createPresentationExportTask: vi.fn(),
  downloadPresentationExportTask: vi.fn(),
  getPresentationExportTask: vi.fn()
}));
const downloadAnchorClickMock = vi.hoisted(() => vi.fn());
const clipboardWriteTextMock = vi.hoisted(() => vi.fn());
const platformMock = vi.hoisted(() => ({
  openExternal: vi.fn(),
  writeClipboardText: vi.fn(),
  isDesktop: true,
  isMobile: false
}));
const resizeObserverState = vi.hoisted(() => ({
  callback: null as ResizeObserverCallback | null
}));

function getPresentationRunsEditor(): HTMLDivElement | null {
  return document.querySelector<HTMLDivElement>(".static-html-presentation-runs-editor");
}

function getPresentationRunWrappers(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".static-html-presentation-runs-editor [data-static-html-run-wrapper='true']")
  );
}

function getPresentationRunInputs(): HTMLTextAreaElement[] {
  return Array.from(
    document.querySelectorAll<HTMLTextAreaElement>(".static-html-presentation-runs-editor [data-static-html-run-input='true']")
  );
}

async function replaceSingleRunText(
  user: ReturnType<typeof userEvent.setup>,
  nextText: string,
  runIndex = 0
): Promise<void> {
  const input = getPresentationRunInputs()[runIndex];
  expect(input).toBeTruthy();
  await user.clear(input!);
  await user.type(input!, nextText);
}

vi.mock("../api/file-context-api", () => ({
  getFilePreview: fileApiMock.getFilePreview,
  saveFileContent: fileApiMock.saveFileContent
}));

vi.mock("../../../platform/server/presentation-export-manager", () => ({
  createPresentationExportTask: presentationExportApiMock.createPresentationExportTask,
  downloadPresentationExportTask: presentationExportApiMock.downloadPresentationExportTask,
  getPresentationExportTask: presentationExportApiMock.getPresentationExportTask
}));

vi.mock("../../../platform/platform-provider", () => ({
  usePlatform: () => ({
    isDesktop: platformMock.isDesktop,
    isMobile: platformMock.isMobile,
    bridge: {
      openExternal: platformMock.openExternal,
      writeClipboardText: platformMock.writeClipboardText
    }
  })
}));



describe("FileViewerModal office preview", () => {
  beforeEach(() => {
    platformMock.isDesktop = true;
    platformMock.isMobile = false;
    clientConfigStore.hydrate(createRuntimeConfigSnapshot("http://127.0.0.1:3002"));
    fileApiMock.getFilePreview.mockResolvedValue(createPreviewResponse());
    fileApiMock.saveFileContent.mockReset();
    presentationExportApiMock.createPresentationExportTask.mockReset();
    presentationExportApiMock.downloadPresentationExportTask.mockReset();
    presentationExportApiMock.downloadPresentationExportTask.mockResolvedValue({
      fileName: "export.pdf",
      blob: new Blob(["mock export"], {
        type: "application/octet-stream"
      })
    });
    presentationExportApiMock.getPresentationExportTask.mockReset();
    downloadAnchorClickMock.mockReset();
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:mock-export")
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(downloadAnchorClickMock);
    platformMock.openExternal.mockReset();
    platformMock.openExternal.mockResolvedValue({ ok: true });
    platformMock.writeClipboardText.mockReset();
    platformMock.writeClipboardText.mockResolvedValue({ ok: true });
    clipboardWriteTextMock.mockReset();
    clipboardWriteTextMock.mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock
      }
    });
    resizeObserverState.callback = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeObserverState.callback = callback;
        }

        observe() {
          return undefined;
        }

        disconnect() {
          return undefined;
        }
      }
    );
  });

  afterEach(() => {
    delete window.DocsAPI;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Office 文件会加载 ONLYOFFICE 预览器", async () => {
    const destroyEditor = vi.fn();
    const docEditor = vi.fn(() => ({
      destroyEditor
    }));
    window.DocsAPI = {
      DocEditor: docEditor
    };

    const script = document.createElement("script");
    script.dataset.onlyofficeSrc = "http://127.0.0.1:8088/web-apps/apps/api/documents/api.js";
    script.dataset.loaded = "true";
    document.head.appendChild(script);

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "docs/demo.docx",
        kind: "office",
        content: null,
        version: "doc-v1",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/docs/demo.docx",
        onlyOffice: {
          apiScriptUrl: "http://127.0.0.1:8088/web-apps/apps/api/documents/api.js",
          editorMode: "edit",
          documentUrl: "http://127.0.0.1:3002/preview/files/preview-token/docs/demo.docx",
          callbackUrl: "http://127.0.0.1:3002/api/office/onlyoffice/callback/mock-token",
          editorConfig: {
            documentType: "word",
            type: "desktop",
            document: {
              fileType: "docx",
              key: "doc-v1",
              title: "demo.docx",
              url: "http://127.0.0.1:3002/preview/files/preview-token/docs/demo.docx"
            },
            editorConfig: {
              callbackUrl: "http://127.0.0.1:3002/api/office/onlyoffice/callback/mock-token",
              mode: "edit",
              user: {
                id: "user-1",
                name: "tester",
                image: "https://example.com/avatar.png"
              },
              customization: {
                features: {
                  spellcheck: false
                },
                anonymous: {
                  request: false
                }
              }
            }
          }
        },
        capabilities: {
          canEdit: false,
          canRefresh: true,
          canResize: true,
          canZoom: false,
          canPaginate: false
        }
      })
    );

    render(
      <ToastProvider>
        <FileViewerModal
          workspaceId="workspace-1"
          filePath="docs/demo.docx"
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );

    expect(await screen.findByTestId("file-viewer-office-preview")).toBeInTheDocument();
    await waitFor(() => {
      expect(docEditor).toHaveBeenCalledTimes(1);
    });
    expect(docEditor).toHaveBeenCalledWith(
      expect.stringMatching(/^onlyoffice-/),
      expect.objectContaining({
        type: "desktop",
        editorConfig: expect.objectContaining({
          user: expect.objectContaining({
            id: "user-1",
            name: "tester",
            image: "https://example.com/avatar.png"
          }),
          customization: expect.objectContaining({
            features: expect.objectContaining({
              spellcheck: false
            }),
            anonymous: expect.objectContaining({
              request: false
            })
          })
        })
      })
    );
    expect(screen.getByRole("button", { name: t("conversation.fileViewerRefreshPreview") })).toBeInTheDocument();
  });

  it("阅读态 Office 预览会直接使用接口返回的 ONLYOFFICE 配置，不在前端改签名配置", async () => {
    const destroyEditor = vi.fn();
    const docEditor = vi.fn(() => ({
      destroyEditor
    }));
    window.DocsAPI = {
      DocEditor: docEditor
    };

    const script = document.createElement("script");
    script.dataset.onlyofficeSrc = "http://127.0.0.1:8088/web-apps/apps/api/documents/api.js";
    script.dataset.loaded = "true";
    document.head.appendChild(script);

    const readingConfig = {
      documentType: "word",
      type: "embedded",
      document: {
        fileType: "docx",
        key: "doc-v2",
        title: "reading.docx",
        url: "http://127.0.0.1:3002/preview/files/preview-token/docs/reading.docx",
        permissions: {
          edit: false,
          review: false,
          comment: false,
          download: true,
          print: true,
          copy: true
        }
      },
      editorConfig: {
        callbackUrl: "http://127.0.0.1:3002/api/office/onlyoffice/callback/mock-token",
        mode: "view",
        coEditing: {
          mode: "strict",
          change: false
        },
        customization: {
          features: {
            spellcheck: false
          },
          anonymous: {
            request: false
          }
        }
      },
      token: "mock-jwt"
    };

    fileApiMock.getFilePreview.mockResolvedValue(
      createPreviewResponse({
        path: "docs/reading.docx",
        kind: "office",
        content: null,
        version: "doc-v2",
        previewUrl: "http://127.0.0.1:3002/preview/files/preview-token/docs/reading.docx",
        onlyOffice: {
          apiScriptUrl: "http://127.0.0.1:8088/web-apps/apps/api/documents/api.js",
          editorMode: "view",
          documentUrl: "http://127.0.0.1:3002/preview/files/preview-token/docs/reading.docx",
          callbackUrl: "http://127.0.0.1:3002/api/office/onlyoffice/callback/mock-token",
          editorConfig: readingConfig
        },
        capabilities: {
          canEdit: false,
          canRefresh: true,
          canResize: true,
          canZoom: false,
          canPaginate: false
        }
      })
    );

    render(
      <ToastProvider>
        <FileViewerPanel
          workspaceId="workspace-1"
          filePath="docs/reading.docx"
          open
          chrome="inline"
          windowTitle="reading.docx"
          onClose={vi.fn()}
          onSaved={vi.fn()}
          officeDisplayMode="reading"
        />
      </ToastProvider>
    );

    expect(await screen.findByTestId("file-viewer-office-preview")).toBeInTheDocument();
    await waitFor(() => {
      expect(docEditor).toHaveBeenCalledTimes(1);
    });
    expect(docEditor).toHaveBeenCalledWith(expect.stringMatching(/^onlyoffice-/), readingConfig);
  });
});

function createPreviewResponse(overrides: Partial<FilePreviewDto> = {}): FilePreviewDto {
  return {
    workspaceId: "workspace-1",
    path: "notes.txt",
    supported: true,
    kind: "text",
    reason: null,
    content: "hello",
    version: "v1",
    size: 5,
    updatedAt: "2026-03-31T00:00:00.000Z",
    previewPath: null,
    previewUrl: null,
    onlyOffice: null,
    capabilities: {
      canEdit: true,
      canRefresh: true,
      canResize: true,
      canZoom: false,
      canPaginate: false
    },
    ...overrides
  };
}

function createRuntimeConfigSnapshot(baseUrl: string) {
  return {
    platform: "desktop" as const,
    activeHostId: "host-1",
    hosts: [
      {
        id: "host-1",
        name: "Host 1",
        baseUrl,
        kind: "lan" as const,
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z",
        lastConnectedAt: null,
        lastUserId: null,
        lastUsername: null
      }
    ],
    discoveredHosts: [],
    activeDiscoveredHostId: null,
    localHostDiscovery: {
      status: "idle" as const,
      lastScannedAt: null,
      cooldownUntil: null,
      errorCode: null,
      errorDetail: null
    },
    releaseChannel: "stable" as const,
    autoReconnect: true,
    autoCheckUpdate: true,
    language: "zh-CN" as const,
    defaultPermissionMode: "default" as const
  };
}
