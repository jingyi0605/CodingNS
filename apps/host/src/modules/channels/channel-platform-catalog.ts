import type { ChannelPlatformCapability, ChannelPlatformCode } from "../../types/domain.js";

const CHANNEL_PLATFORM_CAPABILITIES: readonly ChannelPlatformCapability[] = [
  {
    code: "wechat-claw",
    displayName: "个人微信（claw）",
    supportedConnectionModes: ["polling"],
    multiSessionSupportLevel: "limited",
    stageOneLimitations: [
      "官方标准接法是把 openclaw-weixin 插件挂到 Gateway 运行时里，不是让 Host 直接承担微信收发。",
      "当前仓库还没有接好这层官方运行时，所以个人微信（claw）账号先只保留平台位和管理位，不再伪装成已经支持扫码绑定、轮询和回发。"
    ]
  },
  {
    code: "telegram",
    displayName: "Telegram",
    supportedConnectionModes: ["polling"],
    multiSessionSupportLevel: "supported",
    stageOneLimitations: [
      "第一阶段先打通文本消息，不承诺文件和复杂交互。",
      "Telegram forum topic 已按 message_thread_id 区分 Butler control session，普通 chat 仍按 chat_id 映射。",
      "当前已经接入手动 poll 和后台轮询任务，后续再补更完整的消息类型支持。"
    ]
  }
] as const;

const CHANNEL_PLATFORM_CAPABILITY_MAP = new Map(
  CHANNEL_PLATFORM_CAPABILITIES.map((platform) => [platform.code, platform])
);

export function listChannelPlatformCapabilities(): ChannelPlatformCapability[] {
  return CHANNEL_PLATFORM_CAPABILITIES.map((platform) => ({
    ...platform,
    supportedConnectionModes: [...platform.supportedConnectionModes],
    stageOneLimitations: [...platform.stageOneLimitations]
  }));
}

export function getChannelPlatformCapability(
  platformCode: ChannelPlatformCode
): ChannelPlatformCapability | null {
  const capability = CHANNEL_PLATFORM_CAPABILITY_MAP.get(platformCode);

  return capability
    ? {
        ...capability,
        supportedConnectionModes: [...capability.supportedConnectionModes],
        stageOneLimitations: [...capability.stageOneLimitations]
      }
    : null;
}
