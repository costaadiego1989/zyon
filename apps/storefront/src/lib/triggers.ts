// Trigger detection for the storefront store agent.
// This is a direct port of the checkout widget_v2 implementation
// (apps/widget_v2/src/lib/triggers.ts), which works reliably in production.
// Same event targets, same clientY<=5 exit rule, same idle activity set.
"use client";

export type TriggerName = "idle_30_seconds" | "exit_intent_detected";

export interface TriggerConfig {
  /** Seconds of inactivity before the idle trigger fires (default 30). */
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

/**
 * Idle timer — identical to the checkout widget: any of the activity events resets
 * a 30s countdown; when it elapses, fire. Not mouse-exit dependent.
 */
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
  resetIdle(); // start timer

  return () => {
    if (idleTimer) clearTimeout(idleTimer);
    events.forEach((e) => document.removeEventListener(e, resetIdle));
  };
}

/**
 * Exit-intent — identical to the checkout widget: document 'mouseleave' with the
 * cursor near the top of the viewport (clientY <= 5). Fires once; caller re-arms.
 */
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
