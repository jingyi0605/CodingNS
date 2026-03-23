import { zhCN } from "../../i18n/zh-CN";

type DictionaryValue = string | Record<string, unknown>;

const extensionZhCN = {
  home: {
    terminalsEntry: "终端",
    homeBadge: "主界面",
    dashboardTitle: "左边选工作区和会话，右边放辅助能力",
    dashboardSubtitle: "登录后直接进入工作台，不再绕去那个空白首页。",
    resumeLatestSession: "继续最近会话",
    workspaceGuide: "左侧已经按工作区把会话分组列出来，主内容区只保留当前操作。",
    sessionGuide: "最近的会话会优先显示在这里，也可以直接从左侧列表进入。",
    emptySessionsTitle: "还没有可继续的会话",
    quickOverviewTitle: "当前工作台",
    quickOverviewBody: "左侧负责导航，中央负责当前任务，右侧只放辅助信息。",
    nextStepTitle: "下一步",
    nextStepBody: "直接从左侧点一个会话；如果要跑命令，就进终端页。",
    auxiliarySubtitle: "这里放工作台的简要说明，真正的导航在左边。"
  },
  shell: {
    title: "工作台",
    subtitle: "工作区和会话常驻左侧，别再做成空白首页。",
    homeEntry: "会话工作台",
    workspaceCount: "工作区",
    sessionCount: "会话",
    importWorkspaceTitle: "导入工作区",
    importWorkspaceHint: "只导入一次，记录会保存在 Host 里，下次打开会直接看到。",
    importExpand: "展开导入",
    importCollapse: "收起导入",
    importPathLabel: "工作区路径",
    importPathPlaceholder: "例如 C:/Code/CodingNS",
    importNameLabel: "显示名称",
    importNamePlaceholder: "可选，不填就用目录名",
    importSubmit: "导入工作区",
    importSubmitting: "导入中",
    importPathRequired: "先填写工作区路径。",
    importSuccess: "工作区已导入：",
    importFailed: "导入工作区失败。",
    refreshNavigation: "刷新列表",
    navigationLoadFailed: "工作区或会话列表暂时没有加载回来。",
    emptyNavigationTitle: "还没有工作区",
    emptyNavigationBody: "先在 Host 侧导入工作区，这里才会出现会话入口。",
    emptyWorkspaceSessions: "这里还没有原生会话。",
    startClaude: "新建 Claude 会话",
    startCodex: "新建 Codex 会话",
    startingSession: "创建中",
    startClaudeSuccess: "Claude 会话已创建。",
    startCodexSuccess: "Codex 会话已创建。",
    startSessionFailed: "新建会话失败。",
    auxiliaryTitle: "辅助栏",
    auxiliarySubtitle: "这里放文件、Git 和状态信息，主操作留在中间。",
    expandAuxiliary: "展开",
    collapseAuxiliary: "收起",
    auxiliaryEmptyTitle: "当前没有辅助内容",
    auxiliaryEmptyBody: "进入具体会话后，这里会显示文件上下文和 Git 操作。"
  },
  conversation: {
    auxiliarySubtitle: "这里保留文件上下文、Git 和会话状态，不抢主聊天区域。"
  }
} satisfies Record<string, unknown>;

function readValue(key: string, source: DictionaryValue): string {
  const path = key.split(".");
  let current: DictionaryValue | undefined = source;

  for (const segment of path) {
    if (!current || typeof current === "string") {
      return key;
    }

    const nextValue = current[segment];

    if (!nextValue) {
      return key;
    }

    current = nextValue as DictionaryValue;
  }

  return typeof current === "string" ? current : key;
}

export function t(key: string): string {
  const extensionValue = readValue(key, extensionZhCN);

  if (extensionValue !== key) {
    return extensionValue;
  }

  return readValue(key, zhCN);
}
