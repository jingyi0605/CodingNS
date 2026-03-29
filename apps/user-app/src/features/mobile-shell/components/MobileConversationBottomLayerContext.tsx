import { createContext, useContext, type ReactNode } from "react";

interface MobileConversationBottomLayerContextValue {
  composerPortalTarget: HTMLElement | null;
}

const MobileConversationBottomLayerContext = createContext<MobileConversationBottomLayerContextValue>({
  composerPortalTarget: null
});

export function MobileConversationBottomLayerProvider({
  composerPortalTarget,
  children
}: {
  composerPortalTarget: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <MobileConversationBottomLayerContext.Provider
      value={{
        composerPortalTarget
      }}
    >
      {children}
    </MobileConversationBottomLayerContext.Provider>
  );
}

export function useMobileConversationBottomLayer() {
  return useContext(MobileConversationBottomLayerContext);
}
