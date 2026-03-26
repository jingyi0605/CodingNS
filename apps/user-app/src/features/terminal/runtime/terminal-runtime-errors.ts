import { ApiError } from "../../../shared/network/api-error";

export function isTmuxDependencyMissingError(error: unknown): error is ApiError {
  if (!(error instanceof ApiError)) {
    return false;
  }

  return (
    error.errorCode === "RUNTIME_DEPENDENCY_MISSING" ||
    error.message.includes("当前系统未安装 tmux")
  );
}
