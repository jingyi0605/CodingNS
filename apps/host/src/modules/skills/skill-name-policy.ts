const RESERVED_ASSISTANT_SKILL_NAMES = new Set([
  "codingns-assistant"
]);

export function isReservedAssistantSkillDirectoryName(directoryName: string): boolean {
  return RESERVED_ASSISTANT_SKILL_NAMES.has(directoryName.trim());
}

export function getReservedAssistantSkillErrorDetail(directoryName: string): string {
  return `目录名保留给助手专用运行时资产，不能作为公共 skill 管理：${directoryName}`;
}
