// Only fixed local harness names and line numbers cross the diagnostic boundary.
// Never echo a stack, exception message, arbitrary path, model text or contact.
const nativeStackGetter = Object.getOwnPropertyDescriptor(new Error(), "stack")?.get;
const sources = ["storefront-journey-neighborhood.http-scenario.mjs", "normal-checkout-cross-sell.http-scenario.mjs",
  "storefront-journey-commerce.worker.mjs", "storefront-journey-owned-app.mjs"];

export function journeyErrorSource(error) {
  try {
    if (!error || typeof error !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(error, "stack");
    const stack = descriptor && ("value" in descriptor ? descriptor.value
      : nativeStackGetter && descriptor.get === nativeStackGetter ? nativeStackGetter.call(error) : undefined);
    if (typeof stack !== "string" || stack.length > 100_000) return undefined;
    for (const file of sources) {
      const match = stack.match(new RegExp(`${file.replaceAll(".", "\\.")}:(\\d{1,6}):\\d{1,6}(?:\\)|\\s|$)`));
      if (match && Number(match[1]) > 0) return { file, line: Number(match[1]) };
    }
    return undefined;
  } catch { return undefined; }
}

export function journeyMutationBuckets(error) {
  const known = new Set(["checkout", "source", "merchant", "rules", "config", "quotes", "events", "outbox", "payments", "orders", "coupons"]);
  try {
    const value = error && typeof error === "object"
      ? Object.getOwnPropertyDescriptor(error, "journeyChangedTables")?.value : undefined;
    if (!Array.isArray(value) || value.length > known.size || value.some(name => !known.has(name))) return undefined;
    return [...new Set(value)];
  } catch { return undefined; }
}
