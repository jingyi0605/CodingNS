import type { PropsWithChildren, ReactNode } from "react";

import { t } from "../../../shared/i18n";

import type { ProviderCapabilitiesDto } from "../api/conversation-api";

export type ConversationCapabilityAction = "send_message" | "attachments" | "interrupt";

export interface CapabilityDecision {
  allowed: boolean;
  hidden: boolean;
  reason: string | null;
}

export function decideCapability(
  capabilities: ProviderCapabilitiesDto | null,
  action: ConversationCapabilityAction
): CapabilityDecision {
  if (!capabilities) {
    return {
      allowed: false,
      hidden: false,
      reason: t("conversation.capabilityDenied")
    };
  }

  switch (action) {
    case "send_message":
      return capabilities.canSendMessage === false
        ? {
            allowed: false,
            hidden: false,
            reason: t("conversation.capabilitySendDisabled")
          }
        : {
            allowed: true,
            hidden: false,
            reason: null
          };
    case "attachments":
      return capabilities.supportsAttachments
        ? { allowed: true, hidden: false, reason: null }
        : {
            allowed: false,
            hidden: false,
            reason: t("conversation.capabilityAttachmentDisabled")
          };
    case "interrupt":
      return capabilities.supportsInterrupt
        ? { allowed: true, hidden: false, reason: null }
        : {
            allowed: false,
            hidden: false,
            reason: t("conversation.capabilityInterruptDisabled")
          };
    default:
      return {
        allowed: false,
        hidden: false,
        reason: t("conversation.capabilityDenied")
      };
  }
}

interface CapabilityGateProps extends PropsWithChildren {
  capabilities: ProviderCapabilitiesDto | null;
  action: ConversationCapabilityAction;
  fallback?: ReactNode;
}

export function CapabilityGate({
  capabilities,
  action,
  children,
  fallback = null
}: CapabilityGateProps) {
  const decision = decideCapability(capabilities, action);

  if (decision.hidden || !decision.allowed) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
