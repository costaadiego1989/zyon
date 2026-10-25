import { useEffect, useState } from "react";
import { useCheckoutStore } from "@/store/checkout-store";

// These attempts only read/reconcile the existing request. They never resend a
// buyer message, create a voice session, or call the model again.
const RETRY_DELAYS = [0, 1_000, 3_000, 7_000, 15_000, 30_000];
type ConnectionStatus = "reconnecting" | "offline" | "unavailable" | null;

export function useChatRecovery(): ConnectionStatus {
  const api = useCheckoutStore((s) => s.api);
  const pending = useCheckoutStore((s) => s.chatRecovery !== null);
  const recoverChat = useCheckoutStore((s) => s.recoverChat);
  const [status, setStatus] = useState<ConnectionStatus>(null);

  useEffect(() => {
    setStatus(null);
    if (!pending || !api) return;
    let disposed = false;
    let attempts = 0;
    let running = false;
    let noticeDue = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const available = () => navigator.onLine && document.visibilityState === "visible";
    const current = () => !disposed && useCheckoutStore.getState().api === api;
    const updateStatus = () => {
      if (!current()) return;
      setStatus(attempts >= RETRY_DELAYS.length && !running ? "unavailable"
        : !navigator.onLine ? "offline" : noticeDue ? "reconnecting" : null);
    };
    const schedule = () => {
      clearTimeout(retryTimer);
      if (!current() || !api.requiresChatRecovery || running) return;
      updateStatus();
      if (!available() || attempts >= RETRY_DELAYS.length) return;
      retryTimer = setTimeout(async () => {
        if (!current() || !available()) return;
        running = true;
        attempts += 1;
        await recoverChat();
        running = false;
        if (current()) schedule();
      }, RETRY_DELAYS[attempts]);
    };
    const noticeTimer = setTimeout(() => { noticeDue = true; updateStatus(); }, 1_500);
    const onConnectionChange = () => { updateStatus(); schedule(); };
    window.addEventListener("online", onConnectionChange);
    window.addEventListener("offline", onConnectionChange);
    document.addEventListener("visibilitychange", onConnectionChange);
    schedule();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearTimeout(noticeTimer);
      window.removeEventListener("online", onConnectionChange);
      window.removeEventListener("offline", onConnectionChange);
      document.removeEventListener("visibilitychange", onConnectionChange);
    };
  }, [api, pending, recoverChat]);

  return pending ? status : null;
}
