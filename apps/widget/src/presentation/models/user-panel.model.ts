import type { CheckoutExperienceSnapshot } from "@zyon/shared-types";
import type { BuyerHubSection } from "../../hooks/use-checkout-panels.js";
import type { useBuyerHub } from "../../hooks/use-buyer-hub.js";
import type { useGlobalAuth } from "../../hooks/use-global-auth.js";

export type UserPanelModel = {
  activeTab: BuyerHubSection;
  displayName: string;
  email: string;
  avatarLetter: string;
  colorMode: "light" | "dark";
  buyerHub: ReturnType<typeof useBuyerHub>;
  auth: ReturnType<typeof useGlobalAuth>;
  activeExperience: CheckoutExperienceSnapshot;
  onClose: () => void;
  onSelectTab: (tab: BuyerHubSection) => void;
  onToggleColorMode: () => void;
};
