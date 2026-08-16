// Trigger detection module for storefront widget
// Handles exit intent, idle detection, and other behavioral checkout triggers
"use client";

import { useEffect } from "react";

export type TriggerEvent = "exit_intent_detected" | "idle_30_seconds";

export interface TriggerConfig {
  enableExitIntent?: boolean;
  enableIdleTimer?: boolean;
  idleThresholdMs?: number;
  cooldownMs?: number;
  apiBaseUrl?: string;
  merchantId?: string;
  sessionId?: string;
}

const DEFAULT_IDLE_THRESHOLD_MS = 30_000;
const DEFAULT_COOLDOWN_MS = 3_600_000; // 1 hour

/**
 * Report a trigger event to the checkout API (track-event endpoint).
 */
async function reportTriggerEvent(
  triggerName: TriggerEvent,
  config: TriggerConfig,
): Promise<void> {
  if (!config.sessionId || !config.merchantId) return;

  const apiUrl = config.apiBaseUrl || "http://localhost:3009";

  try {
    await fetch(`${apiUrl}/checkout/track-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: config.merchantId,
        session_id: config.sessionId,
        event: triggerName,
        metadata: { timestamp: new Date().toISOString() },
      }),
    });
  } catch {
    // Silently fail — triggers must never break the page
  }
}

/**
 * Initialize trigger detection (exit intent + idle timer).
 * Returns a cleanup function that removes all listeners.
 */
export function initTriggerDetection(
  config: TriggerConfig,
  onTrigger: (event: TriggerEvent) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const cleanups: Array<() => void> = [];
  let idleTimerId: ReturnType<typeof setTimeout> | null = null;

  // ─── Exit Intent Detection ───────────────────────────────
  if (config.enableExitIntent) {
    // Skip on touch/mobile devices
    const isTouchDevice =
      "ontouchstart" in window || navigator.maxTouchPoints > 0;

    if (!isTouchDevice) {
      let fired = false;
      const cooldown = config.cooldownMs ?? DEFAULT_COOLDOWN_MS;
      let cooldownActive = false;

      const handleDocumentLeave = (event: MouseEvent) => {
        if (fired || cooldownActive) return;
        // Only fire when cursor exits through the top of the viewport
        if (event.clientY > 0) return;

        fired = true;
        cooldownActive = true;

        onTrigger("exit_intent_detected");
        reportTriggerEvent("exit_intent_detected", config);

        setTimeout(() => {
          cooldownActive = false;
        }, cooldown);
      };

      document.addEventListener("mouseleave", handleDocumentLeave);
      cleanups.push(() =>
        document.removeEventListener("mouseleave", handleDocumentLeave),
      );
    }
  }

  // ─── Idle Timer Detection ────────────────────────────────
  if (config.enableIdleTimer ?? true) {
    const threshold = config.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;
    let idleFired = false;

    const startIdleTimer = () => {
      if (idleTimerId !== null) clearTimeout(idleTimerId);

      idleTimerId = setTimeout(() => {
        if (!idleFired) {
          idleFired = true;
          onTrigger("idle_30_seconds");
          reportTriggerEvent("idle_30_seconds", config);
        }
      }, threshold);
    };

    const handleActivity = () => {
      // Reset idle state on activity after it was already triggered
      if (idleFired) idleFired = false;
      startIdleTimer();
    };

    const activityEvents = [
      "click",
      "scroll",
      "keypress",
      "touchstart",
    ] as const;

    for (const evt of activityEvents) {
      document.addEventListener(evt, handleActivity, { passive: true });
      cleanups.push(() => document.removeEventListener(evt, handleActivity));
    }

    // Start the initial timer
    startIdleTimer();
  }

  // ─── Cleanup ─────────────────────────────────────────────
  return () => {
    for (const fn of cleanups) fn();
    if (idleTimerId !== null) clearTimeout(idleTimerId);
  };
}

/**
 * React hook that initializes trigger detection and auto-cleans up.
 * Uses the same initTriggerDetection internally.
 */
export function useTriggerDetection(
  config: TriggerConfig,
  onTrigger: (event: TriggerEvent) => void,
): void {
  useEffect(() => {
    const cleanup = initTriggerDetection(config, onTrigger);
    return cleanup;
    // Re-initialize when session/merchant or enable flags change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    config.enableExitIntent,
    config.enableIdleTimer,
    config.idleThresholdMs,
    config.merchantId,
    config.sessionId,
  ]);
}
