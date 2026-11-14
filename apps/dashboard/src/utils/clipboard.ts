/**
 * Copy text to clipboard with fallback.
 * Returns success boolean; callers decide UX messaging.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}