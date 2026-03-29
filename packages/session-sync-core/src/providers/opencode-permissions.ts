export function createOpenCodeMessagePermissionOptions(
  permissionMode: string | null | undefined
): Record<string, never> {
  // OpenCode server 当前没有单条消息级别的 permissionMode/sandbox/approval 覆盖能力。
  // 这里显式保留一个策略入口，统一约定为“始终跟随当前 OpenCode server / 项目配置”，
  // 避免后续有人误以为可以像 Codex / Claude Code 一样在请求体里硬塞权限字段。
  void permissionMode;
  return {};
}
