/** Compare the editable projection, so presentation defaults never become writes. */
export function changedFields<T extends object>(current: T, initial: T): Partial<T> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current)) {
    const previous = (initial as Record<string, unknown>)[key];
    if (JSON.stringify(value) === JSON.stringify(previous)) continue;
    if (value && previous && typeof value === "object" && typeof previous === "object"
      && !Array.isArray(value) && !Array.isArray(previous)) {
      const nested = changedFields(value, previous);
      if (Object.keys(nested).length) patch[key] = nested;
    } else {
      patch[key] = value;
    }
  }
  return patch as Partial<T>;
}
