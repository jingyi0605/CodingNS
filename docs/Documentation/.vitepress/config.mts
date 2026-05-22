import { defineConfig } from "vitepress";

function normalizeBase(rawBase?: string) {
  if (!rawBase) {
    return "/";
  }

  let normalized = rawBase.trim();
  if (!normalized) {
    return "/";
  }

  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  if (!normalized.endsWith("/")) {
    normalized = `${normalized}/`;
  }

  return normalized;
}

function createThemeConfig(options: {
  nav: Array<{ text: string; link: string }>;
  sidebar: Record<string, Array<{ text: string; items: Array<{ text: string; link: string }> }>>;
  outlineLabel: string;
  prevLabel: string;
  nextLabel: string;
  lastUpdatedText: string;
  sidebarMenuLabel: string;
  returnToTopLabel: string;
  darkModeSwitchLabel: string;
  lightModeSwitchTitle: string;
  darkModeSwitchTitle: string;
  langMenuLabel: string;
  footerMessage: string;
}) {
  return {
    nav: options.nav,
    sidebar: options.sidebar,
    outline: {
      level: [2, 3],
      label: options.outlineLabel
    },
    search: {
      provider: "local"
    },
    docFooter: {
      prev: options.prevLabel,
      next: options.nextLabel
    },
    lastUpdated: {
      text: options.lastUpdatedText
    },
    sidebarMenuLabel: options.sidebarMenuLabel,
    returnToTopLabel: options.returnToTopLabel,
    darkModeSwitchLabel: options.darkModeSwitchLabel,
    lightModeSwitchTitle: options.lightModeSwitchTitle,
    darkModeSwitchTitle: options.darkModeSwitchTitle,
    langMenuLabel: options.langMenuLabel,
    footer: {
      message: options.footerMessage,
      copyright: "Copyright © 2026 CodingNS"
    }
  };
}

const zhSidebar = [
  {
    text: "认识 CodingNS",
    items: [
      { text: "文档地图", link: "/overview/docs-overview" },
      { text: "产品概览", link: "/overview/product-overview" },
      { text: "核心能力", link: "/overview/core-features" },
      { text: "平台与场景", link: "/overview/platforms-and-scenarios" }
    ]
  },
  {
    text: "开发者手册",
    items: [
      { text: "开发者手册总览", link: "/developer-guide/" },
      { text: "工作区文件桥与桌面包装", link: "/developer-guide/workspace-file-bridge-and-desktop-wrapper" },
      { text: "插件前端接入工作区文件桥", link: "/developer-guide/plugin-frontend-workspace-file-bridge" }
    ]
  },
  {
    text: "安装与接入",
    items: [
      { text: "安装路径选择", link: "/quick-install/installation-paths" },
      { text: "安装 Host 服务", link: "/quick-install/host-installation" },
      { text: "连接客户端", link: "/quick-install/client-connection" },
      { text: "首次登录与开始使用", link: "/quick-install/first-login" }
    ]
  },
  {
    text: "日常使用",
    items: [
      { text: "工作区与会话", link: "/user-guide/workspaces-and-sessions" },
      { text: "对话工作台", link: "/user-guide/conversation-workbench" },
      { text: "文件、Git 与终端", link: "/user-guide/files-git-and-terminal" },
      { text: "设置与更新", link: "/user-guide/settings-and-updates" }
    ]
  },
  {
    text: "远程访问",
    items: [
      { text: "远程访问概览", link: "/remote-access/remote-access-overview" },
      { text: "Tailscale 接入", link: "/remote-access/tailscale-access" },
      { text: "隧道服务", link: "/remote-access/tunnel-service" },
      { text: "安全与稳定建议", link: "/remote-access/safe-access-tips" }
    ]
  },
  {
    text: "支持与社区",
    items: [
      { text: "社区入口", link: "/community/community-overview" },
      { text: "官方链接", link: "/community/official-links" },
      { text: "反馈与支持", link: "/community/feedback-and-support" }
    ]
  }
];

const enSidebar = [
  {
    text: "Explore CodingNS",
    items: [
      { text: "Docs Map", link: "/en/overview/docs-overview" },
      { text: "Product Overview", link: "/en/overview/product-overview" },
      { text: "Core Features", link: "/en/overview/core-features" },
      { text: "Platforms & Scenarios", link: "/en/overview/platforms-and-scenarios" }
    ]
  },
  {
    text: "Developer Guide",
    items: [
      { text: "Developer Guide Overview", link: "/en/developer-guide/" },
      { text: "Workspace File Bridge & Desktop Wrapper", link: "/en/developer-guide/workspace-file-bridge-and-desktop-wrapper" },
      { text: "Plugin Frontend Workspace File Bridge", link: "/en/developer-guide/plugin-frontend-workspace-file-bridge" }
    ]
  },
  {
    text: "Install & Connect",
    items: [
      { text: "Choose an Install Path", link: "/en/quick-install/installation-paths" },
      { text: "Install the Host Service", link: "/en/quick-install/host-installation" },
      { text: "Connect a Client", link: "/en/quick-install/client-connection" },
      { text: "First Login", link: "/en/quick-install/first-login" }
    ]
  },
  {
    text: "Daily Use",
    items: [
      { text: "Workspaces & Sessions", link: "/en/user-guide/workspaces-and-sessions" },
      { text: "Conversation Workbench", link: "/en/user-guide/conversation-workbench" },
      { text: "Files, Git & Terminal", link: "/en/user-guide/files-git-and-terminal" },
      { text: "Settings & Updates", link: "/en/user-guide/settings-and-updates" }
    ]
  },
  {
    text: "Remote Access",
    items: [
      { text: "Overview", link: "/en/remote-access/remote-access-overview" },
      { text: "Tailscale Access", link: "/en/remote-access/tailscale-access" },
      { text: "Tunnel Service", link: "/en/remote-access/tunnel-service" },
      { text: "Safety & Stability Tips", link: "/en/remote-access/safe-access-tips" }
    ]
  },
  {
    text: "Support & Community",
    items: [
      { text: "Community Entry", link: "/en/community/community-overview" },
      { text: "Official Links", link: "/en/community/official-links" },
      { text: "Feedback & Support", link: "/en/community/feedback-and-support" }
    ]
  }
];

const zhThemeConfig = createThemeConfig({
  nav: [
    { text: "文档首页", link: "/" },
    { text: "开始使用", link: "/quick-install/installation-paths" },
    { text: "开发者手册", link: "/developer-guide/" },
    { text: "功能使用", link: "/user-guide/workspaces-and-sessions" },
    { text: "连接与访问", link: "/remote-access/remote-access-overview" },
    { text: "支持与反馈", link: "/community/feedback-and-support" }
  ],
  sidebar: {
    "/": zhSidebar,
    "/en/": enSidebar
  },
  outlineLabel: "本页目录",
  prevLabel: "上一页",
  nextLabel: "下一页",
  lastUpdatedText: "最后更新",
  sidebarMenuLabel: "目录",
  returnToTopLabel: "回到顶部",
  darkModeSwitchLabel: "切换主题",
  lightModeSwitchTitle: "切换到浅色模式",
  darkModeSwitchTitle: "切换到深色模式",
  langMenuLabel: "语言",
  footerMessage: "文档内容只描述当前公开可用的产品能力与用户操作路径。"
});

const enThemeConfig = createThemeConfig({
  nav: [
    { text: "Home", link: "/en/" },
    { text: "Get Started", link: "/en/quick-install/installation-paths" },
    { text: "Developer Guide", link: "/en/developer-guide/" },
    { text: "Use the Product", link: "/en/user-guide/workspaces-and-sessions" },
    { text: "Access & Connect", link: "/en/remote-access/remote-access-overview" },
    { text: "Support", link: "/en/community/feedback-and-support" }
  ],
  sidebar: {
    "/en/": enSidebar
  },
  outlineLabel: "On This Page",
  prevLabel: "Previous page",
  nextLabel: "Next page",
  lastUpdatedText: "Last updated",
  sidebarMenuLabel: "Menu",
  returnToTopLabel: "Back to top",
  darkModeSwitchLabel: "Switch theme",
  lightModeSwitchTitle: "Switch to light mode",
  darkModeSwitchTitle: "Switch to dark mode",
  langMenuLabel: "Language",
  footerMessage: "These docs describe the current public product behavior and common user flows only."
});

export default defineConfig({
  title: "CodingNS Docs",
  description: "CodingNS 官方文档",
  srcDir: ".",
  cleanUrls: true,
  lastUpdated: true,
  base: normalizeBase(process.env.CODINGNS_DOCS_BASE),
  themeConfig: zhThemeConfig,
  locales: {
    root: {
      label: "简体中文",
      lang: "zh-CN",
      themeConfig: zhThemeConfig
    },
    en: {
      label: "English",
      lang: "en-US",
      link: "/en/",
      themeConfig: enThemeConfig
    }
  },
  head: [
    ["meta", { name: "theme-color", content: "#0f766e" }]
  ],
  theme: {
    darkModeSwitchLabel: "切换主题"
  }
});
