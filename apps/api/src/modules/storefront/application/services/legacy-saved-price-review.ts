import { ConflictException } from "@nestjs/common";
import type { LegacySavedPriceReviewReason } from "../../domain/services/storefront-legacy-saved-price.js";

export const LEGACY_SAVED_PRICE_REVIEW_MESSAGE = "As condições do desconto salvo precisam ser revistas. Nenhum valor foi alterado. Revise os itens e confirme uma nova composição válida antes de pagar.";
export const legacySavedPriceReviewNotice = () => ({ version: 1 as const, code: "benefit_conditions_not_met" as const, message: LEGACY_SAVED_PRICE_REVIEW_MESSAGE });
/** Existing error presentation consumes message/ProblemDetails.detail. This
 * is not a monetary review, confirmation fingerprint or payment grant. */
export class LegacySavedPriceReviewRequired extends ConflictException {
  constructor(readonly reason: LegacySavedPriceReviewReason) {
    super({ code: "checkout_review_required", reason: "legacy_saved_price_review_required", requires_confirmation: true,
      message: LEGACY_SAVED_PRICE_REVIEW_MESSAGE });
  }
}
