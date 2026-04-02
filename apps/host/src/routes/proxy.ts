import type { FastifyInstance } from "fastify";

import type { TemplateReverseProxyService } from "../modules/terminal/template-reverse-proxy-service.js";

export async function registerProxyRoutes(
  app: FastifyInstance,
  templateReverseProxyService: TemplateReverseProxyService
): Promise<void> {
  app.register(async (proxyApp) => {
    // 代理路由需要原始请求体，避免被 Fastify 默认 parser 预消费后破坏 multipart/stream。
    proxyApp.removeAllContentTypeParsers();
    proxyApp.addContentTypeParser("*", (_request, payload, done) => {
      done(null, payload);
    });

    proxyApp.route({
      method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      url: "/proxy/:proxySlug",
      handler: async (request, reply) => {
        await templateReverseProxyService.handleHttpProxy(request, reply);
      }
    });

    proxyApp.route({
      method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      url: "/proxy/:proxySlug/*",
      handler: async (request, reply) => {
        await templateReverseProxyService.handleHttpProxy(request, reply);
      }
    });
  });
}
