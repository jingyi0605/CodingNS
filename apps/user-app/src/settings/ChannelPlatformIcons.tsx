import type { SVGProps } from "react";

import type { ChannelPlatformCode } from "../features/settings/api/channels-api";

type IconProps = SVGProps<SVGSVGElement>;

interface ChannelPlatformIconProps extends IconProps {
  readonly code: ChannelPlatformCode;
}

export function ChannelPlatformIcon({ code, ...props }: ChannelPlatformIconProps) {
  switch (code) {
    case "wechat-claw":
      return <WechatClawIcon {...props} />;
    case "telegram":
      return <TelegramIcon {...props} />;
    default:
      return <GenericChannelIcon {...props} />;
  }
}

function TelegramIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 64 64" fill="none" {...props}>
      <circle cx="32" cy="32" r="30" fill="#2AABEE" />
      <path
        fill="#fff"
        d="M47.8 18.8 15.6 31.2c-2.2.9-2.2 2.1-.4 2.6l8.3 2.6 19.2-12.1c.9-.6 1.8-.3 1.1.4L28.3 38.7l-.6 8.6c.9 0 1.3-.4 1.9-.9l4-3.9 8.3 6.1c1.6.9 2.7.4 3.1-1.5l5.4-25.4c.6-2.3-.9-3.4-2.6-2.9Z"
      />
    </svg>
  );
}

function WechatClawIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 64 64" fill="none" {...props}>
      <rect width="64" height="64" rx="18" fill="#07C160" />
      <path
        fill="#fff"
        d="M27.5 18c-8 0-14.5 5.6-14.5 12.4 0 3.8 2 7.3 5.4 9.6l-1.7 5 5.6-2.8c1.7.4 3.4.6 5.2.6 8 0 14.5-5.6 14.5-12.4S35.5 18 27.5 18Zm-5.1 10.6a1.9 1.9 0 1 1 0 3.9 1.9 1.9 0 0 1 0-3.9Zm10.2 0a1.9 1.9 0 1 1 0 3.9 1.9 1.9 0 0 1 0-3.9Z"
      />
      <path
        fill="#E7FFF1"
        d="M44 28.7c-5.2 0-9.4 3.7-9.4 8.2 0 4.6 4.2 8.2 9.4 8.2 1.1 0 2.2-.2 3.3-.5l3.7 1.8-1.1-3.3a8 8 0 0 0 3.5-6.2c0-4.5-4.2-8.2-9.4-8.2Zm-3.3 6.5a1.3 1.3 0 1 1 0 2.7 1.3 1.3 0 0 1 0-2.7Zm6.6 0a1.3 1.3 0 1 1 0 2.7 1.3 1.3 0 0 1 0-2.7Z"
      />
      <path
        fill="#0E9B53"
        d="M42.5 19.2c4 1.5 6.8 4.4 7.9 8.1-1.8-.8-3.9-1.3-6.1-1.3-1.8 0-3.6.3-5.1.8.9-3.1 1.9-5.2 3.3-7.6Z"
      />
    </svg>
  );
}

function GenericChannelIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 64 64" fill="none" {...props}>
      <rect width="64" height="64" rx="18" fill="#1F2937" />
      <path
        fill="#fff"
        d="M20 22.5A6.5 6.5 0 0 1 26.5 16h11A6.5 6.5 0 0 1 44 22.5v12A6.5 6.5 0 0 1 37.5 41H30l-7.4 6.2c-1 .8-2.6.1-2.6-1.2V22.5Z"
      />
    </svg>
  );
}
