import { zhCN } from "../../i18n/zh-CN";

type DictionaryValue = string | Record<string, unknown>;

const extensionZhCN = {
  shell: {
    title: "\u5de5\u4f5c\u53f0",
    subtitle: "\u7ba1\u7406\u4ee3\u7801\u9879\u76ee\u91cc\u7684 AI \u4f1a\u8bdd",
    workbenchEntry: "\u5de5\u4f5c\u53f0",
    terminalsEntry: "\u7ec8\u7aef",
    filesEntry: "\u6587\u4ef6\u7ba1\u7406",
    gitEntry: "GIT\u7ba1\u7406",
    processesEntry: "\u8fdb\u7a0b\u7ba1\u7406",
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
    auxiliaryEmptyBody: "\u4f1a\u8bdd\u6587\u4ef6\u548c Git \u4fe1\u606f\u5c06\u663e\u793a\u5728\u8fd9\u91cc"
  },
  workbench: {
    pageSubtitle: "\u53ea\u4fdd\u7559\u771f\u6b63\u7528\u5f97\u4e0a\u7684\u5165\u53e3\uff1a\u4f1a\u8bdd\u3001\u7ec8\u7aef\u3001\u6587\u4ef6\u3001Git\u3001\u8fdb\u7a0b\u3002",
    quickEntryTitle: "\u5e38\u7528\u5165\u53e3",
    quickEntryBody: "\u4e0d\u518d\u7559\u4e00\u4e2a\u7a7a\u58f3\u9996\u9875\uff0c\u9700\u8981\u4ec0\u4e48\u5c31\u76f4\u63a5\u8fdb\u3002",
    recentSessionsTitle: "\u6700\u8fd1\u4f1a\u8bdd",
    recentSessionsBody: "\u5de5\u4f5c\u53f0\u4f1a\u8bdd\u4ece\u8fd9\u91cc\u76f4\u63a5\u8fdb\u5165\u3002",
    emptySessionsTitle: "\u6682\u65e0\u4f1a\u8bdd",
    emptySessionsBody: "\u5148\u5728\u5de6\u4fa7\u9879\u76ee\u5217\u8868\u4e2d\u521b\u5efa\u4e00\u6761 Claude \u6216 Codex \u4f1a\u8bdd\u3002",
    summaryTitle: "\u6982\u89c8",
    auxiliarySubtitle: "\u5de5\u4f5c\u53f0\u4fe1\u606f",
    auxiliaryActionTitle: "\u4e0b\u4e00\u6b65",
    auxiliaryActionBody: "\u5de6\u4fa7\u7ba1\u9879\u76ee\u548c\u4f1a\u8bdd\uff0c\u4e2d\u95f4\u53ea\u7559\u771f\u6b63\u52a8\u624b\u7684\u9875\u9762\u3002"
  },
  fileManager: {
    pageSubtitle: "\u6587\u4ef6\u7ba1\u7406\u4ecd\u7136\u670d\u52a1\u5f53\u524d\u4f1a\u8bdd\uff0c\u53ea\u662f\u4ece\u4fa7\u680f\u79fb\u5230\u4e86\u72ec\u7acb\u9875\u9762\u3002",
    sessionField: "\u5f53\u524d\u4f1a\u8bdd",
    currentSessionTitle: "\u5f53\u524d\u4e0a\u4e0b\u6587",
    auxiliarySubtitle: "\u9009\u4e2d\u4f1a\u8bdd\u7684\u6587\u4ef6\u4e0a\u4e0b\u6587",
    emptyStateTitle: "\u8fd8\u6ca1\u6709\u53ef\u7528\u4f1a\u8bdd",
    emptyStateBody: "\u6587\u4ef6\u7ba1\u7406\u9700\u8981\u4f9d\u9644\u5728\u4e00\u6761\u4f1a\u8bdd\u4e0a\uff0c\u5148\u53bb\u5de5\u4f5c\u53f0\u521b\u5efa\u4f1a\u8bdd\u3002"
  },
  gitManager: {
    pageSubtitle: "\u53ea\u4fdd\u7559\u5f53\u524d\u5de5\u4f5c\u533a\u7684 Git \u4e8b\u5b9e\uff0c\u4e0d\u641e\u82b1\u91cc\u80e1\u54e8\u7684\u9996\u9875\u5305\u88c5\u3002",
    workspaceField: "\u5f53\u524d\u5de5\u4f5c\u533a",
    currentWorkspaceTitle: "\u5f53\u524d\u5de5\u4f5c\u533a",
    auxiliarySubtitle: "\u5f53\u524d\u5de5\u4f5c\u533a\u7684 Git \u4e0a\u4e0b\u6587",
    emptyStateTitle: "\u8fd8\u6ca1\u6709\u53ef\u7528\u5de5\u4f5c\u533a",
    emptyStateBody: "\u5148\u5bfc\u5165\u4e00\u4e2a\u9879\u76ee\uff0cGit \u7ba1\u7406\u624d\u6709\u5bf9\u8c61\u3002"
  },
  processManager: {
    pageSubtitle: "\u8fd9\u91cc\u7ba1\u7684\u4e0d\u662f\u64cd\u4f5c\u7cfb\u7edf\u6240\u6709\u8fdb\u7a0b\uff0c\u800c\u662f Host \u6248\u7ba1\u7684\u7ec8\u7aef\u5b9e\u4f8b\u3002",
    workspaceField: "\u5f53\u524d\u5de5\u4f5c\u533a",
    currentWorkspaceTitle: "\u5f53\u524d\u5de5\u4f5c\u533a",
    auxiliarySubtitle: "\u5f53\u524d\u5de5\u4f5c\u533a\u7684\u7ec8\u7aef\u5b9e\u4f8b",
    refresh: "\u5237\u65b0\u5217\u8868",
    emptyStateTitle: "\u6682\u65e0\u53ef\u7ba1\u7406\u8fdb\u7a0b",
    emptyStateBody: "\u5148\u53bb\u7ec8\u7aef\u9875\u9762\u521b\u5efa\u6216\u8fde\u63a5\u4e00\u4e2a\u7ec8\u7aef\u3002",
    loadFailed: "\u8fdb\u7a0b\u5217\u8868\u52a0\u8f7d\u5931\u8d25",
    closeAction: "\u5173\u95ed\u8fdb\u7a0b",
    closing: "\u5173\u95ed\u4e2d...",
    closeSuccess: "\u7ec8\u7aef\u5173\u95ed\u8bf7\u6c42\u5df2\u63d0\u4ea4\u3002",
    closeFailed: "\u7ec8\u7aef\u5173\u95ed\u5931\u8d25",
    lastActiveAt: "\u6700\u8fd1\u6d3b\u8dc3",
    createdAt: "\u521b\u5efa\u65f6\u95f4",
    closedAt: "\u5173\u95ed\u65f6\u95f4",
    exitCode: "Exit Code",
    runningValue: "\u8fd0\u884c\u4e2d",
    openTerminalPage: "\u6253\u5f00\u7ec8\u7aef\u9875"
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
