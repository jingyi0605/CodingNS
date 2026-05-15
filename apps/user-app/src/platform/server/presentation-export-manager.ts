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
