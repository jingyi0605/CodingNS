import { httpClient } from "../../network/http-client";

export type PresentationExportTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timeout";

export interface PresentationExportTaskInfo {
  taskId: string;
  workspaceId: string;
  sourcePath: string;
  format: "pdf" | "pptx";
  status: PresentationExportTaskStatus;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  outputPath: string | null;
}

export interface PresentationExportDownload {
  fileName: string;
  blob: Blob;
}

export async function createPresentationExportTask(input: {
  workspaceId: string;
  path: string;
  htmlContent: string;
  format: "pdf" | "pptx";
}): Promise<PresentationExportTaskInfo> {
  return await httpClient.request<PresentationExportTaskInfo>("/api/presentation-exports", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getPresentationExportTask(taskId: string): Promise<PresentationExportTaskInfo> {
  return await httpClient.request<PresentationExportTaskInfo>(
    `/api/presentation-exports/${encodeURIComponent(taskId)}`
  );
}

export async function downloadPresentationExportTask(taskId: string): Promise<PresentationExportDownload> {
  const path = `/api/presentation-exports/${encodeURIComponent(taskId)}/download`;
  const response = await httpClient.requestRaw(path);
  const blob = await response.blob();

  return {
    fileName: resolvePresentationExportFileName(
      taskId,
      blob.type,
      response.headers.get("Content-Disposition")
    ),
    blob
  };
}

function resolvePresentationExportFileName(
  taskId: string,
  contentType: string,
  contentDisposition: string | null
): string {
  const dispositionFileName = parseContentDispositionFileName(contentDisposition);

  if (dispositionFileName) {
    return dispositionFileName;
  }

  if (contentType === "application/pdf") {
    return `${taskId}.pdf`;
  }

  if (contentType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return `${taskId}.pptx`;
  }

  return taskId;
}

function parseContentDispositionFileName(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const encodedMatched = /filename\*=UTF-8''([^;]+)/i.exec(value);

  if (encodedMatched?.[1]) {
    return decodeURIComponent(encodedMatched[1]);
  }

  const matched = /filename="([^"]+)"/i.exec(value) ?? /filename=([^;]+)/i.exec(value);
  const rawFileName = matched?.[1]?.trim();

  if (!rawFileName) {
    return null;
  }

  return decodeURIComponent(rawFileName.replace(/^"|"$/g, ""));
}
