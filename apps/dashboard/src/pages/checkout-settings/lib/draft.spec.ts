import { describe, expect, it } from "vitest";
import type { CheckoutSettings } from "@zyon/shared-types";
import { ALL_TRIGGERS } from "./constants.js";
import { DEFAULT_DRAFT, draftToPatch, settingsToDraft } from "./draft.js";

const settings = (triggerRules: CheckoutSettings["triggerRules"]): CheckoutSettings => ({
  ...draftToPatch(DEFAULT_DRAFT), triggerRules,
}) as CheckoutSettings;

describe("checkout settings preserve triggers outside the visual editor", () => {
  it("keeps the explicit abandonment opt-out while saving unrelated settings", () => {
    const draft = settingsToDraft(settings([{ trigger: "checkout_abandoned", enabled: false, priority: 95 }]));
    draft.inviteText = "Precisa de ajuda?";
    expect(ALL_TRIGGERS).not.toContain("checkout_abandoned");
    expect(draftToPatch(draft).triggerRules?.find(rule => rule.trigger === "checkout_abandoned"))
      .toMatchObject({ enabled: false, priority: 95 });
  });

  it("preserves the server legacy default when abandonment has no stored rule", () => {
    const draft = settingsToDraft(settings([]));
    expect(draftToPatch(draft).triggerRules?.find(rule => rule.trigger === "checkout_abandoned"))
      .toMatchObject({ enabled: true, priority: 95 });
  });

  it("retains configured coupon and shipping rules that are not currently editable", () => {
    const stored = [
      { trigger: "coupon_field_clicked" as const, enabled: false, priority: 80, message: "Confira as condições", couponCode: "EXISTENTE" },
      { trigger: "shipping_objection_detected" as const, enabled: true, priority: 100, cooldownSeconds: 120 },
    ];
    const patch = draftToPatch(settingsToDraft(settings(stored)));
    for (const rule of stored) expect(patch.triggerRules?.find(item => item.trigger === rule.trigger)).toMatchObject(rule);
  });
});
