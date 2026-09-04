// Intervention tracking module for widget
// Tracks session-scoped intervention count and per-trigger cooldowns
// Uses sessionStorage with try/catch for hosted iframe contexts

const COUNTER_PREFIX = "aacp_widget_intervention_";
const COOLDOWN_PREFIX = "aacp_widget_trigger_last_";

/**
 * Get the number of interventions (widget opens) for this merchant in the current session.
 * Returns 0 if sessionStorage is unavailable or merchant not found.
 */
export function getInterventionCount(merchantId: string): number {
  try {
    const raw = sessionStorage.getItem(`${COUNTER_PREFIX}${merchantId}`);
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    // sessionStorage blocked (iframe/cross-origin context)
    return 0;
  }
}

/**
 * Increment the intervention counter for this merchant.
 * Silently fails if sessionStorage unavailable.
 */
export function incrementIntervention(merchantId: string): void {
  try {
    const current = getInterventionCount(merchantId);
    sessionStorage.setItem(`${COUNTER_PREFIX}${merchantId}`, String(current + 1));
  } catch {
    // sessionStorage blocked — widget still works, just no tracking
  }
}

/**
 * Check if a trigger can fire based on per-trigger cooldown.
 * Returns true if cooldown has passed or no previous fire recorded.
 */
export function canFireTrigger(
  merchantId: string,
  trigger: string,
  cooldownMs: number
): boolean {
  try {
    const key = `${COOLDOWN_PREFIX}${merchantId}_${trigger}`;
    const lastFired = sessionStorage.getItem(key);
    if (!lastFired) return true;
    return Date.now() - parseInt(lastFired, 10) >= cooldownMs;
  } catch {
    // sessionStorage blocked — allow fire
    return true;
  }
}

/**
 * Record that a trigger fired at this moment.
 * Silently fails if sessionStorage unavailable.
 */
export function recordTriggerFired(merchantId: string, trigger: string): void {
  try {
    const key = `${COOLDOWN_PREFIX}${merchantId}_${trigger}`;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // sessionStorage blocked
  }
}
