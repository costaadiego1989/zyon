import { isDeepStrictEqual } from "node:util";

/** TEST ONLY. A scoped SQL read, not model prose, observes a failed turn. Return
 * an enum only; never publish rows, identifiers, prices or exception text.
 * A change is not proof of a valid action. Never repair/replay uncertain work. */
export async function observeFailedJourneyCart(before, readScopedCart) {
  if (before === undefined) return "not_observed";
  try {
    const after = await readScopedCart();
    if (before === null && after === null) return "absent";
    return isDeepStrictEqual(before, after) ? "unchanged" : "changed";
  } catch { return "observation_failed"; }
}
