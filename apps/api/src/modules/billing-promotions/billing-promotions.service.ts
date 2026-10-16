import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { Prisma, type PrismaClient, type BillingPromotion } from "@prisma/client";
import Stripe from "stripe";
import { createHash } from "node:crypto";
import { BILLING_PLANS, type AutomaticBillingPromotion } from "@zyon/shared-types";
import type { BillingCheckoutPromotionPort } from "../payment/domain/ports/payment-platform-provider.port.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { billingPriceId } from "../payment/infrastructure/billing-env.js";
import { PAID_PROMOTION_PLANS, parsePromotion, parsePromotionQuery, promotionPolicy, promotionShouldBeActive, type PromotionInput, type PromotionPlan } from "./billing-promotion.policy.js";

export const BILLING_PROMOTIONS_STRIPE = Symbol("BILLING_PROMOTIONS_STRIPE");
type AuditContext = { operatorId: string; correlationId: string };

@Injectable()
export class BillingPromotionsService implements OnApplicationBootstrap, OnModuleDestroy, BillingCheckoutPromotionPort {
  private readonly logger = new Logger(BillingPromotionsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private syncing = false;
  private automaticCache?: { until: number; items: AutomaticBillingPromotion[] };
  private automaticLoading?: Promise<AutomaticBillingPromotion[]>;

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(BILLING_PROMOTIONS_STRIPE) private readonly stripe: Stripe | null) {}

  onApplicationBootstrap() {
    if (!this.stripe || process.env.BILLING_PROMOTIONS_ENABLED === "false") return;
    const interval = Math.max(10000, Number(process.env.BILLING_PROMOTION_SYNC_INTERVAL_MS) || 60000);
    this.timer = setInterval(() => { void this.synchronizeScheduled(); }, interval);
    this.timer.unref();
    void this.synchronizeScheduled();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async automatic(): Promise<AutomaticBillingPromotion[]> {
    if (!this.stripe || process.env.BILLING_PROMOTIONS_ENABLED === "false") return [];
    if (this.automaticCache && this.automaticCache.until > Date.now()) return this.automaticCache.items;
    if (this.automaticLoading) return this.automaticLoading;
    this.automaticLoading = this.loadAutomatic().then(items => {
      this.automaticCache = { until: Math.min(Date.now() + 15000, ...items.map(item => Date.parse(item.expiresAt))), items };
      return items;
    }).finally(() => { this.automaticLoading = undefined; });
    return this.automaticLoading;
  }

  private async loadAutomatic(): Promise<AutomaticBillingPromotion[]> {
    const now = new Date();
    const rows = await this.prisma.billingPromotion.findMany({
      where: { autoApply: true, enabled: true, provisioned: true, deletedAt: null, startsAt: { lte: now }, expiresAt: { gt: now } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const result: AutomaticBillingPromotion[] = [];
    for (const row of rows) {
      if (!row.autoApply || !row.enabled || row.deletedAt || !row.provisioned || row.startsAt > now || row.expiresAt <= now) continue;
      try { await this.resolveForCheckout({ code: row.code, plan: row.plans[0] as PromotionPlan, cycle: "monthly" }); }
      catch (error) { if (error instanceof BadRequestException) continue; throw error; }
      result.push({ code: row.code, name: row.name, plans: row.plans, discountType: row.discountType as "percent" | "fixed",
        discountValue: row.discountValue, duration: row.duration as AutomaticBillingPromotion["duration"], durationMonths: row.durationMonths,
        startsAt: row.startsAt.toISOString(), expiresAt: row.expiresAt.toISOString(), firstTimeOnly: row.firstTimeOnly });
    }
    return result;
  }

  async resolveForCheckout(input: Parameters<BillingCheckoutPromotionPort["resolveForCheckout"]>[0]): Promise<string> {
    const stripe = this.requireStripe();
    if (input.cycle !== "monthly") throw new BadRequestException("billing_promotion_monthly_only");
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{3,40}$/.test(code)) throw new BadRequestException("billing_promotion_invalid");
    const row = await this.prisma.billingPromotion.findUnique({ where: { code } });
    const now = new Date();
    if (!row || row.deletedAt || !row.enabled || !row.provisioned || !row.stripePromotionCodeId || row.startsAt > now || row.expiresAt <= now) {
      throw new BadRequestException("billing_promotion_invalid");
    }
    if (!row.plans.includes(input.plan)) throw new BadRequestException("billing_promotion_plan_not_allowed");
    let promotion: Stripe.PromotionCode;
    try { promotion = await stripe.promotionCodes.retrieve(row.stripePromotionCodeId); }
    catch { throw new ServiceUnavailableException("billing_promotions_unavailable"); }
    if (!promotion.active || promotion.code.toUpperCase() !== code || promotion.metadata?.zyon_billing_campaign_id !== row.id ||
      !promotionShouldBeActive(row, promotion.times_redeemed, now) ||
      (promotion.expires_at !== null && promotion.expires_at !== undefined && promotion.expires_at * 1000 <= now.getTime()) ||
      (promotion.max_redemptions != null && promotion.times_redeemed >= promotion.max_redemptions)) {
      throw new BadRequestException("billing_promotion_invalid");
    }
    // Pass the promotion, not the coupon: Stripe still enforces its redemption and first-purchase restrictions.
    return promotion.id;
  }

  async list(query: Record<string, unknown> = {}) {
    this.requireStripe();
    const { page, pageSize, where } = parsePromotionQuery(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.billingPromotion.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: pageSize, skip: (page - 1) * pageSize }),
      this.prisma.billingPromotion.count({ where }),
    ]);
    const items = await Promise.all(rows.map(async row => {
      try { return this.present(row, row.stripePromotionCodeId ? await this.requireStripe().promotionCodes.retrieve(row.stripePromotionCodeId) : undefined); }
      catch { return this.present(row); }
    }));
    return { items,
      plans: PAID_PROMOTION_PLANS.map(id => ({ id, name: id === "starter179" ? "Starter" : id === "growth" ? "Growth" : "Scale", monthlyPriceCents: Math.round(BILLING_PLANS[id].monthlyPriceBrl * 100) })),
      policy: promotionPolicy(),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async retry(id: string, audit: AuditContext) {
    const row = await this.prisma.billingPromotion.findUnique({ where: { id } });
    if (!row || row.deletedAt) throw new NotFoundException("billing_promotion_not_found");
    return this.create({ ...row, startsAt: row.startsAt.toISOString(), expiresAt: row.expiresAt.toISOString() }, audit);
  }

  async create(body: Record<string, unknown>, audit: AuditContext) {
    this.automaticCache = undefined;
    this.requireStripe();
    const input = parsePromotion(body);
    const existing = await this.prisma.billingPromotion.findUnique({ where: { id: input.id } });
    if (existing && !sameConfiguration(existing, input, body.startsAt !== undefined)) throw new ConflictException("billing_promotion_request_changed");
    if (!existing) {
      try {
        await this.prisma.$transaction(async tx => {
          await tx.billingPromotion.create({ data: { ...input, createdBy: audit.operatorId } });
          await this.audit(tx, "requested", input.id, audit);
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException({ code: "billing_promotion_code_exists", detail: "Este código já existe. Escolha outro." });
        throw error;
      }
    }
    return this.locked(input.id, (tx, row) => this.provision(tx, row, audit));
  }

  private async provision(tx: Prisma.TransactionClient, row: BillingPromotion, audit: AuditContext) {
      if (row.provisioned) return this.present(row, await this.requireStripe().promotionCodes.retrieve(row.stripePromotionCodeId!));
      const products = await this.productsFor(row.plans as PromotionPlan[]);
      const configuration = JSON.stringify([row.code, row.name, row.discountType, row.discountValue, row.duration, row.durationMonths, row.plans, row.startsAt, row.expiresAt, row.maxRedemptions, row.firstTimeOnly]);
      const couponId = `zyon-billing-${row.id}-${row.revision}-${createHash("sha256").update(configuration).digest("hex").slice(0, 12)}`;
      let coupon: Stripe.Coupon;
      try { coupon = await this.requireStripe().coupons.retrieve(couponId, { expand: ["applies_to"] }); }
      catch (error) {
        if (!(error instanceof Stripe.errors.StripeInvalidRequestError) || error.code !== "resource_missing") throw error;
        coupon = await this.requireStripe().coupons.create({
          // Stripe's customer-visible coupon name is limited to 40 characters;
          // retain the full campaign label locally for administration/audit.
          id: couponId, name: Array.from(row.name).slice(0, 40).join(""), duration: row.duration as "once" | "repeating" | "forever",
          ...(row.durationMonths ? { duration_in_months: row.durationMonths } : {}),
          ...(row.discountType === "percent" ? { percent_off: row.discountValue / 100 } : { amount_off: row.discountValue, currency: "brl" }),
          applies_to: { products }, expand: ["applies_to"],
          redeem_by: Math.floor(row.expiresAt.getTime() / 1000),
          ...(row.maxRedemptions ? { max_redemptions: row.maxRedemptions } : {}),
          metadata: { zyon_billing_campaign_id: row.id, plans: row.plans.join(","), billing_cycle: "monthly" },
        }, { idempotencyKey: `${couponId}:coupon` });
      }
      const allowedProducts = coupon.applies_to?.products;
      if (!allowedProducts || products.length !== allowedProducts.length || products.some(id => !allowedProducts.includes(id))) {
        throw new ServiceUnavailableException("billing_promotion_product_restriction_missing");
      }
      const matching = await this.requireStripe().promotionCodes.list({ code: row.code, limit: 100 });
      let promotion = matching.data.find(p => p.metadata?.zyon_billing_campaign_id === row.id && p.metadata?.configuration_key === couponId);
      for (const stale of matching.data.filter(p => p.active && p.metadata?.zyon_billing_campaign_id === row.id && p.id !== promotion?.id)) {
        await this.requireStripe().promotionCodes.update(stale.id, { active: false });
        stale.active = false;
      }
      if (!promotion && matching.data.some(p => p.active)) throw new ConflictException({ code: "billing_promotion_code_exists", detail: "Este código já está ativo na Stripe. Escolha outro." });
      if (!promotion) promotion = await this.requireStripe().promotionCodes.create({
        promotion: { type: "coupon", coupon: coupon.id }, code: row.code,
        active: promotionShouldBeActive(row, 0, new Date()),
        expires_at: Math.floor(row.expiresAt.getTime() / 1000),
        ...(row.maxRedemptions ? { max_redemptions: row.maxRedemptions } : {}),
        restrictions: { first_time_transaction: row.firstTimeOnly },
        metadata: { zyon_billing_campaign_id: row.id, plans: row.plans.join(","), billing_cycle: "monthly", configuration_key: couponId },
      }, { idempotencyKey: `${couponId}:code` });
      const saved = await tx.billingPromotion.update({ where: { id: row.id }, data: { stripeCouponId: coupon.id, stripePromotionCodeId: promotion.id, provisioned: true } });
      await this.audit(tx, "created", row.id, audit);
      return this.present(saved, promotion);
  }

  async update(id: string, body: Record<string, unknown>, audit: AuditContext) {
    this.automaticCache = undefined;
    this.requireStripe();
    const input = parsePromotion({ ...body, id });
    return this.locked(id, async (tx, row) => {
      if (row.stripePromotionCodeId) {
        const current = await this.requireStripe().promotionCodes.retrieve(row.stripePromotionCodeId);
        if (current.times_redeemed > 0) throw new ConflictException({ code: "billing_promotion_already_redeemed", detail: "Este cupom já foi resgatado. Para alterar o desconto, crie outro código. Você ainda pode desabilitar ou excluir este cupom." });
        await this.requireStripe().promotionCodes.update(current.id, { active: false });
      }
      const saved = await tx.billingPromotion.update({ where: { id }, data: { ...input, revision: row.revision + 1, provisioned: false, stripeCouponId: null, stripePromotionCodeId: null } });
      const result = await this.provision(tx, saved, audit);
      await this.audit(tx, "updated", id, audit);
      return result;
    });
  }

  async remove(id: string, audit: AuditContext) {
    this.automaticCache = undefined;
    this.requireStripe();
    return this.locked(id, async (tx, row) => {
      if (row.stripePromotionCodeId) await this.requireStripe().promotionCodes.update(row.stripePromotionCodeId, { active: false });
      else {
        const pending = await this.requireStripe().promotionCodes.list({ code: row.code, limit: 100 });
        for (const owned of pending.data.filter(p => p.metadata?.zyon_billing_campaign_id === row.id && p.active)) {
          await this.requireStripe().promotionCodes.update(owned.id, { active: false });
        }
      }
      // Retain provider records and audit history for subscriptions that already received a discount.
      await tx.billingPromotion.update({ where: { id }, data: { enabled: false, deletedAt: new Date() } });
      await this.audit(tx, "deleted", id, audit);
      return { deleted: true };
    });
  }

  async setEnabled(id: string, enabled: unknown, audit: AuditContext) {
    this.automaticCache = undefined;
    this.requireStripe();
    if (typeof enabled !== "boolean") throw new BadRequestException("billing_promotion_invalid_enabled");
    return this.locked(id, async (tx, row) => {
      if (!row.provisioned || !row.stripePromotionCodeId) throw new ConflictException("billing_promotion_not_provisioned");
      const current = await this.requireStripe().promotionCodes.retrieve(row.stripePromotionCodeId);
      if (enabled && (row.expiresAt <= new Date() || (row.maxRedemptions !== null && current.times_redeemed >= row.maxRedemptions))) {
        throw new ConflictException({ code: "billing_promotion_expired_or_exhausted", detail: "Este cupom expirou ou atingiu o limite de usos." });
      }
      const saved = await tx.billingPromotion.update({ where: { id }, data: { enabled } });
      const promotion = await this.requireStripe().promotionCodes.update(row.stripePromotionCodeId, { active: promotionShouldBeActive(saved, current.times_redeemed, new Date()) });
      await this.audit(tx, enabled ? "enabled" : "paused", id, audit);
      return this.present(saved, promotion);
    });
  }

  private async synchronizeScheduled() {
    if (this.syncing || !this.stripe || process.env.BILLING_PROMOTIONS_ENABLED === "false") return;
    this.syncing = true;
    try {
      // Iterate all pages so a large history never prevents a future campaign from starting.
      let cursor: string | undefined;
      do {
        const rows: BillingPromotion[] = await this.prisma.billingPromotion.findMany({
          where: { provisioned: true, deletedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { id: "asc" }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        for (const row of rows) {
          try {
            await this.locked(row.id, async (tx, current) => {
              const promotion = await this.requireStripe().promotionCodes.retrieve(current.stripePromotionCodeId!);
              const active = promotionShouldBeActive(current, promotion.times_redeemed, new Date());
              if (promotion.active !== active) {
                await this.requireStripe().promotionCodes.update(promotion.id, { active });
                await this.audit(tx, "scheduled_activation", current.id, { operatorId: current.createdBy, correlationId: crypto.randomUUID() });
              }
            });
          } catch { this.logger.warn("billing_promotion_sync_failed"); }
        }
        cursor = rows.length === 100 ? rows.at(-1)!.id : undefined;
      } while (cursor);
    } catch { this.logger.warn("billing_promotion_scheduler_unavailable"); }
    finally { this.syncing = false; }
  }

  private async productsFor(plans: PromotionPlan[]) {
    const products = await Promise.all(plans.map(async plan => {
      const price = await this.requireStripe().prices.retrieve(billingPriceId(plan));
      if (!price.active || price.currency !== "brl" || price.unit_amount !== Math.round(BILLING_PLANS[plan].monthlyPriceBrl * 100) || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1) {
        throw new ServiceUnavailableException("billing_price_configuration_mismatch");
      }
      return typeof price.product === "string" ? price.product : price.product.id;
    }));
    return [...new Set(products)];
  }

  private async locked<T>(id: string, action: (tx: Prisma.TransactionClient, row: BillingPromotion) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM billing_promotions WHERE id = ${id} FOR UPDATE`);
      const row = await tx.billingPromotion.findUnique({ where: { id } });
      if (!row || row.deletedAt) throw new NotFoundException("billing_promotion_not_found");
      return action(tx, row);
    }, { timeout: 60000 });
  }

  private async audit(tx: Prisma.TransactionClient, action: string, id: string, context: AuditContext) {
    await tx.platformAuditEvent.create({ data: {
      actorOperatorId: context.operatorId, action: `platform.billing_promotion.${action}`,
      permission: "platform:billing-promotions:write", environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
      targetType: "billing_promotion", targetId: id, correlationId: context.correlationId, outcome: "succeeded",
    } });
  }

  private present(row: BillingPromotion, promotion?: Stripe.PromotionCode) {
    const now = new Date();
    const exhausted = promotion && row.maxRedemptions !== null && promotion.times_redeemed >= row.maxRedemptions;
    const status = !row.provisioned ? "pending" : row.expiresAt <= now ? "expired" : exhausted ? "exhausted" : !row.enabled ? "paused" : row.startsAt > now ? "scheduled" : !promotion ? "unverified" : promotion.active ? "active" : "sync_pending";
    return { ...row, status, timesRedeemed: promotion?.times_redeemed ?? null, stripeActive: promotion?.active ?? null, livemode: promotion?.livemode ?? null };
  }

  private requireStripe(): Stripe {
    if (!this.stripe || process.env.BILLING_PROMOTIONS_ENABLED === "false") throw new ServiceUnavailableException({ code: "billing_promotions_unavailable", detail: "Cupons de assinatura indisponíveis neste ambiente." });
    return this.stripe;
  }
}

function sameConfiguration(row: BillingPromotion, input: PromotionInput, explicitStart: boolean): boolean {
  return row.code === input.code && row.name === input.name && (row.autoApply ?? false) === input.autoApply && row.discountType === input.discountType && row.discountValue === input.discountValue && row.duration === input.duration && row.durationMonths === input.durationMonths && row.plans.join(",") === input.plans.join(",") && row.expiresAt.getTime() === input.expiresAt.getTime() && (!explicitStart || row.startsAt.getTime() === input.startsAt.getTime()) && row.maxRedemptions === input.maxRedemptions && row.firstTimeOnly === input.firstTimeOnly;
}
