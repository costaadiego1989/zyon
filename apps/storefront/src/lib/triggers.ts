"use client";

export type TriggerName = "idle_30_seconds" | "exit_intent_detected";

export interface TriggerConfig {
  idleSeconds?: number;
  apiBaseUrl?: string;
  merchantId?: string;
  sessionId?: string;
}

let idleTimer: ReturnType<typeof setTimeout> | null = null;

function reportTriggerEvent(triggerName: TriggerName, config: TriggerConfig): void {
  if (!config.sessionId || !config.merchantId) return;
  const apiUrl = config.apiBaseUrl || "http://localhost:3009";
  try {
    fetch(`${apiUrl}/checkout/track-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: config.merchantId,
        session_id: config.sessionId,
        event: triggerName,
        metadata: { timestamp: new Date().toISOString() },
      }),
    }).catch(() => {});
  } catch {
    /* triggers must never break the page */
  }
}

export function setupIdleTrigger(
  config: TriggerConfig,
  onTrigger: (t: TriggerName) => void,
): () => void {
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      onTrigger("idle_30_seconds");
      reportTriggerEvent("idle_30_seconds", config);
    }, (config.idleSeconds ?? 30) * 1000);
  };
  const events = ["mousemove", "keydown", "scroll", "click", "touchstart"];
  events.forEach((e) => document.addEventListener(e, resetIdle, { passive: true }));
  resetIdle();
  return () => {
    if (idleTimer) clearTimeout(idleTimer);
    events.forEach((e) => document.removeEventListener(e, resetIdle));
  };
}
export function setupExitIntentTrigger(
  config: TriggerConfig,
  onTrigger: (t: TriggerName) => void,
): () => void {
  let fired = false;
  const handler = (e: MouseEvent) => {
    if (fired) return;
    if (e.clientY <= 5) {
      fired = true;
      onTrigger("exit_intent_detected");
      reportTriggerEvent("exit_intent_detected", config);
    }
  };
  document.addEventListener("mouseleave", handler);
  return () => document.removeEventListener("mouseleave", handler);
}
