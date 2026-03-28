import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

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

export function registerStaticWebRoutes(app: FastifyInstance, publicDir: string): void {
  if (!existsSync(publicDir) || !statSync(publicDir).isDirectory()) {
    throw new Error(`未找到前端静态资源目录：${publicDir}`);
  }

  app.get("/", async (_request, reply) => {
    return serveFile(reply, path.join(publicDir, "index.html"));
  });

  app.get("/*", async (request, reply) => {
    const matchedPath = ((request.params as { "*": string } | undefined)?.["*"] ?? "").trim();
    const decodedPath = safelyDecodePath(matchedPath);

    if (!decodedPath) {
      return serveFile(reply, path.join(publicDir, "index.html"));
    }

    const resolvedPath = resolvePublicPath(publicDir, decodedPath);

    if (resolvedPath && existsSync(resolvedPath) && statSync(resolvedPath).isFile()) {
      return serveFile(reply, resolvedPath);
    }

    if (path.extname(decodedPath)) {
      reply.code(404).send();
      return;
    }

    return serveFile(reply, path.join(publicDir, "index.html"));
  });
}

function serveFile(reply: FastifyReply, filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES.get(extension) ?? "application/octet-stream";

  reply.header("Cache-Control", extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable");
  reply.type(contentType);
  return reply.send(createReadStream(filePath));
}

function safelyDecodePath(input: string): string {
  try {
    return decodeURIComponent(input).replace(/^\/+/, "");
  } catch {
    return "";
  }
}

function resolvePublicPath(publicDir: string, requestPath: string): string | null {
  const resolvedPath = path.resolve(publicDir, requestPath);
  const normalizedPublicDir = withTrailingSeparator(path.resolve(publicDir));

  if (resolvedPath === path.resolve(publicDir)) {
    return resolvedPath;
  }

  if (!withTrailingSeparator(resolvedPath).startsWith(normalizedPublicDir)) {
    return null;
  }

  return resolvedPath;
}

function withTrailingSeparator(input: string): string {
  return input.endsWith(path.sep) ? input : `${input}${path.sep}`;
}
