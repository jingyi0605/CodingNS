import type {
  DebugAiFallbackPolicy,
  DebugInjectionMode,
  FrameworkCompatibilityMatrixItem,
  FrameworkCompatibilityLevel
} from "../../types/domain.js";

export const FRAMEWORK_COMPATIBILITY_MATRIX_VERSION = "2026-04-13";

export const FRAMEWORK_COMPATIBILITY_MATRIX: FrameworkCompatibilityMatrixItem[] = [
  createItem("vite", "supported", "cli", true, true, false, "conditional", "Vite 端口入口清楚，第一阶段默认支持"),
  createItem("nextjs", "supported", "cli", true, false, false, "conditional", "Next.js 支持命令行改端口，但要注意 rewrites 和服务发现"),
  createItem("cra", "supported", "env", true, true, false, "conditional", "CRA 常见要同时处理开发代理和 WebSocket"),
  createItem("astro", "supported", "cli", true, false, false, "conditional", "Astro 单服务前端项目兼容较好"),
  createItem("nuxt", "supported", "override", true, false, false, "conditional", "Nuxt 适合先按单服务处理"),
  createItem("vue-cli", "supported", "override", true, true, false, "conditional", "Vue CLI 端口可改，但别漏掉 HMR"),
  createItem("spring-boot", "supported", "env", true, false, false, "conditional", "Spring Boot 后端端口覆盖稳定"),
  createItem("uvicorn", "supported", "cli", true, false, false, "conditional", "Uvicorn / FastAPI 单服务后端兼容度高"),
  createItem("flask", "supported", "cli", true, false, false, "conditional", "Flask 单服务场景适合第一阶段"),
  createItem("django", "supported", "cli", true, false, true, "conditional", "Django 端口覆盖稳定，但 callback 可能要一起提醒"),
  createItem("rails", "supported", "cli", true, false, true, "conditional", "Rails 单服务兼容较好"),
  createItem("aspnet-core", "supported", "env", false, false, true, "conditional", "ASP.NET Core 官方 URL 注入能力清楚"),
  createItem("nestjs", "conditional", "env", false, false, false, "conditional", "NestJS 取决于项目是否真的读取 PORT"),
  createItem("express", "conditional", "env", false, false, false, "allowed", "Express 常见问题是端口写死在少量文件"),
  createItem("koa", "conditional", "env", false, false, false, "allowed", "Koa 和 Express 一样，先看环境变量入口"),
  createItem("hono", "conditional", "env", false, false, false, "allowed", "Hono 项目写法波动较大"),
  createItem("node-custom", "conditional", "env", false, false, false, "allowed", "自定义 Node 服务只做谨慎支持"),
  createItem("go-http", "unsupported", "none", false, false, false, "conditional", "Go 自定义 HTTP 服务第一阶段不自动注入"),
  createItem("laravel", "conditional", "override", false, false, false, "allowed", "Laravel 要先区分内置 server 还是其他运行方式"),
  createItem("php-custom", "conditional", "override", false, false, false, "allowed", "PHP 本地服务启动形态差异较大"),
  createItem("remix", "conditional", "env", true, true, true, "allowed", "Remix 常常要同时处理 SSR、HMR 和 callback"),
  createItem("electron", "unsupported", "none", false, false, false, "never", "壳层开发模式第一阶段不自动注入"),
  createItem("tauri", "unsupported", "none", false, false, false, "never", "Tauri 壳层开发模式第一阶段不自动注入"),
  createItem("unknown", "unknown", "none", false, false, false, "conditional", "证据不足时默认不自动注入")
];

export function getFrameworkCompatibilityItem(
  framework: string | null | undefined
): FrameworkCompatibilityMatrixItem {
  const normalized = framework?.trim().toLowerCase() || "unknown";
  return FRAMEWORK_COMPATIBILITY_MATRIX.find((item) => item.framework === normalized)
    ?? FRAMEWORK_COMPATIBILITY_MATRIX.find((item) => item.framework === "unknown")!;
}

function createItem(
  framework: string,
  compatibilityLevel: FrameworkCompatibilityLevel,
  recommendedInjectionMode: DebugInjectionMode,
  requiresServiceDiscoveryHandling: boolean,
  requiresHmrHandling: boolean,
  requiresCallbackHandling: boolean,
  aiFallbackPolicy: DebugAiFallbackPolicy,
  notes: string
): FrameworkCompatibilityMatrixItem {
  return {
    framework,
    compatibilityLevel,
    recommendedInjectionMode,
    requiresServiceDiscoveryHandling,
    requiresHmrHandling,
    requiresCallbackHandling,
    aiFallbackPolicy,
    notes
  };
}
