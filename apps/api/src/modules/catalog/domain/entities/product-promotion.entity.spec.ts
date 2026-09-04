import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProductPromotionEntity } from "./product-promotion.entity.js";

describe("ProductPromotionEntity", () => {
  describe("create() factory — invariants", () => {
    describe("Invariant 1: Inline XOR Coupon", () => {
      it("should fail when both inline discount and couponId are set", () => {
        assert.throws(
          () =>
            ProductPromotionEntity.create({
              merchantId: "mrc_1",
              isActive: true,
              startsAt: new Date("2024-01-01"),
              endsAt: new Date("2024-12-31"),
              couponId: "coupon_1",
              discountType: "percent",
              discountValue: 10,
            }),
          {
            name: "Error",
            message: /promotion_inline_and_coupon_conflict/,
          }
        );
      });

      it("should fail when neither inline discount nor couponId are set", () => {
        assert.throws(
          () =>
            ProductPromotionEntity.create({
              merchantId: "mrc_1",
              isActive: true,
              startsAt: new Date("2024-01-01"),
              endsAt: new Date("2024-12-31"),
            }),
          {
            name: "Error",
            message: /promotion_no_discount_source/,
          }
        );
      });

      it("should allow inline percent without couponId", () => {
        const entity = ProductPromotionEntity.create({
          merchantId: "mrc_1",
          isActive: true,
          startsAt: new Date("2024-01-01"),
          endsAt: new Date("2024-12-31"),
          discountType: "percent",
          discountValue: 10,
        });
        assert.ok(entity);
      });

      it("should allow inline fixed without couponId", () => {
        const entity = ProductPromotionEntity.create({
          merchantId: "mrc_1",
          isActive: true,
          startsAt: new Date("2024-01-01"),
          endsAt: new Date("2024-12-31"),
          discountType: "fixed",
          discountValue: 500,
        });
        assert.ok(entity);
      });

      it("should allow promoPriceInCents without couponId", () => {
        const entity = ProductPromotionEntity.create({
          merchantId: "mrc_1",
          isActive: true,
          startsAt: new Date("2024-01-01"),
          endsAt: new Date("2024-12-31"),
          promoPriceInCents: 9999,
        });
        assert.ok(entity);
      });

      it("should allow couponId without inline discount", () => {
        const entity = ProductPromotionEntity.create({
          merchantId: "mrc_1",
          isActive: true,
          startsAt: new Date("2024-01-01"),
          endsAt: new Date("2024-12-31"),
          couponId: "coupon_1",
        });
        assert.ok(entity);
      });

      it("should fail when both promoPriceInCents and couponId are set", () => {
        assert.throws(
          () =>
            ProductPromotionEntity.create({
              merchantId: "mrc_1",
              isActive: true,
              startsAt: new Date("2024-01-01"),
              endsAt: new Date("2024-12-31"),
              couponId: "coupon_1",
              promoPriceInCents: 5000,
            }),
          {
            name: "Error",
            message: /promotion_inline_and_coupon_conflict/,
          }
        );
      });
    });

    describe("Invariant 2: Percent bounds (0–100 inclusive)", () => {
      it("should allow percent = 0", () => {
        const entity = ProductPromotionEntity.create({
          merchantId: "mrc_1",
          isActive: true,
          startsAt: new Date("2024-01-01"),
          endsAt: new Date("2024-12-31"),
          discountType: "percent",
          discountValue: 0,
        });
        assert.ok(entity);
      });

      it("should allow percent = 100", () => {
        const entity = ProductPromotionEntity.create({
          merchantId: "mrc_1",
          isActive: true,
          startsAt: new Date("2024-01-01"),
          endsAt: new Date("2024-12-31"),
          discountType: "percent",
          discountValue: 100,
        });
        assert.ok(entity);
      });

      it("should fail when percent > 100", () => {
        assert.throws(
          () =>
            ProductPromotionEntity.create({
              merchantId: "mrc_1",
              isActive: true,
              startsAt: new Date("2024-01-01"),
              endsAt: new Date("2024-12-31"),
              discountType: "percent",
              discountValue: 101,
            }),
          {
            name: "Error",
            message: /promotion_percent_out_of_range/,
          }
        );
      });

      it("should fail when percent < 0", () => {
        assert.throws(
          () =>
            ProductPromotionEntity.create({
              merchantId: "mrc_1",
              isActive: true,
              startsAt: new Date("2024-01-01"),
              endsAt: new Date("2024-12-31"),
              discountType: "percent",
              discountValue: -1,
            }),
          {
            name: "Error",
            message: /promotion_percent_out_of_range/,
          }
        );
      });
    });

    describe("Invariant 3: Fixed discount must be >= 0", () => {
      it("should allow fixed = 0", () => {
        const entity = ProductPromotionEntity.create({
          merchantId: "mrc_1",
          isActive: true,
          startsAt: new Date("2024-01-01"),
          endsAt: new Date("2024-12-31"),
          discountType: "fixed",
          discountValue: 0,
        });
        assert.ok(entity);
      });

      it("should allow fixed > 0", () => {
        const entity = ProductPromotionEntity.create({
          merchantId: "mrc_1",
          isActive: true,
          startsAt: new Date("2024-01-01"),
          endsAt: new Date("2024-12-31"),
          discountType: "fixed",
          discountValue: 1000,
        });
        assert.ok(entity);
      });

      it("should fail when fixed < 0", () => {
        assert.throws(
          () =>
            ProductPromotionEntity.create({
              merchantId: "mrc_1",
              isActive: true,
              startsAt: new Date("2024-01-01"),
              endsAt: new Date("2024-12-31"),
              discountType: "fixed",
              discountValue: -100,
            }),
          {
            name: "Error",
            message: /promotion_negative_discount/,
          }
        );
      });
    });

    describe("Invariant 4: promoPriceInCents must be >= 0", () => {
      it("should allow promoPriceInCents = 0", () => {
        const entity = ProductPromotionEntity.create({
          merchantId: "mrc_1",
          isActive: true,
          startsAt: new Date("2024-01-01"),
          endsAt: new Date("2024-12-31"),
          promoPriceInCents: 0,
        });
        assert.ok(entity);
      });

      it("should allow promoPriceInCents > 0", () => {
        const entity = ProductPromotionEntity.create({
          merchantId: "mrc_1",
          isActive: true,
          startsAt: new Date("2024-01-01"),
          endsAt: new Date("2024-12-31"),
          promoPriceInCents: 9999,
        });
        assert.ok(entity);
      });

      it("should fail when promoPriceInCents < 0", () => {
        assert.throws(
          () =>
            ProductPromotionEntity.create({
              merchantId: "mrc_1",
              isActive: true,
              startsAt: new Date("2024-01-01"),
              endsAt: new Date("2024-12-31"),
              promoPriceInCents: -500,
            }),
          {
            name: "Error",
            message: /promotion_negative_price/,
          }
        );
      });
    });

    describe("Invariant 5: startsAt < endsAt", () => {
      it("should fail when startsAt >= endsAt", () => {
        assert.throws(
          () =>
            ProductPromotionEntity.create({
              merchantId: "mrc_1",
              isActive: true,
              startsAt: new Date("2024-12-31"),
              endsAt: new Date("2024-01-01"),
              discountType: "percent",
              discountValue: 10,
            }),
          {
            name: "Error",
            message: /promotion_invalid_window/,
          }
        );
      });

      it("should fail when startsAt === endsAt", () => {
        const same = new Date("2024-06-15");
        assert.throws(
          () =>
            ProductPromotionEntity.create({
              merchantId: "mrc_1",
              isActive: true,
              startsAt: same,
              endsAt: same,
              discountType: "percent",
              discountValue: 10,
            }),
          {
            name: "Error",
            message: /promotion_invalid_window/,
          }
        );
      });

      it("should allow startsAt < endsAt", () => {
        const entity = ProductPromotionEntity.create({
          merchantId: "mrc_1",
          isActive: true,
          startsAt: new Date("2024-01-01"),
          endsAt: new Date("2024-12-31"),
          discountType: "percent",
          discountValue: 10,
        });
        assert.ok(entity);
      });
    });
  });

  describe("describe() method — discount kind union", () => {
    it("should return kind: 'inline_percent' for percent discount", () => {
      const entity = ProductPromotionEntity.create({
        id: "promo_1",
        merchantId: "mrc_1",
        productId: "prd_1",
        isActive: true,
        startsAt: new Date("2024-01-01"),
        endsAt: new Date("2024-12-31"),
        discountType: "percent",
        discountValue: 15,
      });
      const desc = entity.describe();
      assert.equal(desc.kind, "inline_percent");
      if (desc.kind === "inline_percent") {
        assert.equal(desc.discountValue, 15);
      }
    });

    it("should return kind: 'inline_fixed' for fixed discount", () => {
      const entity = ProductPromotionEntity.create({
        id: "promo_2",
        merchantId: "mrc_1",
        variantId: "var_1",
        isActive: true,
        startsAt: new Date("2024-01-01"),
        endsAt: new Date("2024-12-31"),
        discountType: "fixed",
        discountValue: 500,
      });
      const desc = entity.describe();
      assert.equal(desc.kind, "inline_fixed");
      if (desc.kind === "inline_fixed") {
        assert.equal(desc.discountValue, 500);
      }
    });

    it("should return kind: 'inline_price' for promoPrice", () => {
      const entity = ProductPromotionEntity.create({
        id: "promo_3",
        merchantId: "mrc_1",
        categoryId: "cat_1",
        isActive: true,
        startsAt: new Date("2024-01-01"),
        endsAt: new Date("2024-12-31"),
        promoPriceInCents: 7999,
      });
      const desc = entity.describe();
      assert.equal(desc.kind, "inline_price");
      if (desc.kind === "inline_price") {
        assert.equal(desc.promoPriceInCents, 7999);
      }
    });

    it("should return kind: 'coupon' for coupon-linked promotion", () => {
      const entity = ProductPromotionEntity.create({
        id: "promo_4",
        merchantId: "mrc_1",
        isActive: false,
        startsAt: new Date("2024-01-01"),
        endsAt: new Date("2024-12-31"),
        couponId: "coupon_abc",
      });
      const desc = entity.describe();
      assert.equal(desc.kind, "coupon");
      if (desc.kind === "coupon") {
        assert.equal(desc.couponId, "coupon_abc");
      }
    });
  });

  describe("entity properties", () => {
    it("should preserve all props in readonly fields", () => {
      const input = {
        id: "promo_x",
        merchantId: "mrc_x",
        productId: "prd_x",
        variantId: "var_x",
        categoryId: "cat_x",
        isActive: false,
        startsAt: new Date("2024-03-01"),
        endsAt: new Date("2024-06-01"),
        discountType: "percent" as const,
        discountValue: 25,
      };
      const entity = ProductPromotionEntity.create(input);
      assert.equal(entity.id, "promo_x");
      assert.equal(entity.merchantId, "mrc_x");
      assert.equal(entity.productId, "prd_x");
      assert.equal(entity.variantId, "var_x");
      assert.equal(entity.categoryId, "cat_x");
      assert.equal(entity.isActive, false);
      assert.equal(entity.startsAt.toISOString(), new Date("2024-03-01").toISOString());
      assert.equal(entity.endsAt.toISOString(), new Date("2024-06-01").toISOString());
      assert.equal(entity.discountType, "percent");
      assert.equal(entity.discountValue, 25);
    });
  });
});
