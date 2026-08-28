import { trackEvent } from "./tracking";

export type TriggerName =
  | "idle_30_seconds"
  | "exit_intent_detected"
  | "shipping_objection_detected"
  | "coupon_field_clicked"
  | "payment_failed";

export interface TriggerConfig {
  enabledTriggers: TriggerName[];
  cooldownMs: number;
  maxInterventions: number;
  /** Seconds of inactivity before the idle trigger fires (default 30). */
  idleSeconds?: number;
}

let interventionCount = 0;
let lastTriggerTime = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function canFire(config: TriggerConfig): boolean {
  if (interventionCount >= config.maxInterventions) return false;
  const now = Date.now();
  if (now - lastTriggerTime < config.cooldownMs) return false;
  return true;
}

function fireTrigger(
  trigger: TriggerName,
  config: TriggerConfig,
  onTrigger: (t: TriggerName) => void
) {
  if (!config.enabledTriggers.includes(trigger)) return;
  if (!canFire(config)) return;
  interventionCount++;
  lastTriggerTime = Date.now();
  void trackEvent(trigger, { trigger });
  onTrigger(trigger);
}

export function setupIdleTrigger(
  config: TriggerConfig,
  onTrigger: (t: TriggerName) => void
): () => void {
  if (!config.enabledTriggers.includes("idle_30_seconds")) return () => {};

  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      fireTrigger("idle_30_seconds", config, onTrigger);
    }, (config.idleSeconds ?? 30) * 1000);
  };

  const events = ["mousemove", "keydown", "scroll", "click", "touchstart"];
  events.forEach((e) =>
    document.addEventListener(e, resetIdle, { passive: true })
  );
  resetIdle(); // start timer

  return () => {
    if (idleTimer) clearTimeout(idleTimer);
    events.forEach((e) => document.removeEventListener(e, resetIdle));
  };
}

export function setupExitIntentTrigger(
  config: TriggerConfig,
  onTrigger: (t: TriggerName) => void
): () => void {
  if (!config.enabledTriggers.includes("exit_intent_detected"))
    return () => {};

  let fired = false;
  const handler = (e: MouseEvent) => {
    if (fired) return;
    if (e.clientY <= 5) {
      // mouse near top of viewport
      fired = true;
      fireTrigger("exit_intent_detected", config, onTrigger);
    }
  };

  document.addEventListener("mouseleave", handler);
  return () => document.removeEventListener("mouseleave", handler);
}

export function firePaymentFailed(
  config: TriggerConfig,
  onTrigger: (t: TriggerName) => void
) {
  fireTrigger("payment_failed", config, onTrigger);
}

export function resetTriggers() {
  interventionCount = 0;
  lastTriggerTime = 0;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}
