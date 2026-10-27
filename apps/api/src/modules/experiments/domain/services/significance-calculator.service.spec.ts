import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SignificanceCalculator, type VariantStats } from "./significance-calculator.service.js";

describe("SignificanceCalculator", () => {
  const calc = new SignificanceCalculator();

  describe("calculateConfidence", () => {
    it("throws when fewer than 2 variants", () => {
      try {
        calc.calculateConfidence([
          { variantId: "v1", name: "V1", sessions: 100, converted: 30 },
        ]);
        assert.fail("Should throw with single variant");
      } catch (e: any) {
        assert.match(e.message, /at least 2/i);
      }
    });

    it("returns winner with confidence ~0.95 for known dataset (p1=0.3, p2=0.2, n=100 each)", () => {
      // Z-test: p_pooled=0.25, se≈0.0612, z≈1.633 → CDF≈0.9487
      // Note: 0.9487 is just below 0.95 threshold
      const variants: VariantStats[] = [
        { variantId: "v1", name: "Better", sessions: 100, converted: 30 },
        { variantId: "v2", name: "Worse", sessions: 100, converted: 20 },
      ];

      const result = calc.calculateConfidence(variants);

      assert.equal(result.winnerId, "v1", "V1 should be winner (30% vs 20%)");
      assert.equal(result.winnerName, "Better");
      assert.ok(result.confidence > 0.94 && result.confidence < 0.96,
        `Confidence should be ~0.9487, got ${result.confidence}`);
      assert.equal(result.isSignificant, false, "94.87% < 95% threshold");
      assert.equal(result.needsMore, false, "Both have 100 sessions");
    });

    it("returns isSignificant=true when confidence >= 0.95 (known dataset)", () => {
      // Larger difference: p1=0.35, p2=0.2, n=150 each
      const variants: VariantStats[] = [
        { variantId: "v1", name: "Much Better", sessions: 150, converted: 53 }, // ~0.353
        { variantId: "v2", name: "Worse", sessions: 150, converted: 30 }, // 0.2
      ];

      const result = calc.calculateConfidence(variants);

      assert.equal(result.winnerId, "v1");
      assert.ok(result.confidence > 0.95, `Confidence should be >0.95, got ${result.confidence}`);
      assert.equal(result.isSignificant, true);
    });

    it("marks needsMore=true when variants have <100 sessions", () => {
      const variants: VariantStats[] = [
        { variantId: "v1", name: "A", sessions: 50, converted: 15 },
        { variantId: "v2", name: "B", sessions: 50, converted: 10 },
      ];

      const result = calc.calculateConfidence(variants);
      assert.equal(result.needsMore, true);
    });

    it("marks needsMore=false when both have >=100 sessions", () => {
      const variants: VariantStats[] = [
        { variantId: "v1", name: "A", sessions: 100, converted: 30 },
        { variantId: "v2", name: "B", sessions: 100, converted: 20 },
      ];

      const result = calc.calculateConfidence(variants);
      assert.equal(result.needsMore, false);
    });

    it("selects best variant (highest conversion rate) regardless of order", () => {
      const variants: VariantStats[] = [
        { variantId: "worse", name: "Worse", sessions: 100, converted: 20 },
        { variantId: "better", name: "Better", sessions: 100, converted: 30 },
        { variantId: "middle", name: "Middle", sessions: 100, converted: 25 },
      ];

      const result = calc.calculateConfidence(variants);
      assert.equal(result.winnerId, "better", "Winner should be best regardless of input order");
    });

    it("handles edge case: identical conversion rates (z=0)", () => {
      const variants: VariantStats[] = [
        { variantId: "v1", name: "A", sessions: 100, converted: 30 },
        { variantId: "v2", name: "B", sessions: 100, converted: 30 },
      ];

      const result = calc.calculateConfidence(variants);
      assert.equal(result.winnerId, "v1", "First in sorted order");
      assert.ok(result.confidence >= 0.49 && result.confidence <= 0.51,
        `Z=0 should give ~0.5 confidence, got ${result.confidence}`);
      assert.equal(result.isSignificant, false);
    });

    it("handles edge case: zero conversions in one variant", () => {
      const variants: VariantStats[] = [
        { variantId: "v1", name: "Good", sessions: 100, converted: 30 },
        { variantId: "v2", name: "Bad", sessions: 100, converted: 0 },
      ];

      const result = calc.calculateConfidence(variants);
      assert.equal(result.winnerId, "v1");
      assert.ok(result.confidence > 0.99, "Very high confidence");
      assert.equal(result.isSignificant, true);
    });

    it("returns confidence in range [0, 1]", () => {
      const testCases = [
        [
          { variantId: "v1", name: "A", sessions: 100, converted: 50 },
          { variantId: "v2", name: "B", sessions: 100, converted: 49 },
        ],
        [
          { variantId: "v1", name: "A", sessions: 200, converted: 10 },
          { variantId: "v2", name: "B", sessions: 200, converted: 100 },
        ],
        [
          { variantId: "v1", name: "A", sessions: 500, converted: 250 },
          { variantId: "v2", name: "B", sessions: 500, converted: 100 },
        ],
      ];

      for (const variants of testCases) {
        const result = calc.calculateConfidence(variants);
        assert.ok(
          result.confidence >= 0 && result.confidence <= 1,
          `Confidence ${result.confidence} should be in [0, 1]`
        );
      }
    });

    it("matches known Z-test values (manual calculation verification)", () => {
      // Manual calculation: p1=0.4, p2=0.2, n1=n2=100
      // p = (40+20)/200 = 0.3
      // se = sqrt(0.3*0.7*(1/100 + 1/100)) = sqrt(0.21*0.02) ≈ 0.0648
      // z = (0.4-0.2)/0.0648 ≈ 3.086
      // CDF(3.086) ≈ 0.998 → very significant
      const variants: VariantStats[] = [
        { variantId: "v1", name: "A", sessions: 100, converted: 40 },
        { variantId: "v2", name: "B", sessions: 100, converted: 20 },
      ];

      const result = calc.calculateConfidence(variants);
      assert.ok(result.confidence > 0.99, `Should be >0.99, got ${result.confidence}`);
      assert.equal(result.isSignificant, true);
    });

    it("handles unequal sample sizes", () => {
      // p1=0.3, p2=0.25, n1=200, n2=100
      const variants: VariantStats[] = [
        { variantId: "v1", name: "A", sessions: 200, converted: 60 },
        { variantId: "v2", name: "B", sessions: 100, converted: 25 },
      ];

      const result = calc.calculateConfidence(variants);
      assert.equal(result.winnerId, "v1");
      assert.ok(result.confidence > 0 && result.confidence < 1);
    });
  });

  describe("erf and zToConfidence internals", () => {
    it("produces sensible confidence values for boundary Z-scores", () => {
      // Z ≈ 0 should give confidence ≈ 0.5
      const vars1: VariantStats[] = [
        { variantId: "v1", name: "A", sessions: 500, converted: 250 },
        { variantId: "v2", name: "B", sessions: 500, converted: 249 },
      ];
      const r1 = calc.calculateConfidence(vars1);
      assert.ok(r1.confidence > 0.48 && r1.confidence < 0.56,
        `Near-tie should give ~0.5, got ${r1.confidence}`);

      // Z ≈ 1.65 should give confidence ≈ 0.95
      const vars2: VariantStats[] = [
        { variantId: "v1", name: "A", sessions: 100, converted: 35 },
        { variantId: "v2", name: "B", sessions: 100, converted: 22 },
      ];
      const r2 = calc.calculateConfidence(vars2);
      assert.ok(r2.confidence > 0.90 && r2.confidence < 0.98,
        `Z≈1.65 range should give ~0.95, got ${r2.confidence}`);
    });
  });
});
