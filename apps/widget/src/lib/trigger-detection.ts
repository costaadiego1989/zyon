// Trigger detection module for widget embed context
// Handles exit intent, idle detection, custom events from host site

export type WidgetTriggerName =
  | "exit_intent_detected"
  | "idle_30_seconds"
  | "payment_failed"
  | "coupon_field_clicked"
  | "shipping_objection_detected";

export interface WidgetTriggerConfig {
  enabledTriggers: WidgetTriggerName[];
  idleThresholdMs?: number; // default 30000
}

/**
 * Initialize widget trigger detection.
 * Supports:
 * - exit_intent_detected: mouseleave at top of viewport (desktop only)
 * - idle_30_seconds: setTimeout 30s after last user activity
 * - payment_failed, coupon_field_clicked, shipping_objection_detected: custom events from host
 *
 * Returns cleanup function.
 */
export function initWidgetTriggerDetection(
  config: WidgetTriggerConfig,
  onTrigger: (trigger: WidgetTriggerName) => void
): () => void {
  const cleanups: Array<() => void> = [];

  // ─── Exit Intent Detection (desktop only) ───────────────────
  if (config.enabledTriggers.includes("exit_intent_detected")) {
    const isTouchDevice =
      "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0;

    if (!isTouchDevice) {
      let fired = false;
      const handleMouseLeave = (e: MouseEvent) => {
        if (e.clientY <= 0 && !fired) {
          fired = true;
          onTrigger("exit_intent_detected");
        }
      };
      document.addEventListener("mouseleave", handleMouseLeave);
      cleanups.push(() =>
        document.removeEventListener("mouseleave", handleMouseLeave)
      );
    }
  }

  // ─── Idle Timer Detection ───────────────────────────────────
  if (config.enabledTriggers.includes("idle_30_seconds")) {
    const threshold = config.idleThresholdMs ?? 30_000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let fired = false;

    const resetTimer = () => {
      if (fired) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!fired) {
          fired = true;
          onTrigger("idle_30_seconds");
        }
      }, threshold);
    };

    const events = ["click", "scroll", "keypress", "touchstart", "mousemove"];
    events.forEach((ev) =>
      document.addEventListener(ev, resetTimer, { passive: true })
    );
    resetTimer(); // start initial timer

    cleanups.push(() => {
      if (timer) clearTimeout(timer);
      events.forEach((ev) => document.removeEventListener(ev, resetTimer));
    });
  }

  // ─── Custom Events from Host Site ───────────────────────────
  const customTriggers: Array<[WidgetTriggerName, string]> = [
    ["payment_failed", "zyon:payment-failed"],
    ["coupon_field_clicked", "zyon:coupon-opened"],
    ["shipping_objection_detected", "zyon:shipping-objection"],
  ];

  for (const [triggerName, eventName] of customTriggers) {
    if (config.enabledTriggers.includes(triggerName)) {
      let fired = false;
      const handler = () => {
        if (!fired) {
          fired = true;
          onTrigger(triggerName);
        }
      };
      window.addEventListener(eventName, handler);
      cleanups.push(() => window.removeEventListener(eventName, handler));
    }
  }

  return () => cleanups.forEach((fn) => fn());
}
