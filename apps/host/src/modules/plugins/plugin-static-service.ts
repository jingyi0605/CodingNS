import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyReply } from "fastify";

import { AppError } from "../../shared/errors/app-error.js";
import type { PluginManifest } from "../../types/domain.js";
import type { PluginRegistryService } from "./plugin-registry-service.js";

const CONTENT_TYPES = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".ttf", "font/ttf"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"]
]);

export class PluginStaticService {
  constructor(private readonly pluginRegistryService: PluginRegistryService) {}

  buildFrontendBasePath(pluginId: string): string {
    return `/preview/plugins/${encodeURIComponent(pluginId)}/frontend/`;
  }

  buildFrontendEntryUrl(pluginId: string, manifest: PluginManifest): string {
    if (!manifest.frontend?.entry) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PLUGIN_FRONTEND_NOT_FOUND",
        detail: "当前插件没有前端入口"
      });
    }

    return `${this.buildFrontendBasePath(pluginId)}${encodePluginRelativePath(manifest.frontend.entry)}`;
  }

  serveFrontendAsset(pluginId: string, relativePath: string, reply: FastifyReply) {
    const detail = this.pluginRegistryService.getPlugin(pluginId);

    if (!detail.enablement.enabled) {
      throw new AppError({
        statusCode: 403,
        errorCode: "PLUGIN_DISABLED",
        detail: "当前插件已禁用"
      });
    }

    if (!detail.manifest.frontend) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PLUGIN_FRONTEND_NOT_FOUND",
        detail: "当前插件没有前端资源"
      });
    }

    const requestedRelativePath = relativePath.trim() || detail.manifest.frontend.entry;
    const assetPath = resolvePluginAssetPath(detail.definition.installRoot, requestedRelativePath);
    if (!existsSync(assetPath) || !statSync(assetPath).isFile()) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PLUGIN_FRONTEND_ASSET_NOT_FOUND",
        detail: "未找到对应插件资源"
      });
    }

    const extension = path.extname(assetPath).toLowerCase();
    const contentType = CONTENT_TYPES.get(extension) ?? "application/octet-stream";
    const csp = buildPluginCsp(detail.manifest, pluginId);

    reply.header("Cache-Control", extension === ".html" ? "no-cache" : "public, max-age=3600");
    reply.header("Content-Security-Policy", csp);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.type(contentType);
    return reply.send(createReadStream(assetPath));
  }

  serveRuntimeSdk(reply: FastifyReply) {
    reply.header("Cache-Control", "no-cache");
    reply.header("Content-Security-Policy", "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'none'; img-src 'none'; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.type("text/javascript; charset=utf-8");
    return reply.send(readFileSync(resolveRuntimeSdkPath(), "utf8"));
  }
}

function resolvePluginAssetPath(installRoot: string, relativePath: string): string {
  const decodedPath = safelyDecodePath(relativePath);
  const resolvedPath = path.resolve(installRoot, decodedPath);
  const normalizedRoot = withTrailingSeparator(path.resolve(installRoot));

  if (!withTrailingSeparator(resolvedPath).startsWith(normalizedRoot)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "PLUGIN_FRONTEND_PATH_OUT_OF_ROOT",
      detail: "插件前端资源路径超出插件目录边界"
    });
  }

  return resolvedPath;
}

function buildPluginCsp(manifest: PluginManifest, pluginId: string): string {
  const connectSrc = manifest.permissions.network
    ? `'self' data: blob: https: http:`
    : `'self'`;
  const sdkPath = `/preview/plugins/runtime-sdk.js`;
  const pluginBase = `/preview/plugins/${encodeURIComponent(pluginId)}/frontend/`;

  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    `child-src 'self'`,
    `script-src-elem 'self' 'unsafe-inline' ${sdkPath} ${pluginBase}`
  ].join("; ");
}

function encodePluginRelativePath(relativePath: string): string {
  return relativePath
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function safelyDecodePath(input: string): string {
  return input
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

function withTrailingSeparator(input: string): string {
  return input.endsWith(path.sep) ? input : `${input}${path.sep}`;
}

function resolveRuntimeSdkPath(): string {
  return fileURLToPath(new URL("./runtime/plugin-runtime-sdk.js", import.meta.url));
}
