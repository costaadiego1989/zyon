import { useCallback, useMemo } from "react";
import type { CheckoutAgentViewModel } from "./use-checkout-agent-view-model.js";
import { stripAgentMessagePrefix } from "./checkout-view-model.js";
import { useVoiceCheckout } from "./use-voice-checkout.js";
import {
  buildVoicePendingTurn,
  selectVoiceCheckoutPresentation,
} from "../presentation/selectors/voice-checkout.selector.js";
import { latestTurnText } from "../presentation/voice-turn-interpreter.js";

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

  const voice = useVoiceCheckout({
    enabled: !vm.showChannelWelcome,
    busy: vm.busy,
    composerLocked: vm.composerLocked,
    awaitingAgentPlayback: vm.awaitingAgentPlayback,
    latestAgentText,
    buildPendingTurn: (text) => buildVoicePendingTurn(vm, text),
    onConfirmTranscript: (text) => vm.sendMessageWithOverride(text),
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
