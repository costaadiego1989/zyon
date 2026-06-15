import type { CSSProperties } from "react";
import type { JourneyProtocolModel } from "../checkout-experience-model.js";
import type { CheckoutPanelsModel } from "./checkout-panels.model.js";
import type { VoiceCheckoutState } from "../../hooks/use-voice-checkout.js";

export type VoiceHeaderModel = {
  merchantName: string;
  orderTotalLabel: string;
  itemCountLabel: string;
  cartOpen: boolean;
  colorMode: "light" | "dark";
  onOpenCart: () => void;
  onToggleColorMode: () => void;
  onSwitchToChat: () => void;
};

export type VoiceStageModel = {
  agentGiven: string;
  agentAvatarUrl?: string;
  latestAgentText: string;
  latestBuyerText: string | null;
  voiceState: "speaking" | "listening" | "confirming" | "thinking" | "idle";
  busy: boolean;
  speaking: boolean;
  hint: string;
  micDisabled: boolean;
  listening: boolean;
  unsupported: boolean;
  pendingTurn: VoiceCheckoutState["pendingTurn"];
  quickReplies: CheckoutPanelsModel["quickReplies"];
};

export type VoiceOrderStripModel = {
  itemCountLabel: string;
  totalLabel: string;
  cartOpen: boolean;
  onOpenCart: () => void;
};

export type VoiceCheckoutPresentation = {
  style: CSSProperties;
  colorMode: "light" | "dark";
  checkoutStage: string;
  journey: JourneyProtocolModel;
  header: VoiceHeaderModel;
  voiceStage: VoiceStageModel;
  orderStrip: VoiceOrderStripModel;
  panels: CheckoutPanelsModel;
  showChannelWelcome: boolean;
  cartOpen: boolean;
  onCloseCart: () => void;
};
