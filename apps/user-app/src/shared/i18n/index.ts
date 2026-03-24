import { zhCN } from "../../i18n/zh-CN";

type DictionaryValue = string | Record<string, unknown>;

const extensionZhCN = {
  common: {
    close: "关闭"
  },
  shell: {
    title: "\u5de5\u4f5c\u53f0",
    subtitle: "\u7ba1\u7406\u4ee3\u7801\u9879\u76ee\u91cc\u7684 AI \u4f1a\u8bdd",
    conversationEntry: "\u5bf9\u8bdd",
    terminalsEntry: "\u7ec8\u7aef",
    filesEntry: "\u6587\u4ef6\u7ba1\u7406",
    gitEntry: "GIT\u7ba1\u7406",
    terminalManagerEntry: "\u7ec8\u7aef\u7ba1\u7406",
    workspaceCount: "\u9879\u76ee",
    sessionCount: "\u4f1a\u8bdd",
    importWorkspaceTitle: "\u6dfb\u52a0\u9879\u76ee",
    importWorkspaceHint: "\u5bfc\u5165\u672c\u5730\u4ee3\u7801\u76ee\u5f55",
    importExpand: "\u5c55\u5f00",
    importCollapse: "\u6536\u8d77",
    importPathLabel: "\u9879\u76ee\u8def\u5f84",
    importPathPlaceholder: "\u8f93\u5165\u9879\u76ee\u6587\u4ef6\u5939\u8def\u5f84",
    importNameLabel: "\u9879\u76ee\u540d\u79f0",
    importNamePlaceholder: "\u53ef\u9009",
    importSubmit: "\u6dfb\u52a0\u9879\u76ee",
    importSubmitting: "\u6dfb\u52a0\u4e2d...",
    importPathRequired: "\u8bf7\u8f93\u5165\u9879\u76ee\u8def\u5f84",
    importSuccess: "\u9879\u76ee\u5df2\u6dfb\u52a0",
    importFailed: "\u6dfb\u52a0\u5931\u8d25",
    refreshNavigation: "\u5237\u65b0",
    navigationLoadFailed: "\u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5",
    emptyNavigationTitle: "\u8fd8\u6ca1\u6709\u9879\u76ee",
    emptyNavigationBody: "\u6dfb\u52a0\u672c\u5730\u4ee3\u7801\u76ee\u5f55\u5f00\u59cb\u5de5\u4f5c",
    emptyWorkspaceSessions: "\u6682\u65e0\u4f1a\u8bdd",
    favoriteSectionTitle: "收藏会话",
    favoriteSectionEmpty: "收藏后的会话会固定放在这里，方便你快速回到常用链路。",
    favoriteAction: "收藏会话",
    unfavoriteAction: "取消收藏",
    favoriteAdded: "会话已加入收藏",
    favoriteRemoved: "会话已取消收藏",
    sessionMoreAction: "更多操作",
    archiveFolderLabel: "归档文件夹",
    archiveAction: "归档会话",
    archiveAdded: "会话已归档",
    unarchiveAction: "取消归档",
    archiveRestored: "会话已恢复到主列表",
    archiveModalTitle: "归档会话",
    archiveModalDescription: "这里列出当前项目暂时隐藏的会话，需要时可以恢复到主列表。",
    archiveEmpty: "这个项目还没有归档会话。",
    workspaceCollapse: "收起项目",
    workspaceExpand: "展开项目",
    createSession: "新建会话",
    createSessionModalTitle: "选择新会话类型",
    createSessionModalDescription: "先选会话类型，再启动真正的会话进程。",
    createSessionTarget: "当前项目",
    providerClaudeCode: "Claude Code",
    providerCodexDescription: "创建 Codex 会话，适合继续当前默认工作流。",
    providerClaudeDescription: "创建 Claude Code 会话，适合切换另一条会话链路。",
    providerOptionHint: "选择后会立即创建会话",
    startClaude: "Claude",
    startCodex: "Codex",
    startingSession: "\u521b\u5efa\u4e2d...",
    startClaudeSuccess: "Claude \u4f1a\u8bdd\u5df2\u521b\u5efa",
    startCodexSuccess: "Codex \u4f1a\u8bdd\u5df2\u521b\u5efa",
    startSessionFailed: "\u521b\u5efa\u5931\u8d25",
    auxiliaryTitle: "\u4fe1\u606f",
    auxiliarySubtitle: "\u6587\u4ef6\u4e0e Git \u72b6\u6001",
    expandAuxiliary: "\u5c55\u5f00",
    collapseAuxiliary: "\u6536\u8d77",
    auxiliaryEmptyTitle: "\u9009\u62e9\u4e00\u4e2a\u4f1a\u8bdd",
    auxiliaryEmptyBody: "\u4f1a\u8bdd\u6587\u4ef6\u548c Git \u4fe1\u606f\u5c06\u663e\u793a\u5728\u8fd9\u91cc",
    hideSessionSidebar: "\u9690\u85cf\u4f1a\u8bdd\u5217\u8868",
    showSessionSidebar: "\u663e\u793a\u4f1a\u8bdd\u5217\u8868",
    hideInfoSidebar: "\u9690\u85cf\u4fe1\u606f\u680f",
    showInfoSidebar: "\u663e\u793a\u4fe1\u606f\u680f",
    centerTabsLabel: "\u4e2d\u95f4\u533a\u57df\u6807\u7b7e",
    infoTabsLabel: "\u4fe1\u606f\u680f\u6807\u7b7e",
    leftResizerLabel: "\u8c03\u6574\u5de6\u4fa7\u5bbd\u5ea6",
    rightResizerLabel: "\u8c03\u6574\u53f3\u4fa7\u5bbd\u5ea6",
    filesPanelEmpty: "\u6587\u4ef6\u7ba1\u7406\u9700\u8981\u5148\u9009\u4e2d\u4e00\u6761\u4f1a\u8bdd\u3002",
    gitPanelEmpty: "\u5148\u5bfc\u5165\u6216\u9009\u4e2d\u4e00\u4e2a\u5de5\u4f5c\u533a\uff0cGit \u4fe1\u606f\u624d\u80fd\u663e\u793a\u3002",
    infoPanelDeferred: "\u5de6\u4fa7\u4f1a\u8bdd\u5217\u8868\u4f18\u5148\u52a0\u8f7d\uff0c\u53f3\u4fa7\u9644\u5c5e\u9762\u677f\u7a0d\u540e\u518d\u6302\u8f7d\u3002"
  },
  workbench: {
    emptyTitle: "\u4ece\u5de6\u4fa7\u9009\u4e00\u6761\u4f1a\u8bdd\u5f00\u59cb",
    emptyBody: "\u4e2d\u95f4\u53ea\u505a\u5bf9\u8bdd\u548c\u7ec8\u7aef\uff0c\u53f3\u4fa7\u53ea\u653e\u6587\u4ef6\u3001Git \u548c\u7ec8\u7aef\u7ba1\u7406\u3002"
  },
  conversation: {
    resendButton: "\u91cd\u53d1",
    historyLoading: "\u52a0\u8f7d\u4e2d...",
    historyLoadingOlder: "\u52a0\u8f7d\u66f4\u65e9\u7684\u6d88\u606f...",
    historyLoadFailed: "\u52a0\u8f7d\u5931\u8d25",
    timelineEmpty: "\u5f00\u59cb\u5bf9\u8bdd",
    composerPlaceholder: "\u628a\u4e0b\u4e00\u6b65\u4ea4\u4ee3\u6e05\u695a\uff0c\u5269\u4e0b\u7684\u4ea4\u7ed9\u8fd9\u6761\u4f1a\u8bdd\u7ee7\u7eed\u8dd1\u3002",
    sendButton: "\u53d1\u9001\u6d88\u606f",
    attachFiles: "\u9644\u52a0\u6587\u4ef6",
    removeAttachment: "\u79fb\u9664\u9644\u4ef6",
    modelSelectorLabel: "\u9009\u62e9\u6a21\u578b",
    reasoningSelectorLabel: "\u9009\u62e9\u63a8\u7406\u5f3a\u5ea6",
    reasoningLow: "\u4f4e",
    reasoningMedium: "\u4e2d",
    reasoningHigh: "\u9ad8",
    reasoningMaximum: "\u6781\u9ad8",
    slashMenu: "\u547d\u4ee4",
    slashMenuTitle: "\u5feb\u6377\u547d\u4ee4",
    slashCommandPlan: "\u5148\u8ba9\u5bf9\u65b9\u7ed9\u51fa\u6267\u884c\u8def\u7ebf",
    slashCommandReview: "\u76f4\u63a5\u8fdb\u5165\u4ee3\u7801\u5ba1\u67e5\u6a21\u5f0f",
    slashCommandExplain: "\u8981\u6c42\u7528\u66f4\u6e05\u695a\u7684\u65b9\u5f0f\u89e3\u91ca",
    toolInputLabel: "\u8f93\u5165",
    toolResultLabel: "\u7ed3\u679c",
    toolResultEmpty: "\u6682\u65e0\u8f93\u51fa",
    toolStatusRunning: "\u8fd0\u884c\u4e2d",
    toolStatusFailed: "\u5df2\u5931\u8d25",
    toolStatusCompleted: "\u5df2\u5b8c\u6210",
    titleFallback: "\u7ee7\u7eed\u5bf9\u8bdd",
    headerWorkspace: "\u5de5\u4f5c\u533a",
    headerProvider: "Provider",
    providerCodex: "Codex",
    providerClaude: "Claude",
    capabilitySend: "\u53ef\u53d1\u9001",
    capabilityDenied: "\u53d7\u9650",
    capabilitySendDisabled: "\u53d1\u9001\u53d7\u9650",
    connectionConnected: "\u5b9e\u65f6\u5df2\u8fde\u63a5",
    connectionReconnecting: "\u6b63\u5728\u91cd\u8fde",
    connectionReconnectFailed: "\u91cd\u8fde\u5931\u8d25",
    connectionClosed: "\u8fde\u63a5\u5df2\u5173\u95ed",
    rulesMessageTitle: "\u89c4\u5219\u4fe1\u606f",
    rulesMessageHint: "\u8fd9\u662f\u4e00\u6bb5\u4f1a\u8bdd\u542f\u52a8\u89c4\u5219\uff0c\u9ed8\u8ba4\u6298\u53e0\u663e\u793a\uff0c\u9700\u8981\u65f6\u518d\u5c55\u5f00\u67e5\u770b\u3002",
    rulesMessageExpand: "\u5c55\u5f00\u89c4\u5219",
    rulesMessageCollapse: "\u6536\u8d77\u89c4\u5219",
    thinkingLabel: "\u601d\u8003\u4e2d"
  },
  terminalManager: {
    workspaceField: "\u5f53\u524d\u5de5\u4f5c\u533a",
    refresh: "\u5237\u65b0\u5217\u8868",
    loadFailed: "\u8fdb\u7a0b\u5217\u8868\u52a0\u8f7d\u5931\u8d25",
    emptyWorkspaceBody: "\u8fd8\u6ca1\u6709\u53ef\u7528\u5de5\u4f5c\u533a\u3002",
    emptyTerminalBody: "\u5f53\u524d\u5de5\u4f5c\u533a\u8fd8\u6ca1\u6709\u7ec8\u7aef\u5b9e\u4f8b\u3002",
    closeAction: "\u5173\u95ed\u8fdb\u7a0b",
    closing: "\u5173\u95ed\u4e2d...",
    closeSuccess: "\u7ec8\u7aef\u5173\u95ed\u8bf7\u6c42\u5df2\u63d0\u4ea4\u3002",
    closeFailed: "\u7ec8\u7aef\u5173\u95ed\u5931\u8d25",
    lastActiveAt: "\u6700\u8fd1\u6d3b\u8dc3",
    exitCode: "Exit Code",
    runningValue: "\u8fd0\u884c\u4e2d"
  },
  theme: {
    light: "\u6d45\u8272",
    dark: "\u6df1\u8272",
    skyBlue: "\u5929\u7a7a\u84dd",
    eyeGreen: "\u62a4\u773c\u7eff",
    switchLabel: "\u4e3b\u9898"
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
