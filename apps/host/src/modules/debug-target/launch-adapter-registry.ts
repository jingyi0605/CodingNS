import fs from "node:fs";
import path from "node:path";

import type {
  AiFallbackEditStatus,
  DebugAdapterKind,
  DebugAiFallbackSummary,
  DebugInjectionMode,
  DebugLaunchAdapterAttempt,
  DebugServiceSpec,
  FrameworkAnalysisResult
} from "../../types/domain.js";

export interface ResolvedLaunchPlan {
  adapterKind: DebugAdapterKind | null;
  injectionMode: DebugInjectionMode | null;
  args: string[];
  envPatch: Record<string, string>;
  expectedPort: number | null;
  leasedPort: number | null;
  artifactRef: string | null;
  failureStage: string | null;
  adapterAttempts: DebugLaunchAdapterAttempt[];
  aiFallback: DebugAiFallbackSummary | null;
}

interface LaunchAdapterContext {
  targetRootPath: string;
  service: DebugServiceSpec;
  analysis: FrameworkAnalysisResult;
  leasedPort: number;
}

const CLI_FRAMEWORKS = new Set([
  "vite",
  "nextjs",
  "astro",
  "uvicorn",
  "flask",
  "django",
  "rails"
]);

const ENV_FRAMEWORKS = new Set([
  "cra",
  "spring-boot",
  "aspnet-core",
  "nestjs",
  "express",
  "koa",
  "hono",
  "node-custom",
  "remix"
]);

const OVERRIDE_FRAMEWORKS = new Set([
  "nuxt",
  "vue-cli",
  "laravel",
  "php-custom"
]);

const CONDITIONAL_ENV_FRAMEWORKS = new Set([
  "nestjs",
  "express",
  "koa",
  "hono",
  "node-custom"
]);

const AI_FALLBACK_ALLOWED_CONFIG_NAMES = new Set([
  "package.json",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "nuxt.config.ts",
  "nuxt.config.js",
  "vue.config.js",
  "astro.config.mjs",
  "astro.config.ts",
  "manage.py",
  "app.py",
  "artisan",
  "composer.json",
  "Gemfile",
  "application.properties",
  "application.yml",
  "application.yaml",
  "settings.py",
  "server.js",
  "server.ts",
  "app.js",
  "app.ts",
  "main.js",
  "main.ts",
  "index.js",
  "index.ts"
]);

/**
 * 第一阶段的适配器链只回答一个问题：
 * 这个服务当前最稳妥的端口注入方式是什么，以及为什么不允许继续自动启动。
 */
export function resolveLaunchPlan(context: LaunchAdapterContext): ResolvedLaunchPlan {
  const expectedPort = context.service.defaultPortHint ?? null;
  const attempts: DebugLaunchAdapterAttempt[] = [];
  const framework = context.analysis.primaryFramework?.trim().toLowerCase() ?? "unknown";

  const cliPlan = tryCliAdapter(context, framework, attempts, expectedPort);

  if (cliPlan) {
    return cliPlan;
  }

  const envPlan = tryEnvAdapter(context, framework, attempts, expectedPort);

  if (envPlan) {
    return envPlan;
  }

  const overridePlan = tryOverrideAdapter(context, framework, attempts, expectedPort);

  if (overridePlan) {
    return overridePlan;
  }

  return buildAiFallbackPlan(context, framework, attempts, expectedPort);
}

function tryCliAdapter(
  context: LaunchAdapterContext,
  framework: string,
  attempts: DebugLaunchAdapterAttempt[],
  expectedPort: number | null
): ResolvedLaunchPlan | null {
  if (!CLI_FRAMEWORKS.has(framework)) {
    attempts.push({
      kind: "cli",
      status: "skipped",
      reason: `框架 ${framework} 不走 CLI 端口注入`
    });
    return null;
  }

  attempts.push({
    kind: "cli",
    status: "selected",
    reason: "框架支持通过命令行参数覆盖端口"
  });

  return {
    adapterKind: "cli",
    injectionMode: "cli",
    args: appendCliPortArgs(context.service.args, framework, context.leasedPort),
    envPatch: {},
    expectedPort,
    leasedPort: context.leasedPort,
    artifactRef: null,
    failureStage: null,
    adapterAttempts: attempts,
    aiFallback: null
  };
}

function tryEnvAdapter(
  context: LaunchAdapterContext,
  framework: string,
  attempts: DebugLaunchAdapterAttempt[],
  expectedPort: number | null
): ResolvedLaunchPlan | null {
  if (!ENV_FRAMEWORKS.has(framework)) {
    attempts.push({
      kind: "env",
      status: "skipped",
      reason: `框架 ${framework} 不走 ENV 端口注入`
    });
    return null;
  }

  if (CONDITIONAL_ENV_FRAMEWORKS.has(framework)) {
    const envProbe = probeNodeEnvPortSupport(context);

    if (!envProbe.supported) {
      attempts.push({
        kind: "env",
        status: "blocked",
        reason: envProbe.reason
      });
      return null;
    }

    attempts.push({
      kind: "env",
      status: "selected",
      reason: envProbe.reason
    });
  } else {
    attempts.push({
      kind: "env",
      status: "selected",
      reason: "框架支持通过环境变量覆盖端口"
    });
  }

  return {
    adapterKind: "env",
    injectionMode: "env",
    args: [...context.service.args],
    envPatch: buildEnvPatch(framework, context.leasedPort),
    expectedPort,
    leasedPort: context.leasedPort,
    artifactRef: null,
    failureStage: null,
    adapterAttempts: attempts,
    aiFallback: null
  };
}

function tryOverrideAdapter(
  context: LaunchAdapterContext,
  framework: string,
  attempts: DebugLaunchAdapterAttempt[],
  expectedPort: number | null
): ResolvedLaunchPlan | null {
  if (!OVERRIDE_FRAMEWORKS.has(framework)) {
    attempts.push({
      kind: "override",
      status: "skipped",
      reason: `框架 ${framework} 不走运行时覆盖产物`
    });
    return null;
  }

  attempts.push({
    kind: "override",
    status: "selected",
    reason: "框架需要临时覆盖产物或额外注入信息"
  });

  return {
    adapterKind: "override",
    injectionMode: "override",
    args: [...context.service.args],
    envPatch: buildOverrideEnvPatch(framework, context.leasedPort),
    expectedPort,
    leasedPort: context.leasedPort,
    artifactRef: buildOverrideArtifactRef(framework, context.service.id, context.leasedPort),
    failureStage: null,
    adapterAttempts: attempts,
    aiFallback: null
  };
}

function buildAiFallbackPlan(
  context: LaunchAdapterContext,
  framework: string,
  attempts: DebugLaunchAdapterAttempt[],
  expectedPort: number | null
): ResolvedLaunchPlan {
  const fallback = resolveAiFallback(context, framework);

  attempts.push({
    kind: "ai_fallback",
    status: fallback.eligible ? "fallback_required" : "blocked",
    reason: fallback.reason
  });

  return {
    adapterKind: fallback.eligible ? "ai_fallback" : null,
    injectionMode: fallback.eligible ? "ai_fallback" : null,
    args: [...context.service.args],
    envPatch: {},
    expectedPort,
    leasedPort: context.leasedPort,
    artifactRef: null,
    failureStage: fallback.eligible ? "ai_fallback_required" : "adapter_selection",
    adapterAttempts: attempts,
    aiFallback: fallback
  };
}

function resolveAiFallback(
  context: LaunchAdapterContext,
  framework: string
): DebugAiFallbackSummary {
  if (context.analysis.aiFallbackPolicy === "never") {
    return {
      eligible: false,
      editId: null,
      status: null,
      reason: "当前框架不允许进入 AI 兜底",
      allowedFiles: []
    };
  }

  if (
    context.analysis.compatibilityLevel === "unsupported"
    || context.analysis.compatibilityLevel === "unknown"
  ) {
    return {
      eligible: false,
      editId: null,
      status: null,
      reason: "当前兼容等级不允许默认进入 AI 兜底",
      allowedFiles: []
    };
  }

  const allowedFiles = collectAiFallbackCandidates(context, framework);

  if (allowedFiles.length === 0) {
    return {
      eligible: false,
      editId: null,
      status: null,
      reason: "没有收敛出安全的候选配置文件，拒绝进入 AI 兜底",
      allowedFiles: []
    };
  }

  return {
    eligible: true,
    editId: null,
    status: "PENDING" satisfies AiFallbackEditStatus,
    reason: "前三层适配器都不满足，进入受限 AI 兜底等待人工确认",
    allowedFiles
  };
}

function probeNodeEnvPortSupport(context: LaunchAdapterContext): {
  supported: boolean;
  reason: string;
} {
  const candidateFiles = resolveCommandCandidateFiles(context.service, context.targetRootPath);

  if (candidateFiles.length === 0) {
    return {
      supported: true,
      reason: "没有发现明确冲突证据，先按环境变量注入处理"
    };
  }

  let sawExplicitEnvRead = false;
  let sawHardcodedPort = false;

  for (const relativePath of candidateFiles) {
    const absolutePath = path.resolve(context.targetRootPath, relativePath);
    const content = safeReadText(absolutePath);

    if (!content) {
      continue;
    }

    if (containsEnvPortSignal(content)) {
      sawExplicitEnvRead = true;
    }

    if (containsHardcodedPortSignal(content)) {
      sawHardcodedPort = true;
    }
  }

  if (sawExplicitEnvRead) {
    return {
      supported: true,
      reason: "入口文件检测到 PORT 环境变量读取"
    };
  }

  if (sawHardcodedPort) {
    return {
      supported: false,
      reason: "入口文件检测到疑似硬编码端口，环境变量注入不可靠"
    };
  }

  return {
    supported: true,
    reason: "入口文件没有发现硬编码端口，先按环境变量注入处理"
  };
}

function collectAiFallbackCandidates(
  context: LaunchAdapterContext,
  framework: string
): string[] {
  const candidates = new Set<string>();

  for (const detectedFile of context.analysis.detectedFiles) {
    const normalized = normalizeRelativePath(context.targetRootPath, detectedFile);

    if (!normalized) {
      continue;
    }

    if (AI_FALLBACK_ALLOWED_CONFIG_NAMES.has(path.basename(normalized)) || isConfigLikeFile(normalized)) {
      candidates.add(normalized);
    }
  }

  for (const relativePath of resolveCommandCandidateFiles(context.service, context.targetRootPath)) {
    const normalized = normalizeRelativePath(context.targetRootPath, relativePath);

    if (normalized) {
      candidates.add(normalized);
    }
  }

  if ((framework === "express" || framework === "koa" || framework === "hono" || framework === "node-custom")
    && candidates.size === 0) {
    for (const fallbackName of ["server.js", "app.js", "index.js", "main.js", "server.ts", "main.ts"]) {
      const absolutePath = path.resolve(context.targetRootPath, fallbackName);

      if (fs.existsSync(absolutePath)) {
        candidates.add(fallbackName);
      }
    }
  }

  return [...candidates].slice(0, 5);
}

function resolveCommandCandidateFiles(service: DebugServiceSpec, targetRootPath: string): string[] {
  const candidates: string[] = [];
  const command = service.command.trim().toLowerCase();
  const args = [...service.args];

  if (command === "node" || command === "bun" || command === "tsx" || command === "ts-node") {
    const entry = args.find((arg) => !arg.startsWith("-"));

    if (entry) {
      const normalized = normalizeRelativePath(targetRootPath, entry);

      if (normalized) {
        candidates.push(normalized);
      }
    }
  }

  if ((command === "python" || command === "python3") && args.length > 0) {
    const entry = args.find((arg) => !arg.startsWith("-"));

    if (entry) {
      const normalized = normalizeRelativePath(targetRootPath, entry);

      if (normalized) {
        candidates.push(normalized);
      }
    }
  }

  return [...new Set(candidates)];
}

function normalizeRelativePath(rootPath: string, candidatePath: string): string | null {
  const trimmed = candidatePath.trim();

  if (!trimmed) {
    return null;
  }

  const absolutePath = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(rootPath, trimmed);

  if (!absolutePath.startsWith(path.resolve(rootPath))) {
    return null;
  }

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return null;
  }

  return path.relative(rootPath, absolutePath) || path.basename(absolutePath);
}

function containsEnvPortSignal(content: string): boolean {
  return (
    content.includes("process.env.PORT")
    || content.includes("import.meta.env.PORT")
    || content.includes("process.env['PORT']")
    || content.includes('process.env["PORT"]')
    || content.includes("os.getenv(\"PORT\")")
    || content.includes("os.getenv('PORT')")
  );
}

function containsHardcodedPortSignal(content: string): boolean {
  return (
    /listen\s*\(\s*(3000|3001|4000|4173|5000|5173|8000|8080)\b/.test(content)
    || /\blisten\s*\(\s*port\b/.test(content)
    || /\bapp\.listen\s*\(/.test(content)
    || /\bserver\.listen\s*\(/.test(content)
    || /\bconst\s+port\s*=\s*(3000|3001|4000|4173|5000|5173|8000|8080)\b/.test(content)
    || /\blet\s+port\s*=\s*(3000|3001|4000|4173|5000|5173|8000|8080)\b/.test(content)
  );
}

function safeReadText(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function isConfigLikeFile(relativePath: string): boolean {
  const base = path.basename(relativePath);
  return base.includes(".config.") || base.endsWith(".properties") || base.endsWith(".yaml") || base.endsWith(".yml");
}

function appendCliPortArgs(
  originalArgs: string[],
  framework: string,
  port: number
): string[] {
  const args = [...originalArgs];

  switch (framework) {
    case "nextjs":
      return [...args, "-p", String(port)];
    case "django":
      return [...args, `0.0.0.0:${port}`];
    case "uvicorn":
      return [...args, "--port", String(port)];
    case "flask":
    case "rails":
      return [...args, "-p", String(port)];
    default:
      return [...args, "--port", String(port)];
  }
}

function buildEnvPatch(framework: string, port: number): Record<string, string> {
  switch (framework) {
    case "spring-boot":
      return { SERVER_PORT: String(port) };
    case "aspnet-core":
      return { ASPNETCORE_URLS: `http://127.0.0.1:${port}` };
    case "cra":
      return {
        PORT: String(port),
        WDS_SOCKET_PORT: String(port)
      };
    case "remix":
      return {
        PORT: String(port),
        REMIX_DEV_ORIGIN: `http://127.0.0.1:${port}`
      };
    default:
      return { PORT: String(port) };
  }
}

function buildOverrideEnvPatch(framework: string, port: number): Record<string, string> {
  switch (framework) {
    case "nuxt":
      return {
        PORT: String(port),
        NUXT_PORT: String(port)
      };
    case "vue-cli":
      return {
        PORT: String(port),
        WDS_SOCKET_PORT: String(port)
      };
    case "laravel":
      return {
        PORT: String(port),
        APP_PORT: String(port)
      };
    default:
      return {
        PORT: String(port)
      };
  }
}

function buildOverrideArtifactRef(framework: string, serviceId: string, port: number): string {
  return `override://${framework}/${serviceId}?port=${port}`;
}
