import { BadRequestException, Body, Controller, Get, Inject, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { EvaluateNegotiationUseCase } from "../../application/evaluate-negotiation.use-case.js";
import { GetMerchantNegotiationPolicyUseCase } from "../../application/merchant-negotiation-policy.use-cases.js";
import { GetBuyerAgentPreferencesUseCase } from "../../application/buyer-agent-preferences.use-cases.js";
import { RecordNegotiationSessionUseCase } from "../../application/record-negotiation-session.use-case.js";
import { ApplyNegotiationAgreementToCheckoutUseCase } from "../../application/apply-negotiation-agreement-to-checkout.use-case.js";
import { negotiationCartFingerprint } from "../../domain/cart-fingerprint.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

type EvaluateNegotiationBody = {
  cart: Parameters<typeof negotiationCartFingerprint>[0];
  globalUserId?: string;
};

type ApplyCheckoutOfferBody = {
  negotiation_session_id: string;
  checkout_session_id: string;
  requested_discount_percent: number;
  /** Bug 1 fix: must be true when negotiation result has requiresHumanConfirmation. */
  human_confirmed?: boolean;
};

@UseGuards(AuthGuard)
@Controller("negotiations")
export class NegotiationController {
  constructor(
    private readonly evaluateNegotiation: EvaluateNegotiationUseCase,
    private readonly getMerchantPolicy: GetMerchantNegotiationPolicyUseCase,
    private readonly getBuyerPreferences: GetBuyerAgentPreferencesUseCase,
    private readonly recordSession: RecordNegotiationSessionUseCase,
    private readonly applyToCheckout: ApplyNegotiationAgreementToCheckoutUseCase,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient
  ) {}

  @Post("evaluate")
  async evaluate(@Req() request: { user?: unknown }, @Body() body: EvaluateNegotiationBody) {
    const user = currentUser(request);

    // Bug 2 fix: always resolve policy/prefs from the authenticated tenant store;
    // never trust body overrides. This prevents fabricated policies corrupting the ledger.
    const merchantPolicy = await this.getMerchantPolicy.executeResolved(user.merchantId);
    const buyerPreferences = await this.getBuyerPreferences.executeResolved({
      merchantId: user.merchantId,
      globalUserId: body.globalUserId
    });

    const result = this.evaluateNegotiation.execute({
      merchantId: user.merchantId,
      globalUserId: body.globalUserId,
      cart: body.cart,
      merchantPolicy,
      buyerPreferences
    });

    // Bug 4 fix: only persist session/ledger when the negotiation actually proceeds
    // (agreement reached or real AI cost incurred). Clean early denials (disabled flags)
    // produce no DB writes — they are free and deterministic from stored policy.
    const isDeniedWithoutAiCost =
      !result.agreement &&
      (result.denialReason === "merchant_machine_negotiation_disabled" ||
        result.denialReason === "buyer_machine_negotiation_disabled" ||
        result.denialReason === "invalid_policy");

    if (isDeniedWithoutAiCost) {
      // Return the denial result without creating a session row.
      return result;
    }

    const { negotiation_session_id } = await this.recordSession.execute({
      merchantId: user.merchantId,
      globalUserId: body.globalUserId,
      cartFingerprint: negotiationCartFingerprint(body.cart),
      result
    });

    return { ...result, negotiation_session_id };
  }

  @Post("apply-checkout-offer")
  async applyCheckoutOffer(
    @Req() request: { user?: unknown },
    @Body() body: ApplyCheckoutOfferBody
  ) {
    const user = currentUser(request);

    if (body.human_confirmed !== undefined && body.human_confirmed !== true) {
      throw new BadRequestException("human_confirmed_must_be_true");
    }

    return this.applyToCheckout.execute({
      merchantId: user.merchantId,
      negotiationSessionId: body.negotiation_session_id,
      checkoutSessionId: body.checkout_session_id,
      requestedDiscountPercent: body.requested_discount_percent,
      humanConfirmed: body.human_confirmed === true
    });
  }

  @Get("stats")
  async stats(
    @Req() request: { user?: unknown },
    @Query("period") period?: string
  ) {
    const user = currentUser(request);
    return this.buildStats(user.merchantId, period ?? "30d");
  }

  @Get("sessions")
  async sessions(
    @Req() request: { user?: unknown },
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
    @Query("status") status?: string
  ) {
    const user = currentUser(request);
    return this.listSessions(user.merchantId, {
      limit: Math.min(Math.max(Number(limit) || 20, 1), 100),
      cursor,
      status
    });
  }

  private async buildStats(merchantId: string, period: string): Promise<Record<string, unknown>> {
    const days = parsePeriodDays(period);
    const since = new Date(Date.now() - days * 86_400_000);
    const count = await this.prisma.negotiationSession.count({
      where: { merchantId, createdAt: { gte: since } }
    });
    const costLedger = await this.prisma.negotiationCostLedgerEntry.aggregate({
      where: { merchantId, createdAt: { gte: since } },
      _sum: { amountCents: true }
    });
    return {
      period,
      total_sessions: count,
      total_cost_cents: costLedger._sum.amountCents ?? 0,
      average_cost_per_session: count > 0 ? Math.round((costLedger._sum.amountCents ?? 0) / count) : 0
    };
  }

  private async listSessions(
    merchantId: string,
    opts: { limit: number; cursor?: string; status?: string }
  ): Promise<Record<string, unknown>> {
    const items = await this.prisma.negotiationSession.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {})
    });
    const hasMore = items.length > opts.limit;
    const data = hasMore ? items.slice(0, opts.limit) : items;

    // Fetch cost ledger for each session
    const costs = await Promise.all(
      data.map(s =>
        this.prisma.negotiationCostLedgerEntry.aggregate({
          where: { negotiationSessionId: s.id },
          _sum: { amountCents: true }
        })
      )
    );

    return {
      data: data.map((s, i) => ({
        id: s.id,
        created_at: s.createdAt.toISOString(),
        global_user_id: s.globalUserId,
        cost_cents: costs[i]._sum.amountCents ?? 0,
        result: s.resultJson
      })),
      next_cursor: hasMore ? data[data.length - 1].id : null,
      has_more: hasMore
    };
  }
}

function parsePeriodDays(period: string): number {
  if (period.endsWith("d")) return Math.min(Math.max(parseInt(period.slice(0, -1), 10) || 30, 1), 365);
  return 30;
}
