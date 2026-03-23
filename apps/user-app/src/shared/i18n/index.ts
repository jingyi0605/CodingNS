import { zhCN } from "../../i18n/zh-CN";

type DictionaryValue = string | Record<string, unknown>;

const extensionZhCN = {
  home: {
    terminalsEntry: "终端",
    homeBadge: "首页",
    dashboardTitle: "选择一个工作区开始",
    dashboardSubtitle: "在左侧浏览您的工作区和会话",
    resumeLatestSession: "继续上次会话",
    workspaceGuide: "左侧选择工作区，查看相关会话",
    sessionGuide: "点击会话继续对话",
    emptySessionsTitle: "暂无会话",
    quickOverviewTitle: "概览",
    quickOverviewBody: "管理工作区，继续对话",
    nextStepTitle: "开始使用",
    nextStepBody: "从左侧选择一个会话，或导入新的工作区",
    auxiliarySubtitle: "会话信息和文件"
  },
  shell: {
    title: "工作台",
    subtitle: "管理代码项目与 AI 会话",
    homeEntry: "首页",
    workspaceCount: "项目",
    sessionCount: "会话",
    importWorkspaceTitle: "添加项目",
    importWorkspaceHint: "导入本地代码目录",
    importExpand: "展开",
    importCollapse: "收起",
    importPathLabel: "项目路径",
    importPathPlaceholder: "输入项目文件夹路径",
    importNameLabel: "项目名称",
    importNamePlaceholder: "可选",
    importSubmit: "添加项目",
    importSubmitting: "添加中...",
    importPathRequired: "请输入项目路径",
    importSuccess: "项目已添加",
    importFailed: "添加失败",
    refreshNavigation: "刷新",
    navigationLoadFailed: "加载失败，请重试",
    emptyNavigationTitle: "还没有项目",
    emptyNavigationBody: "添加本地代码目录开始工作",
    emptyWorkspaceSessions: "暂无会话",
    startClaude: "Claude",
    startCodex: "Codex",
    startingSession: "创建中...",
    startClaudeSuccess: "Claude 会话已创建",
    startCodexSuccess: "Codex 会话已创建",
    startSessionFailed: "创建失败",
    auxiliaryTitle: "信息",
    auxiliarySubtitle: "文件与 Git 状态",
    expandAuxiliary: "展开",
    collapseAuxiliary: "收起",
    auxiliaryEmptyTitle: "选择一个会话",
    auxiliaryEmptyBody: "会话文件和 Git 信息将显示在这里"
  },
  conversation: {
    auxiliarySubtitle: "文件与 Git",
    composerPlaceholder: "输入消息...",
    sendButton: "发送",
    attachFiles: "添加附件",
    titleFallback: "新会话",
    historyLoading: "加载中...",
    historyLoadFailed: "加载失败",
    timelineEmpty: "开始对话",
    resendButton: "重发",
    capabilityDenied: "不可用"
  },
  theme: {
    light: "浅色",
    dark: "深色",
    skyBlue: "天空蓝",
    eyeGreen: "护眼绿",
    switchLabel: "主题"
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
