"use client";

import { conversationFetch } from "@/lib/conversation-access";
import { getValidBuyer } from "@/lib/buyer-auth";

export type TriggerName = "idle_30_seconds" | "exit_intent_detected";

export interface TriggerConfig {
  idleSeconds?: number;
  apiBaseUrl?: string;
  merchantId?: string;
  sessionId?: string;
}

export interface IdleActivity {
  lastActivityAt: number;
  triggered: boolean;
}

function reportTriggerEvent(triggerName: TriggerName, config: TriggerConfig): void {
  if (!config.sessionId || !config.merchantId) return;
  const apiUrl = config.apiBaseUrl || "http://localhost:3009";
  try {
    const buyerToken = getValidBuyer()?.token;
    conversationFetch(config.sessionId, `${apiUrl}/storefront/conversations/${encodeURIComponent(config.sessionId)}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(buyerToken ? { "X-Buyer-Authorization": `Bearer ${buyerToken}` } : {}),
      },
      body: JSON.stringify({
        merchant_id: config.merchantId,
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
  activity: IdleActivity = { lastActivityAt: Date.now(), triggered: false },
): () => void {
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (activity.triggered) return;
    idleTimer = setTimeout(() => {
      activity.triggered = true;
      onTrigger("idle_30_seconds");
      reportTriggerEvent("idle_30_seconds", config);
    }, Math.max(0, activity.lastActivityAt + (config.idleSeconds ?? 180) * 1000 - Date.now()));
  };
  const resetIdle = () => {
    activity.lastActivityAt = Date.now();
    activity.triggered = false;
    scheduleIdle();
  };
  const events = ["mousemove", "keydown", "scroll", "click", "touchstart"];
  events.forEach((e) => document.addEventListener(e, resetIdle, { passive: true }));
  scheduleIdle();
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
