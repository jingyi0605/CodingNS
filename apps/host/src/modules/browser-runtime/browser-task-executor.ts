import type { BrowserProfile, OfficeArtifact, OfficeReceipt, OfficeTask, OfficeTaskStep } from "../../types/domain.js";
import type { TaskRunContext } from "../tasks/task-types.js";
import type { BrowserExecutionBackend, BrowserTaskAction } from "./browser-task-payload.js";

export interface ExecuteBrowserTaskInput {
  task: OfficeTask;
  profile: BrowserProfile;
  runContext?: TaskRunContext;
}

export interface BrowserExecutionResult {
  task: OfficeTask;
  receipt: OfficeReceipt;
  stepResults: BrowserStepResult[];
}

export interface BrowserStepResult {
  step: OfficeTaskStep;
  artifactIds: string[];
  outputJson: string;
}

export interface BrowserTaskExecutor {
  readonly backend: BrowserExecutionBackend;

  execute(input: ExecuteBrowserTaskInput): Promise<BrowserExecutionResult>;
}

export interface BrowserTaskExecutionReceiptPayload {
  executionBackend: BrowserExecutionBackend;
  stepCount: number;
  finalUrl: string | null;
  artifactCount: number;
}

export interface BrowserTaskArtifactInput {
  kind: OfficeArtifact["kind"];
  fileName: string;
  contentType: string | null;
}

export interface BrowserTaskStepLifecyclePort {
  markTaskRunning(task: OfficeTask): OfficeTask;
  markTaskSucceeded(task: OfficeTask, payload: BrowserTaskExecutionReceiptPayload): {
    task: OfficeTask;
    receipt: OfficeReceipt;
  };
  markTaskFailed(task: OfficeTask, reason: string): OfficeTask;
  createStep(task: OfficeTask, stepSeq: number, action: BrowserTaskAction): OfficeTaskStep;
  startStep(step: OfficeTaskStep): OfficeTaskStep;
  finishStep(step: OfficeTaskStep, outputJson: string): OfficeTaskStep;
  failStep(step: OfficeTaskStep, errorMessage: string): OfficeTaskStep;
  createTextArtifact(
    task: OfficeTask,
    step: OfficeTaskStep,
    input: BrowserTaskArtifactInput & { content: string }
  ): OfficeArtifact;
  createBinaryArtifact(
    task: OfficeTask,
    step: OfficeTaskStep,
    input: BrowserTaskArtifactInput & { content: Buffer }
  ): OfficeArtifact;
  createFileArtifact(
    task: OfficeTask,
    step: OfficeTaskStep,
    input: BrowserTaskArtifactInput & {
      sourceFilePath: string;
      metadata?: Record<string, unknown>;
    }
  ): OfficeArtifact;
}
