// Trigger detection for the storefront store agent.
// Mirrors the checkout widget_v2 implementation (apps/widget_v2/src/lib/triggers.ts),
// which is the proven-working version: module-level timer/counter state (survives
// React re-renders), mousemove/keydown in the idle activity set, and a 5px top
// margin for exit-intent. Kept as separate setup functions so arming is explicit.
"use client";

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

// Module-level state so re-arming the effect (config/session changes) never resets
// the idle countdown or double-counts — this is exactly why the checkout version works.
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let exitFired = false;
let exitRearmTimer: ReturnType<typeof setTimeout> | null = null;

// After firing, ignore the same physical gesture (mouse jittering at the edge) for
// a short window, then re-arm so a genuine later exit is caught again. The real
// per-session rate-limit lives in the caller's canFireTrigger (cooldown + cap);
// exitFired only debounces the raw event, it must NOT latch forever.
const EXIT_REARM_MS = 4_000;

function reportTriggerEvent(triggerName: TriggerEvent, config: TriggerConfig): void {
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
 * Initialize trigger detection (exit-intent + idle). Returns a cleanup function.
 * The gating (activation mode, frequency limits) lives in the caller's onTrigger.
 */
export function initTriggerDetection(
  config: TriggerConfig,
  onTrigger: (event: TriggerEvent) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const cleanups: Array<() => void> = [];

  // ─── Exit-intent ─────────────────────────────────────────
  if (config.enableExitIntent ?? true) {
    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

    if (!isTouchDevice) {
      exitFired = false;
      const fire = () => {
        if (exitFired) return;
        exitFired = true;
        onTrigger("exit_intent_detected");
        reportTriggerEvent("exit_intent_detected", config);
        // Re-arm after a short debounce so a later genuine exit fires again.
        // (The caller's cooldown still decides whether a NUDGE actually shows.)
        if (exitRearmTimer) clearTimeout(exitRearmTimer);
        exitRearmTimer = setTimeout(() => { exitFired = false; }, EXIT_REARM_MS);
      };
      // Primary signal: mouseout on the document where the cursor leaves toward the
      // top edge and to no in-page element (relatedTarget null = left the window).
      // This is more reliable across browsers than document "mouseleave", which
      // does not consistently fire when the pointer exits the viewport.
      const handleMouseOut = (e: MouseEvent) => {
        if (exitFired) return;
        const to = e.relatedTarget as Node | null;
        if (to) return; // moved to another element, not out of the window
        if (e.clientY <= 5) fire();
      };
      document.addEventListener("mouseout", handleMouseOut);
      cleanups.push(() => document.removeEventListener("mouseout", handleMouseOut));

      // Fallback: mouseleave on documentElement (covers browsers that fire this
      // instead of mouseout when the pointer crosses the top boundary).
      const handleLeave = (e: MouseEvent) => {
        if (exitFired) return;
        if (e.clientY <= 5) fire();
      };
      document.documentElement.addEventListener("mouseleave", handleLeave);
      cleanups.push(() => document.documentElement.removeEventListener("mouseleave", handleLeave));
    }

    // Tab/app switch is the mobile-friendly exit signal (mouseleave never fires on touch).
    let visFired = false;
    const handleVisibility = () => {
      if (visFired) return;
      if (document.visibilityState === "hidden") {
        visFired = true;
        onTrigger("exit_intent_detected");
        reportTriggerEvent("exit_intent_detected", config);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    cleanups.push(() => document.removeEventListener("visibilitychange", handleVisibility));

    // Real unload: fire-and-forget for server-side cart recovery.
    const handlePageHide = () => {
      if (!config.sessionId || !config.merchantId) return;
      try {
        const apiUrl = config.apiBaseUrl || "http://localhost:3009";
        const payload = JSON.stringify({
          merchant_id: config.merchantId,
          session_id: config.sessionId,
          event: "exit_intent_detected",
          metadata: { timestamp: new Date().toISOString(), via: "pagehide" },
        });
        navigator.sendBeacon?.(`${apiUrl}/checkout/track-event`, new Blob([payload], { type: "application/json" }));
      } catch {
        /* never block unload */
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    cleanups.push(() => window.removeEventListener("pagehide", handlePageHide));
  }

  // ─── Idle ────────────────────────────────────────────────
  if (config.enableIdleTimer ?? true) {
    const threshold = config.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;

    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        onTrigger("idle_30_seconds");
        reportTriggerEvent("idle_30_seconds", config);
      }, threshold);
    };

    // Include mousemove + keydown (the checkout set) so genuine activity resets the
    // timer, but the countdown actually completes when the buyer stops interacting.
    const activityEvents = ["mousemove", "keydown", "scroll", "click", "touchstart"] as const;
    for (const evt of activityEvents) {
      document.addEventListener(evt, resetIdle, { passive: true });
      cleanups.push(() => document.removeEventListener(evt, resetIdle));
    }
    resetIdle(); // start the countdown
  }

  return () => {
    for (const fn of cleanups) fn();
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (exitRearmTimer) {
      clearTimeout(exitRearmTimer);
      exitRearmTimer = null;
    }
  };
}
