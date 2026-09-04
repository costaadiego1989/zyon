import { useCallback, useMemo, useState } from "react";
import { useCheckoutStore } from "@/store/checkout-store";
import { confirmCryptoPayment as confirmCryptoPaymentApi } from "@/api/payment";
import { reportError } from "@/lib/error-handler";
import type { ChatViewModelInterface, CryptoStep, Message } from "@/viewModels/types";

type Store = typeof useCheckoutStore;

export function useChatViewModel(store: Store = useCheckoutStore): ChatViewModelInterface {
  const storeMessages = store((s) => s.messages);
  const isTyping = store((s) => s.isTyping);
  const api = store((s) => s.api);
  const paymentIntent = store((s) => s.paymentIntent);
  const storeSendMessage = store((s) => s.sendMessage);
  const pollPayment = store((s) => s.pollPayment);
  const resetSession = store((s) => s.resetSession);

  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setStep] = useState<CryptoStep>("idle");
  const [wallet, setWallet] = useState("");

  const messages = useMemo<Message[]>(
    () =>
      storeMessages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text ?? "",
        timestamp: m.timestamp,
      })),
    [storeMessages],
  );

  const loading = isTyping;

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setError(null);
      try {
        await storeSendMessage(trimmed);
        setInput("");
      } catch (err) {
        const { message } = reportError(err, "useChatViewModel.sendMessage");
        setError(message);
      }
    },
    [storeSendMessage],
  );

  const clearHistory = useCallback(() => {
    setError(null);
    resetSession();
  }, [resetSession]);

  const connectWallet = useCallback(async (_chain: string) => {
    setError(null);
    setStep("connecting");
    try {
      const eth = (window as unknown as { ethereum?: { request: (args: { method: string }) => Promise<string[]> } }).ethereum;
      if (!eth) {
        throw new Error("MetaMask não encontrada. Instale a extensão para pagar com crypto.");
      }
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      const account = accounts?.[0];
      if (!account) {
        throw new Error("Nenhuma carteira conectada.");
      }
      setWallet(account);
      setStep("connected");
    } catch (err) {
      const { message } = reportError(err, "useChatViewModel.connectWallet");
      setError(message);
      setStep("idle");
    }
  }, []);

  const confirmCryptoPayment = useCallback(
    async (txHash: string) => {
      setError(null);
      setStep("confirming");
      try {
        if (!api) throw new Error("session_not_started");
        const sessionId = api.currentSessionId;
        if (!sessionId) throw new Error("session_not_started");
        if (!paymentIntent?.intent_id) throw new Error("payment_intent_missing");
        if (!wallet) throw new Error("wallet_not_connected");

        const result = await confirmCryptoPaymentApi(api, {
          paymentIntentId: paymentIntent.intent_id,
          sessionId,
          txHash,
          walletAddress: wallet,
        });
        if (!result.ok) {
          throw new Error(`crypto_confirm_failed: ${result.status}`);
        }
        setStep("confirmed");
        pollPayment();
      } catch (err) {
        const { message } = reportError(err, "useChatViewModel.confirmCryptoPayment");
        setError(message);
        setStep("connected");
      }
    },
    [api, paymentIntent, wallet, pollPayment],
  );

  const disconnectWallet = useCallback(() => {
    setWallet("");
    setStep("idle");
    setError(null);
  }, []);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  const isProcessing = useMemo(
    () => loading || currentStep === "connecting" || currentStep === "confirming",
    [loading, currentStep],
  );

  return {
    messages,
    input,
    loading,
    error,
    currentStep,
    wallet,
    setInput,
    sendMessage,
    clearHistory,
    connectWallet,
    confirmCryptoPayment,
    disconnectWallet,
    canSend,
    isProcessing,
  };
}
