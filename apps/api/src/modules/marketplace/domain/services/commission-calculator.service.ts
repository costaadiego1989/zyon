/**
 * CommissionCalculatorService — Split Calculation for Marketplace
 *
 * Calculates host commission and seller net amounts for cross-store items.
 * All amounts in integer cents. Commission rounds UP (host always gets at least 1 cent).
 */

export interface CommissionInput {
  itemPriceCents: number;
  quantity: number;
  commissionRateBps: number;
}

export interface CommissionResult {
  totalCents: number;
  commissionCents: number;
  sellerNetCents: number;
}

export class CommissionCalculatorService {
  calculate(input: CommissionInput): CommissionResult {
    this.validate(input);

    const totalCents = input.itemPriceCents * input.quantity;
    const commissionCents = Math.ceil(
      (totalCents * input.commissionRateBps) / 10000
    );
    const sellerNetCents = totalCents - commissionCents;

    return { totalCents, commissionCents, sellerNetCents };
  }

  private validate(input: CommissionInput): void {
    if (!Number.isInteger(input.itemPriceCents) || input.itemPriceCents <= 0) {
      throw new Error("itemPriceCents must be a positive integer");
    }

    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new Error("quantity must be a positive integer");
    }

    if (
      !Number.isInteger(input.commissionRateBps) ||
      input.commissionRateBps < 100 ||
      input.commissionRateBps > 5000
    ) {
      throw new Error(
        "commissionRateBps must be an integer between 100 and 5000"
      );
    }
  }
}
