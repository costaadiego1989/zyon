import { useEffect, useRef } from "react";
import type { CheckoutSession } from "../api/checkout-session";
import type { ChatDisplayReference } from "../api/chat-protocol";

/** v1: at least 1% of the text area intersects the viewport for 500ms while
 * the document is visible. Client report, not proof of reading/attention.
 * No storage, buyer UI, background retries or checkout side effects. */
export function useChatDisplay(api: CheckoutSession | null, reference: ChatDisplayReference | undefined, text: string | undefined) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = element.current;
    if (!api || !reference || !text || !node || !globalThis.IntersectionObserver) return;
    let visible = false, disposed = false, finished = false, busy = false, attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => { if (timer) clearTimeout(timer); timer = undefined; };
    const eligible = () => visible && document.visibilityState === "visible" && navigator.onLine;
    const schedule = () => {
      clear();
      if (disposed || finished || busy || attempts >= 3 || !eligible()) return;
      timer = setTimeout(async () => {
        timer = undefined;
        if (disposed || !eligible()) return;
        busy = true; attempts += 1;
        try { await api.reportChatDisplay(reference, text); finished = true; }
        catch { /* bounded telemetry retry; commerce continues normally */ }
        finally { busy = false; schedule(); }
      }, attempts === 0 ? 500 : attempts * 1500);
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.target === node && entry.isIntersecting && entry.intersectionRatio >= .01
        && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0);
      schedule();
    }, { threshold: .01 });
    observer.observe(node);
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("online", schedule);
    window.addEventListener("offline", schedule);
    return () => {
      disposed = true; clear(); observer.disconnect();
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("online", schedule); window.removeEventListener("offline", schedule);
    };
  }, [api, reference?.turn_id, reference?.text_hash, text]);
  return element;
}
