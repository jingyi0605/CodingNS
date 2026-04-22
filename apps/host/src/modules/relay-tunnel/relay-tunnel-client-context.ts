/**
 * 公共隧道会话里由中继侧透传过来的客户端上下文。
 * 这里单独在 host 侧定义一份，避免 host 构建时硬耦合 codingns-proxy 子工作区。
 */
export interface RelaySessionClientContext {
  sourceIp: string | null;
  forwardedFor: string | null;
  userAgent: string | null;
  runtimePlatform: string | null;
  systemPlatform: string | null;
  language: string | null;
  timezone: string | null;
}
