import { zhCN } from "../../i18n/zh-CN";

type DictionaryValue = string | Record<string, unknown>;

const extensionZhCN = {
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
    gitPanelEmpty: "\u5148\u5bfc\u5165\u6216\u9009\u4e2d\u4e00\u4e2a\u5de5\u4f5c\u533a\uff0cGit \u4fe1\u606f\u624d\u80fd\u663e\u793a\u3002"
  },
  workbench: {
    emptyTitle: "\u4ece\u5de6\u4fa7\u9009\u4e00\u6761\u4f1a\u8bdd\u5f00\u59cb",
    emptyBody: "\u4e2d\u95f4\u53ea\u505a\u5bf9\u8bdd\u548c\u7ec8\u7aef\uff0c\u53f3\u4fa7\u53ea\u653e\u6587\u4ef6\u3001Git \u548c\u7ec8\u7aef\u7ba1\u7406\u3002"
  },
  conversation: {
    resendButton: "\u91cd\u53d1",
    historyLoading: "\u52a0\u8f7d\u4e2d...",
    historyLoadFailed: "\u52a0\u8f7d\u5931\u8d25",
    timelineEmpty: "\u5f00\u59cb\u5bf9\u8bdd",
    toolInputLabel: "\u8f93\u5165",
    toolResultLabel: "\u7ed3\u679c",
    toolResultEmpty: "\u6682\u65e0\u8f93\u51fa",
    toolStatusRunning: "\u8fd0\u884c\u4e2d",
    toolStatusFailed: "\u5df2\u5931\u8d25",
    toolStatusCompleted: "\u5df2\u5b8c\u6210",
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
