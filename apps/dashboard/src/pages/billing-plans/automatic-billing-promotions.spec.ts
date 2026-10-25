import { describe, expect, it } from "vitest";
import { automaticBillingPromotion, promotionalBillingPrice, billingPromotionDuration, type AutomaticBillingPromotion } from "@zyon/shared-types";

const campaign: AutomaticBillingPromotion = { code: "BLACKFRIDAY", name: "Black Friday", plans: ["starter179", "growth", "scale"], discountType: "percent", discountValue: 5000, duration: "repeating", durationMonths: 3, startsAt: "2026-10-01T03:00:00Z", expiresAt: "2026-12-01T03:00:00Z", firstTimeOnly: false };
const now = Date.parse("2026-10-16T00:00:00Z");
describe("automatic campaign plan targeting", () => {
  it.each([["starter179", 17900, 8950], ["growth", 44900, 22450], ["scale", 74900, 37450]] as const)("applies automatically to %s", (plan, base, discounted) => {
    const promotion = automaticBillingPromotion([campaign], plan, "monthly", now);
    expect(promotion).toBe(campaign); expect(promotionalBillingPrice(base, promotion!)).toBe(discounted);
  });
  it("leaves excluded plans, Free and annual at their standard price", () => {
    const specific = { ...campaign, plans: ["growth", "scale"] };
    expect(automaticBillingPromotion([specific], "starter179", "monthly", now)).toBeUndefined();
    expect(automaticBillingPromotion([campaign], "starter", "monthly", now)).toBeUndefined();
    expect(automaticBillingPromotion([campaign], "growth", "annual", now)).toBeUndefined();
  });
  it("expires at the exact boundary and does not apply a future campaign", () => {
    expect(automaticBillingPromotion([campaign], "growth", "monthly", Date.parse(campaign.expiresAt))).toBeUndefined();
    expect(automaticBillingPromotion([campaign], "growth", "monthly", Date.parse(campaign.startsAt) - 1)).toBeUndefined();
  });
  it("never stacks campaigns and picks the newest eligible one from API order", () => {
    const newest = { ...campaign, code: "NATAL", plans: ["scale"], discountValue: 2500 };
    expect(automaticBillingPromotion([newest, campaign], "scale", "monthly", now)?.code).toBe("NATAL");
    expect(automaticBillingPromotion([newest, campaign], "growth", "monthly", now)?.code).toBe("BLACKFRIDAY");
  });
  it("supports fixed discounts and correctly describes duration", () => {
    expect(promotionalBillingPrice(17900, { ...campaign, discountType: "fixed", discountValue: 17800 })).toBe(100);
    expect(billingPromotionDuration(campaign)).toBe("nos 3 primeiros meses");
    expect(billingPromotionDuration({ ...campaign, duration: "once" })).toBe("na primeira mensalidade");
    expect(billingPromotionDuration({ ...campaign, duration: "forever" })).toBe("enquanto a assinatura existir");
  });
});
