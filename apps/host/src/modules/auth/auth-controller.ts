import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthClientType } from "../../types/domain.js";
import type {
  AuthContext,
  AuthService,
  LoginInput,
  LogoutInput,
  RefreshInput,
  UpdateCurrentDevicePrimaryInput
} from "./auth-service.js";
import { resolveAuthDeviceDisplayName } from "./auth-device-display-name.js";

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  readonly login = async (
    request: FastifyRequest<{ Body: LoginInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.authService.login(request.body, readAuthRequestMetadata(request)));
  };

  readonly refresh = async (
    request: FastifyRequest<{ Body: RefreshInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.authService.refresh(request.body, readAuthRequestMetadata(request)));
  };

  readonly logout = async (
    request: FastifyRequest<{ Body: LogoutInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    const accessToken = request.auth?.accessToken;

    if (!accessToken) {
      throw new Error("缺少 access token 上下文");
    }

    reply.send(this.authService.logout(accessToken, request.body));
  };

  readonly getDevices = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.send(this.authService.listDeviceManagement(requireAuthContext(request)));
  };

  readonly updateCurrentDevicePrimary = async (
    request: FastifyRequest<{ Body: UpdateCurrentDevicePrimaryInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.authService.updateCurrentDevicePrimary(requireAuthContext(request), request.body)
    );
  };

  readonly logoutOtherDevices = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(this.authService.logoutOtherDevices(requireAuthContext(request)));
  };

  readonly logoutDevice = async (
    request: FastifyRequest<{ Params: { deviceId: string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.authService.logoutDevice(requireAuthContext(request), request.params.deviceId)
    );
  };
}

const CLIENT_TYPE_HEADER = "x-codingns-client-type";
const CLIENT_INSTANCE_ID_HEADER = "x-codingns-client-instance-id";

function readAuthRequestMetadata(request: FastifyRequest): {
  clientType: AuthClientType;
  clientInstanceId: string | null;
  displayName: string | null;
  sourceAddress: string | null;
  userAgent: string | null;
} {
  const clientType = normalizeClientType(request.headers[CLIENT_TYPE_HEADER]);
  const userAgent = readUserAgent(request);

  return {
    clientType,
    clientInstanceId: normalizeClientInstanceId(request.headers[CLIENT_INSTANCE_ID_HEADER]),
    displayName: resolveAuthDeviceDisplayName(clientType, userAgent),
    sourceAddress: readSourceAddress(request),
    userAgent
  };
}

function normalizeClientType(raw: string | string[] | undefined): AuthClientType {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();

  if (
    value === "desktop"
    || value === "web"
    || value === "ios"
    || value === "android"
  ) {
    return value;
  }

  return "unknown";
}

function normalizeClientInstanceId(raw: string | string[] | undefined): string | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value ? value : null;
}

function readSourceAddress(request: FastifyRequest): string | null {
  const forwarded = request.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;

  if (typeof forwardedValue === "string" && forwardedValue.trim().length > 0) {
    return forwardedValue.split(",")[0]?.trim() || null;
  }

  return request.ip?.trim() || null;
}

function readUserAgent(request: FastifyRequest): string | null {
  const userAgent = request.headers["user-agent"];
  const value = Array.isArray(userAgent) ? userAgent[0] : userAgent;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function requireAuthContext(request: FastifyRequest): AuthContext {
  if (!request.auth) {
    throw new Error("缺少登录态上下文");
  }

  return request.auth;
}
