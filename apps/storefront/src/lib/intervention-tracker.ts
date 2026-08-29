const COOLDOWN_PREFIX = "aacp_trigger_last_";
const COUNT_PREFIX = "aacp_trigger_count_";
const ACTIVITY_KEY = "aacp_last_activity_";
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
  }
}
export function canFireTrigger(merchantId: string, trigger: string, cooldownMs: number): boolean {
  const lastKey = `${COOLDOWN_PREFIX}${merchantId}_${trigger}`;
  const last = get(lastKey);
  if (last && Date.now() - last < cooldownMs) return false;
  const cap = SATURATION_CAP[trigger] ?? DEFAULT_SATURATION_CAP;
  const count = get(`${COUNT_PREFIX}${merchantId}_${trigger}`);
  return count < cap;
}
export function recordTriggerFired(merchantId: string, trigger: string): void {
  set(`${COOLDOWN_PREFIX}${merchantId}_${trigger}`, Date.now());
  const countKey = `${COUNT_PREFIX}${merchantId}_${trigger}`;
  set(countKey, get(countKey) + 1);
}
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
