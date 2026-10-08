import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { MarketplaceRefundContributionService } from "../../application/marketplace-refund-contribution.service.js";
import type { MarketplaceContributionActor, MarketplaceContributionJournal } from "../../domain/ports/marketplace-refund-contribution-journal.port.js";

@UseGuards(AuthGuard)
@RequireTenantRoles("owner", "admin")
@Controller("marketplace/dashboard/refund-contributions")
export class MarketplaceRefundContributionController {
  constructor(@Inject(MarketplaceRefundContributionService) private readonly contributions: MarketplaceRefundContributionService) {}
  @Post()
  @Header("Cache-Control", "no-store")
  async approve(@Req() request: TenantPrincipalRequest, @Body() body: unknown) {
    const actor = this.actor(request);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key =>
      !["refund_plan_id", "contribution_id", "customer_id", "payment_intent_id", "gross_amount_cents", "confirmed"].includes(key))) this.invalid();
    const value = body as Record<string, unknown>;
    for (const key of ["refund_plan_id", "contribution_id"]) this.id(value[key]);
    if (typeof value.customer_id !== "string" || !/^cus_[A-Za-z0-9_]{1,190}$/.test(value.customer_id) ||
      typeof value.payment_intent_id !== "string" || !/^pi_[A-Za-z0-9_]{1,190}$/.test(value.payment_intent_id) ||
      value.confirmed !== true || !Number.isSafeInteger(value.gross_amount_cents) || Number(value.gross_amount_cents) < 1 ||
      Number(value.gross_amount_cents) > 2_147_483_647) this.invalid();
    return this.view(await this.contributions.approve(actor, { refundPlanId: String(value.refund_plan_id), contributionId: String(value.contribution_id),
      customerId: String(value.customer_id), providerPaymentIntentId: String(value.payment_intent_id), grossAmountCents: Number(value.gross_amount_cents), confirmed: true }));
  }
  @Get(":contributionId")
  @Header("Cache-Control", "no-store")
  async get(@Req() request: TenantPrincipalRequest, @Param("contributionId") id: string) {
    const actor = this.actor(request); this.id(id); return this.view(await this.contributions.get(actor, id));
  }
  @Post(":contributionId/reconcile")
  @Header("Cache-Control", "no-store")
  async reconcile(@Req() request: TenantPrincipalRequest, @Param("contributionId") id: string, @Body() body: unknown) {
    const actor = this.actor(request); this.id(id);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || (body as any).confirmed !== true) this.invalid();
    return this.view(await this.contributions.reconcile(actor, id));
  }
  private actor(request: TenantPrincipalRequest): MarketplaceContributionActor {
    const principal = currentTenantPrincipal(request);
    if (principal.kind !== "human" || !["owner", "admin"].includes(principal.role)) throw new ForbiddenException("marketplace_contribution_human_approval_required");
    return { merchantId: principal.tenantId, userId: principal.userId };
  }
  private id(value: unknown): void { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) this.invalid(); }
  private invalid(): never { throw new BadRequestException("invalid_marketplace_contribution_confirmation"); }
  private view(journal: MarketplaceContributionJournal) {
    const r = journal.request;
    return { contribution_id: journal.id, refund_plan_id: journal.refundPlanId, status: journal.status,
      gross_amount_cents: r.grossAmountCents, maximum_credit_cents: r.maximumCreditCents,
      credited_net_cents: journal.certificate?.creditCents ?? 0, processing_fee_cents: journal.certificate?.processingFeeCents ?? 0,
      currency: "BRL", collection_mode: "separately_authorized_receipt_import",
      payment_created: false, customer_id: r.customerId, payment_intent_id: r.providerPaymentIntentId,
      required_payment_metadata: { reason: r.reason, contributionId: r.contributionId, fundingPlanId: r.fundingPlanId,
        refundPlanId: r.refundPlanId, merchantId: r.merchantId, requestHash: r.requestHash, reference: r.reference } };
  }
}
