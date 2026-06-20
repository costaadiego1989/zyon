import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import {
  agentGivenAndRest,
  formatCurrency,
  stripAgentMessagePrefix,
} from "../../hooks/checkout-presentation.js";
import type { VoiceCheckoutState } from "../../hooks/use-voice-checkout.js";
import {
  selectCheckoutExperiencePresentation,
  selectJourneyProtocol,
} from "../checkout-experience-model.js";
import type { VoiceCheckoutPresentation } from "../models/voice-checkout.model.js";
import { selectCheckoutPanels } from "./checkout-panels.selector.js";
import {
  buildVoiceTurnContext,
  describePendingVoiceTurn,
  latestTurnText,
  resolveVoiceState,
} from "../voice-turn-interpreter.js";

export function selectVoiceCheckoutPresentation(
  vm: CheckoutAgentViewModel,
  voice: VoiceCheckoutState,
): VoiceCheckoutPresentation {
  const base = selectCheckoutExperiencePresentation(vm);
  const agentName = vm.theme.agentName || vm.activeExperience.agent.name;
  const agentGiven = agentGivenAndRest(agentName).given || agentName;
  const latestAgentRaw = latestTurnText(vm.turns, "agent");
  const latestAgentText = latestAgentRaw
    ? stripAgentMessagePrefix(latestAgentRaw, agentName)
    : vm.activeExperience.agent.greeting || "Vou conduzir sua compra por voz. Pode falar comigo.";
  const latestBuyerText = latestTurnText(vm.turns, "buyer");
  const itemCountLabel = vm.cartItemCount === 1 ? "1 item" : `${vm.cartItemCount} itens`;
  const voiceState = resolveVoiceState({
    speaking: voice.speaking,
    listening: voice.listening,
    hasPendingTurn: Boolean(voice.pendingTurn),
    busy: vm.busy,
  });
  const micDisabled =
    vm.busy || vm.composerLocked || voice.speaking || Boolean(voice.pendingTurn);

  return {
    style: base.style,
    colorMode: base.colorMode,
    checkoutStage: base.stage,
    journey: selectJourneyProtocol(vm.checkoutStage),
    header: {
      merchantName: vm.activeExperience.brand.name,
      orderTotalLabel: formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency),
      itemCountLabel,
      cartOpen: vm.cartOpen,
      colorMode: vm.colorMode,
      onOpenCart: () => vm.setCartOpen(true),
      onToggleColorMode: vm.toggleColorMode,
      onSwitchToChat: () => {},
    },
    voiceStage: {
      agentGiven,
      agentAvatarUrl: vm.theme.agentAvatarUrl,
      latestAgentText,
      latestBuyerText,
      voiceState,
      busy: vm.busy,
      speaking: voice.speaking,
      hint: voice.hint,
      micDisabled,
      listening: voice.listening,
      unsupported: voice.unsupported,
      pendingTurn: voice.pendingTurn,
      quickReplies: selectCheckoutPanels(vm, {
        variant: "voice",
        hasPendingTurn: Boolean(voice.pendingTurn),
      }).quickReplies,
    },
    orderStrip: {
      itemCountLabel,
      totalLabel: formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency),
      cartOpen: vm.cartOpen,
      onOpenCart: () => vm.setCartOpen(true),
    },
    panels: (() => {
      // Panel parity (ADR §11.1.3): voice renders the SAME action-panel stack as
      // chat (frete, cupom, cross-sell, cartão, crypto) by building it with the
      // thread variant — one visual source of truth. Quick replies are surfaced
      // as voice chips on the stage instead, so we null them here.
      const all = selectCheckoutPanels(vm, { variant: "thread" });
      return { ...all, quickReplies: null };
    })(),
    showChannelWelcome: vm.showChannelWelcome,
    cartOpen: vm.cartOpen,
    onCloseCart: () => vm.setCartOpen(false),
  };
}

export function buildVoicePendingTurn(
  vm: CheckoutAgentViewModel,
  transcript: string,
) {
  return describePendingVoiceTurn(buildVoiceTurnContext(vm), transcript);
}
