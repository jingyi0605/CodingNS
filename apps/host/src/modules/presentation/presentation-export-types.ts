import type { TaskStatus } from "../tasks/task-types.js";

export interface PresentationPdfExportTaskDto {
  taskId: string;
  workspaceId: string;
  sourcePath: string;
  format: "pdf" | "pptx";
  status: TaskStatus;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  outputPath: string | null;
}
