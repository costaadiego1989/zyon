import { useCallback, useMemo } from "react";
import type { CheckoutAgentViewModel } from "./use-checkout-agent-view-model.js";
import {
  matchShippingOptionFromLabel,
  normalizeQuickReplyLabel,
  stripAgentMessagePrefix,
  type QuickReplyChoice,
} from "./checkout-presentation.js";
import { useVoiceCheckout } from "./use-voice-checkout.js";
import {
  buildVoicePendingTurn,
  selectVoiceCheckoutPresentation,
} from "../presentation/selectors/voice-checkout.selector.js";
import { latestTurnText, normalizeVoiceText } from "../presentation/voice-turn-interpreter.js";

function hasWholeWord(text: string, token: string): boolean {
  return new RegExp(`(^|\\s)${token}(\\s|$)`).test(text);
}

function matchesVoiceQuickReply(transcript: string, reply: QuickReplyChoice): boolean {
  const heard = normalizeVoiceText(transcript).replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  const label = normalizeQuickReplyLabel(reply.label).replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  const rawLabel = reply.label.toLowerCase();
  if (!heard || !label) return false;
  if (heard === label || heard.includes(label)) return true;

  const heardWantsCard = /\bcartao\b|\bcredito\b|\bdebito\b/.test(heard);
  const labelOffersCard = /cart|cr[eéÃ]|d[eéÃ]/i.test(rawLabel) || /\bcartao\b|\bcredito\b|\bdebito\b/.test(label);
  if (heardWantsCard && labelOffersCard) return true;

  const heardWantsPix = /\bpix\b/.test(heard);
  const labelOffersPix = /\bpix\b/i.test(rawLabel) || /\bpix\b/.test(label);
  if (heardWantsPix && labelOffersPix) return true;

  const heardMentionsCoupon = /\bcupom\b/.test(heard);
  const labelMentionsCoupon = /cupom/i.test(rawLabel) || /\bcupom\b/.test(label);
  if (heardMentionsCoupon && labelMentionsCoupon) return true;

  if (label.length <= 3) return hasWholeWord(heard, label);
  if (/^(nao|sem)\b.*\bcupom\b/.test(heard) && /^n(a|ã|Ã)/i.test(rawLabel)) return true;
  if (/^(sim|tenho|usar|informar)\b.*\bcupom\b/.test(heard) && /^sim\b/i.test(rawLabel)) return true;

  const compactLabel = label
    .replace(/\b(pagar|pagamento|com|de|do|da|credito|debito|desconto)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return compactLabel.length >= 4 && heard.includes(compactLabel);
}

export function useVoiceCheckoutExperience(vm: CheckoutAgentViewModel) {
  const agentName = vm.theme.agentName || vm.activeExperience.agent.name;
  const latestAgentRaw = useMemo(() => latestTurnText(vm.turns, "agent"), [vm.turns]);
  const latestAgentText = useMemo(() => {
    if (!latestAgentRaw) {
      return (
        vm.activeExperience.agent.greeting ||
        "Vou conduzir sua compra por voz. Pode falar comigo."
      );
    }
    return stripAgentMessagePrefix(latestAgentRaw, agentName);
  }, [agentName, latestAgentRaw, vm.activeExperience.agent.greeting]);

  const confirmVoiceTranscript = useCallback(
    async (text: string) => {
      const heard = normalizeVoiceText(text);
      const quickReply = vm.quickReplies.find((reply) => matchesVoiceQuickReply(text, reply));
      if (quickReply) {
        await vm.tapQuick(quickReply);
        return;
      }

      if (vm.checkoutStage === "shipping" && vm.lastChat?.missing_fields?.[0] === "frete") {
        const shippingOption = matchShippingOptionFromLabel(text, vm.shippingOptions);
        if (shippingOption) {
          await vm.tapShippingOption(shippingOption);
          return;
        }
      }

      if (vm.checkoutStage === "payment") {
        if (/\bpix\b/.test(heard)) {
          await vm.tapQuick({ label: "PIX" });
          return;
        }
        if (/\bcartao\b|\bcredito\b|\bdebito\b/.test(heard)) {
          await vm.tapQuick({ label: "Cartão de crédito" });
          return;
        }
        if (/^(nao|sem)\b.*\bcupom\b|^nao$/.test(heard)) {
          await vm.tapQuick({ label: "Não" });
          return;
        }
        if (/^(sim|tenho|usar|informar)\b.*\bcupom\b|^sim$/.test(heard)) {
          await vm.tapQuick({ label: "Sim" });
          return;
        }
      }

      await vm.sendMessageWithOverride(text);
    },
    [vm],
  );

  const voice = useVoiceCheckout({
    enabled: !vm.showChannelWelcome,
    busy: vm.busy,
    composerLocked: vm.composerLocked,
    awaitingAgentPlayback: vm.awaitingAgentPlayback,
    agentPlaybackKey: vm.streamingTurnKey,
    latestAgentText,
    buildPendingTurn: (text) => buildVoicePendingTurn(vm, text),
    onConfirmTranscript: confirmVoiceTranscript,
    onAgentPlaybackDone: vm.handleAgentTypingDone,
  });

  const switchToChat = useCallback(() => {
    voice.stopAll();
    voice.discardPendingTurn();
    vm.selectPurchaseChannel("chat");
  }, [voice, vm]);

  const editPendingTurnInChat = useCallback(() => {
    if (voice.pendingTurn) {
      vm.setMessage(voice.pendingTurn.rawTranscript);
    }
    switchToChat();
  }, [voice, vm, switchToChat]);

  const handleMicPress = useCallback(() => {
    if (voice.unsupported) {
      switchToChat();
      return;
    }
    voice.handleMicPress();
  }, [voice, switchToChat]);

  const presentation = useMemo(
    () => selectVoiceCheckoutPresentation(vm, voice),
    [
      vm,
      voice.listening,
      voice.speaking,
      voice.unsupported,
      voice.hint,
      voice.pendingTurn,
      voice.stopAll,
      voice.discardPendingTurn,
      voice.confirmPendingTurn,
      voice.retryPendingTurn,
      voice.replayAgentLine,
      voice.handleMicPress,
    ],
  );

  return {
    presentation: {
      ...presentation,
      header: {
        ...presentation.header,
        onSwitchToChat: switchToChat,
      },
    },
    voice,
    actions: {
      switchToChat,
      editPendingTurnInChat,
      handleMicPress,
      confirmPendingTurn: voice.confirmPendingTurn,
      retryPendingTurn: voice.retryPendingTurn,
      replayAgentLine: voice.replayAgentLine,
    },
  };
}
