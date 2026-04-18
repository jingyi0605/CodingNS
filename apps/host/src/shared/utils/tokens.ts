import { randomBytes } from "node:crypto";

const BUTLER_RUNTIME_ACCESS_TOKEN_PREFIX = "butler_";

export function createOpaqueToken(prefix = ""): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

export function createButlerRuntimeAccessToken(): string {
  return createOpaqueToken(BUTLER_RUNTIME_ACCESS_TOKEN_PREFIX);
}

export function isButlerRuntimeAccessToken(token: string): boolean {
  return token.startsWith(BUTLER_RUNTIME_ACCESS_TOKEN_PREFIX) && token.length > BUTLER_RUNTIME_ACCESS_TOKEN_PREFIX.length;
}
