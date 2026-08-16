/**
 * Intervention tracking — sessionStorage-based counter + cooldown.
 * Tracks per merchantId so multi-merchant sessions don't interfere.
 */

const COUNTER_PREFIX = "aacp_intervention_count_";
const COOLDOWN_PREFIX = "aacp_trigger_last_";

export function getInterventionCount(merchantId: string): number {
  const raw = sessionStorage.getItem(`${COUNTER_PREFIX}${merchantId}`);
  return raw ? parseInt(raw, 10) : 0;
}

export function incrementIntervention(merchantId: string): void {
  const current = getInterventionCount(merchantId);
  sessionStorage.setItem(`${COUNTER_PREFIX}${merchantId}`, String(current + 1));
}

export function canFireTrigger(merchantId: string, trigger: string, cooldownMs: number): boolean {
  const key = `${COOLDOWN_PREFIX}${merchantId}_${trigger}`;
  const lastFired = sessionStorage.getItem(key);
  if (!lastFired) return true;
  return Date.now() - parseInt(lastFired, 10) >= cooldownMs;
}

export function recordTriggerFired(merchantId: string, trigger: string): void {
  const key = `${COOLDOWN_PREFIX}${merchantId}_${trigger}`;
  sessionStorage.setItem(key, String(Date.now()));
}
