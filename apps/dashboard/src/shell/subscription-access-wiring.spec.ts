import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

describe("subscription access wiring", () => {
  it("expired trials cannot enter the standalone signup branch", () => {
    const main = read("../main.tsx");
    expect(main).toMatch(/!subscriptionRequired\s*&&\s*\(planSelectionPending\s*\|\|\s*subscriptionIntent\)/);
    expect(main).toMatch(/<DashboardShell[^>]*subscriptionRequired=\{subscriptionRequired\}/);
  });
  it("resolves the allowed tab synchronously before rendering and filters desktop/mobile nav", () => {
    const shell = read("./DashboardShell.tsx");
    expect(shell).toMatch(/const tab = resolveSubscriptionTab\(requestedTab, subscriptionRequired, me.role\)/);
    expect(shell).toMatch(/items = items.filter\(item => isSubscriptionRouteAllowed\(item.key, subscriptionRequired, me.role\)\)/);
    expect(shell).toMatch(/useNavCounts\(!subscriptionRequired\)/);
    expect(shell).toMatch(/useSupportSocket\(API_BASE_URL, subscriptionRequired \? undefined : me.id/);
    expect(shell).toMatch(/<ShellImportProgressProvider suspended=\{subscriptionRequired\}/);
    expect(shell).toMatch(/!subscriptionRequired && <MerchantStoreSwitcher/);
  });
  it("does not replace an already-confirmed restriction with a billing lookup failure", () => {
    const main = read("../main.tsx");
    const start = main.indexOf('source: "main.refreshSession.billing"');
    expect(start).toBeGreaterThan(0);
    expect(main.slice(main.lastIndexOf("catch", start), start)).not.toContain("setSubscriptionRequired(false)");
    expect(main).toMatch(/window.addEventListener\("focus", refreshBillingAccess\)/);
    expect(main).toMatch(/setSubscriptionRequired\(subscription.trial_expired === true\)/);
  });
});
