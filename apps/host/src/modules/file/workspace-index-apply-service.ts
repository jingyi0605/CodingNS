import { AppError } from "../../shared/errors/app-error.js";
import { runAffairsIndexerCommand, type AffairsIndexerCommandResult } from "../affairs-indexer/internal-command-runner.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";

interface WorkspaceIndexApplyLogger {
  info(bindings: Record<string, unknown>, message: string): void;
}

export interface WorkspaceIndexApplyResult {
  ok: true;
  workspaceId: string;
  workspacePath: string;
  durationMs: number;
  command: string[];
  result: AffairsIndexerCommandResult["result"];
  message: string;
}

/**
 * 这里只开放一个极窄能力：对当前 workspace 执行内置文档索引 apply-config。
 * 不再依赖外部 CLI 目录。
 */
export class WorkspaceIndexApplyService {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly logger: WorkspaceIndexApplyLogger
  ) {}

  async applyConfig(workspaceId: string): Promise<WorkspaceIndexApplyResult> {
    const workspace = this.workspaceService.getWorkspaceOrThrow(workspaceId);

    if (!workspace.path?.trim()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "WORKSPACE_PATH_REQUIRED",
        detail: "当前工作区路径不能为空"
      });
    }

    const startedAt = Date.now();
    const commandResult = await runAffairsIndexerCommand(workspace.path, "apply-config");

    this.logger.info(
      {
        workspaceId,
        workspacePath: workspace.path,
        durationMs: commandResult.durationMs,
        operation: "workspace_bridge.apply_index_config"
      },
      "静态 HTML 预览通过受控桥接执行内置 apply-config"
    );

    return {
      ok: true,
      workspaceId,
      workspacePath: workspace.path,
      durationMs: Date.now() - startedAt,
      command: ["internal", "apply-config", workspace.path],
      result: commandResult.result,
      message: commandResult.message
    };
  }
}
