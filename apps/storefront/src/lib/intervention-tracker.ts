/**
 * Intervention tracking — sessionStorage-based cooldown + safety cap, per merchantId.
 *
 * Design (matches industry best practice for on-site nudges):
 *  - The PRIMARY throttle is a per-trigger COOLDOWN window. After the window
 *    passes, the same trigger may fire again — nudges are rate-limited, never
 *    permanently silenced. This is what keeps the agent from going quiet forever.
 *  - A per-trigger SATURATION cap avoids spamming the same trigger many times in
 *    one session, but it is generous and — crucially — resets on genuine buyer
 *    activity, so a long, active browsing session keeps getting help.
 *  - Exit-intent is treated as "once per visit": it fires once, then the long
 *    cooldown gates it (the buyer literally tried to leave; don't nag on every
 *    mouse flick), but it re-arms after the cooldown so a returning buyer is
 *    still caught.
 *
 * Multi-merchant sessions are isolated by merchantId.
 */

const COOLDOWN_PREFIX = "aacp_trigger_last_";
const COUNT_PREFIX = "aacp_trigger_count_";
const ACTIVITY_KEY = "aacp_last_activity_";

// Per-trigger saturation caps within one continuous (inactive) window. Reset when
// the buyer becomes active again (see noteActivity). High enough to never feel
// like an arbitrary kill-switch, low enough not to spam.
const SATURATION_CAP: Record<string, number> = {
  exit_intent_detected: 2,
  idle_30_seconds: 4,
};
const DEFAULT_SATURATION_CAP = 4;

function get(key: string): number {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

function set(key: string, value: number): void {
  try {
    sessionStorage.setItem(key, String(value));
  } catch {
    /* private mode / storage disabled — degrade to always-allow */
  }
}

/**
 * True if `trigger` is allowed to fire now for this merchant: past its cooldown
 * window AND under its saturation cap.
 */
export function canFireTrigger(merchantId: string, trigger: string, cooldownMs: number): boolean {
  const lastKey = `${COOLDOWN_PREFIX}${merchantId}_${trigger}`;
  const last = get(lastKey);
  if (last && Date.now() - last < cooldownMs) return false;

  const cap = SATURATION_CAP[trigger] ?? DEFAULT_SATURATION_CAP;
  const count = get(`${COUNT_PREFIX}${merchantId}_${trigger}`);
  return count < cap;
}

/** Record that `trigger` fired: stamps the cooldown and bumps its saturation count. */
export function recordTriggerFired(merchantId: string, trigger: string): void {
  set(`${COOLDOWN_PREFIX}${merchantId}_${trigger}`, Date.now());
  const countKey = `${COUNT_PREFIX}${merchantId}_${trigger}`;
  set(countKey, get(countKey) + 1);
}

/**
 * Reset saturation counts when the buyer shows fresh engagement (e.g. sends a
 * message, adds to cart). An engaged buyer is a new opportunity, so the agent
 * earns its nudge budget back — the cooldown still prevents back-to-back nudges.
 */
export function noteActivity(merchantId: string): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(`${COUNT_PREFIX}${merchantId}_`)) sessionStorage.removeItem(k);
    }
    set(`${ACTIVITY_KEY}${merchantId}`, Date.now());
  } catch {
    /* ignore */
  }
}
