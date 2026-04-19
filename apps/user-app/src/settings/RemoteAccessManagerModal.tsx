import { useId, useState } from "react";

import { MobileSheet } from "../components/MobileSheet";
import { ModalSection } from "../components/ModalAtoms";
import { WorkbenchModal } from "../features/conversation/components/WorkbenchModal";
import { t } from "../shared/i18n";
import { RelayTunnelPanel } from "./RelayTunnelPanel";
import { TailscalePanel } from "./TailscalePanel";

type RemoteAccessTabId = "tunnel" | "tailscale";

interface RemoteAccessManagerModalProps {
  readonly open: boolean;
  readonly mobile: boolean;
  readonly onClose: () => void;
}

export function RemoteAccessManagerModal({
  open,
  mobile,
  onClose
}: RemoteAccessManagerModalProps) {
  const [activeTab, setActiveTab] = useState<RemoteAccessTabId>("tunnel");
  const tabsBaseId = useId();
  const tabs: Array<{ id: RemoteAccessTabId; label: string }> = [
    {
      id: "tunnel",
      label: t("settings.remoteAccessTunnelTab")
    },
    {
      id: "tailscale",
      label: t("settings.remoteAccessTailscaleTab")
    }
  ];

  const content = (
    <>
      <div
        className="settings-model-tabs"
        role="tablist"
        aria-label={t("settings.remoteAccessTabsLabel")}
      >
        {tabs.map((tab) => {
          const tabId = `${tabsBaseId}-${tab.id}-tab`;
          const panelId = `${tabsBaseId}-${tab.id}-panel`;
          const active = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              id={tabId}
              type="button"
              role="tab"
              className="settings-model-tab"
              data-active={active ? "true" : undefined}
              aria-selected={active}
              aria-controls={panelId}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "tunnel" ? (
        <div
          id={`${tabsBaseId}-tunnel-panel`}
          aria-labelledby={`${tabsBaseId}-tunnel-tab`}
          role="tabpanel"
        >
          <ModalSection
            heading={t("settings.remoteAccessTunnelTab")}
            description={t("settings.relayTunnelDescription")}
          >
            <RelayTunnelPanel />
          </ModalSection>
        </div>
      ) : (
        <div
          id={`${tabsBaseId}-tailscale-panel`}
          aria-labelledby={`${tabsBaseId}-tailscale-tab`}
          role="tabpanel"
        >
          <ModalSection
            heading={t("settings.remoteAccessTailscaleTab")}
            description={t("settings.tailscaleSectionDescription")}
          >
            <TailscalePanel configMode="inline" />
          </ModalSection>
        </div>
      )}
    </>
  );

  if (mobile) {
    return (
      <MobileSheet
        open={open}
        title={t("settings.remoteAccessModalTitle")}
        description={t("settings.remoteAccessModalDescription")}
        height="full"
        kind="form"
        showHandle
        onClose={onClose}
      >
        {content}
      </MobileSheet>
    );
  }

  return (
    <WorkbenchModal
      open={open}
      title={t("settings.remoteAccessModalTitle")}
      description={t("settings.remoteAccessModalDescription")}
      size="wide"
      onClose={onClose}
    >
      {content}
    </WorkbenchModal>
  );
}
