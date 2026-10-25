/**
 * SignificanceCalculator — Z-Test for Statistical Significance
 *
 * Calculates whether a difference between conversion rates is statistically significant.
 * Uses Z-test for proportions (appropriate for binomial outcomes: converted/not converted).
 *
 * Algorithm:
 * 1. Sort variants by conversion rate (best first)
 * 2. Compute Z-score using pooled proportion
 * 3. Convert Z-score to confidence (0..1) using error function approximation
 * 4. Return result with significance threshold (95% confidence)
 */

export interface VariantStats {
  variantId: string;
  name: string;
  sessions: number;
  converted: number;
}

export interface SignificanceResult {
  winnerId: string;
  winnerName: string;
  confidence: number; // 0..1
  isSignificant: boolean; // confidence >= 0.95
  needsMore: boolean; // true if any variant has < 100 sessions
}

export type SignificanceCalculatorPort = {
  calculateConfidence(variants: VariantStats[]): SignificanceResult;
};

export class SignificanceCalculator implements SignificanceCalculatorPort {
  /**
   * Minimum sessions per variant to consider the test statistically valid
   */
  private readonly MIN_SESSIONS = 100;

  /**
   * Confidence threshold for statistical significance (95%)
   */
  private readonly SIGNIFICANCE_THRESHOLD = 0.95;

  calculateConfidence(variants: VariantStats[]): SignificanceResult {
    if (variants.length < 2) {
      throw new Error("Need at least 2 variants to calculate confidence");
    }

    // Sort by conversion rate (descending)
    const sorted = [...variants].sort(
      (a, b) => (b.converted / b.sessions) - (a.converted / a.sessions)
    );

    const best = sorted[0];
    const second = sorted[1];

    // Check if we have enough samples
    const needsMore = best.sessions < this.MIN_SESSIONS || second.sessions < this.MIN_SESSIONS;

    // Calculate conversion rates
    const p1 = best.converted / best.sessions;
    const p2 = second.converted / second.sessions;
    const n1 = best.sessions;
    const n2 = second.sessions;

    // Z-test: H0 = both have same conversion rate
    // Pooled proportion
    const p = (best.converted + second.converted) / (n1 + n2);
    const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));

    // Handle division by zero
    if (se === 0) {
      return {
        winnerId: best.variantId,
        winnerName: best.name,
        confidence: p1 > p2 ? 1.0 : 0.5,
        isSignificant: p1 > p2,
        needsMore,
      };
    }

    // Z-score
    const z = (p1 - p2) / se;

    // Convert to confidence
    const confidence = this.zToConfidence(z);

    return {
      winnerId: best.variantId,
      winnerName: best.name,
      confidence,
      isSignificant: confidence >= this.SIGNIFICANCE_THRESHOLD,
      needsMore,
    };
  }

  /**
   * Convert Z-score to confidence using normal CDF.
   * CDF(z) = 0.5 * (1 + erf(z / sqrt(2)))
   *
   * Uses Abramowitz & Stegun erf() approximation (max error < 1.5e-7):
   * erf(x) ≈ 1 - (a1*t + a2*t^2 + a3*t^3 + a4*t^4 + a5*t^5) * exp(-x^2)
   * where t = 1 / (1 + 0.3275911 * x)
   *
   * Known values:
   * - z = 0    → confidence ≈ 0.5
   * - z = 1.65 → confidence ≈ 0.9505
   * - z = 1.96 → confidence ≈ 0.975
   * - z = 2.33 → confidence ≈ 0.9901
   */
  private zToConfidence(z: number): number {
    if (z > 8) return 1.0;
    if (z < -8) return 0.0;

    const x = z / Math.sqrt(2);
    return 0.5 * (1 + this.erf(x));
  }

  /**
   * Error function approximation — Abramowitz & Stegun formula 7.1.26.
   * Polynomial approximation with max absolute error 1.5x10^-7.
   */
  private erf(x: number): number {
    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x);

    // Constants (Abramowitz & Stegun)
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const t = 1.0 / (1.0 + p * absX);
    const t2 = t * t;
    const t3 = t2 * t;
    const t4 = t3 * t;
    const t5 = t4 * t;

    const y = 1.0 - (a1 * t + a2 * t2 + a3 * t3 + a4 * t4 + a5 * t5) * Math.exp(-absX * absX);
    return sign * y;
  }
}
