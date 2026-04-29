import { AppError } from "../../shared/errors/app-error.js";

export const WECHAT_CLAW_RUNTIME_REQUIRED_DETAIL =
  "当前项目还没有把个人微信（claw）helper 接进 Host，Host 不能直接承担扫码绑定、轮询收信和消息回发。";

export function createWechatClawRuntimeRequiredError(): AppError {
  return new AppError({
    statusCode: 501,
    errorCode: "CHANNEL_PLATFORM_RUNTIME_REQUIRED",
    detail: WECHAT_CLAW_RUNTIME_REQUIRED_DETAIL
  });
}

export function isWechatClawRuntimeIntegrated(runtimeClient: unknown): boolean {
  return Boolean(runtimeClient);
}
