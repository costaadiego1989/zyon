import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { Cart, CheckoutSession } from "@zyon/shared-types";
import { isDeepStrictEqual } from "node:util";
import { marketplacePaymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { PAYMENT_PROVIDER_PORT, type PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { BillingPlanMeteringService } from "../domain/billing-plan-guard.js";
import { merchantTransactionFeeCentsFor } from "../domain/billing-plans.js";
import { readBuyerServiceFeeCents } from "../infrastructure/stripe-env.js";
import { resolveCheckoutPaymentCapabilities } from "../domain/checkout-payment-routing.js";
import type { MerchantStoreSettings } from "../../merchant/domain/merchant.types.js";
import { marketplacePaymentOptions } from "../../marketplace/infrastructure/repositories/marketplace-payment-options.js";
import { assertMarketplacePartners } from "../../marketplace/infrastructure/repositories/prisma-marketplace-cart.repository.js";
import { buildMarketplaceFundingBudget, type FrozenMarketplaceFunding } from "../../marketplace/domain/services/marketplace-funding-budget.js";
import { SettlementStateMachineService, type MarketplaceWindowConfig } from "../../marketplace/domain/services/settlement-state-machine.service.js";
import { assertMarketplaceProductOptions } from "../../marketplace/domain/services/marketplace-product-options.js";
import { assertMarketplaceShippingSelection } from "../../marketplace/infrastructure/repositories/marketplace-shipping-selection.js";

/** Canonical local preflight. It neither creates customers nor submits charges.
 * Public checkout remains gated until shipping and reversal workflows are ready. */
@Injectable()
export class PrepareMarketplaceCheckoutService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
    private readonly billing: BillingPlanMeteringService) {}

  /** A durable intent may still be unsubmitted after a crash. Recheck its frozen
   * shipping authority immediately before the first provider attempt; uncertain
   * attempts recover their original charge instead of requiring a fresh quote. */
  async assertFrozenShipping(input: { merchantId: string; sessionId: string }, instructions: FrozenMarketplaceFunding): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT session_id FROM checkout_sessions WHERE merchant_id = ${input.merchantId} AND session_id = ${input.sessionId} FOR UPDATE`;
      const row = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: input } });
      if (!row || row.merchantId !== input.merchantId) throw new ConflictException("marketplace_funding_checkout_missing");
      const session = { cart: row.cart as unknown as Cart, shipping: row.shipping as unknown as CheckoutSession["shipping"],
        customer: row.customer as unknown as CheckoutSession["customer"] };
      if (!instructions.shippingQuotes) {
        const variants = await tx.productVariant.findMany({ where: { id: { in: session.cart.items.map(item => item.variantId ?? "") } }, include: { product: true } });
        if (variants.length !== new Set(session.cart.items.map(item => item.variantId)).size ||
            variants.some(variant => !["digital", "service"].includes(variant.product.type)) ||
            session.cart.items.some(item => item.marketplace?.stockReservationId) ||
            instructions.hostStockItems?.some(item => item.requiresStock) || instructions.shipping.length) {
          throw new ConflictException("marketplace_shipping_allocation_required");
        }
        return;
      }
      if (instructions.hostMerchantId !== input.merchantId || instructions.checkoutFingerprint !== marketplacePaymentCartFingerprint(session)) {
        throw new ConflictException("marketplace_funding_checkout_changed");
      }
      const selected = await assertMarketplaceShippingSelection(tx, { ...input, ...session });
      if (!isDeepStrictEqual(selected.quotes, instructions.shippingQuotes) || !isDeepStrictEqual(selected.allocations, instructions.shipping)) {
        throw new ConflictException("marketplace_funding_shipping_mismatch");
      }
    });
  }

  async execute(input: { merchantId: string; sessionId: string; method: "pix" | "boleto" | "card" }): Promise<FrozenMarketplaceFunding> {
    if (!["pix", "card"].includes(input.method)) throw new ConflictException("marketplace_payment_method_invalid");
    const [session, merchant, subscription] = await Promise.all([
      this.prisma.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: input.merchantId, sessionId: input.sessionId } } }),
      this.prisma.merchant.findUnique({ where: { id: input.merchantId } }),
      this.billing.getSubscription(input.merchantId),
    ]);
    if (!session || !merchant) throw new ConflictException("marketplace_funding_checkout_missing");
    const cart = session.cart as unknown as Cart & { cart_ref?: string };
    if (cart.currency !== "BRL" || !Array.isArray(cart.items) || !cart.items.length || cart.items.length > 100 ||
        cart.currentDiscount || cart.commercialNudge || cart.commerceCartRef) throw new ConflictException("marketplace_funding_cart_mismatch");
    const cartRef = cart.cart_ref ?? input.sessionId;
    const records = await this.prisma.crossStoreLineItem.findMany({ where: { hostMerchantId: input.merchantId, checkoutSessionId: cartRef } });
    if (!records.length || records.some(row => row.orderId || !row.termsJson) ||
        records.length !== cart.items.filter(row => row.marketplace).length) throw new ConflictException("marketplace_funding_cart_mismatch");
    const variants = await this.prisma.productVariant.findMany({ where: { OR: cart.items.map(row => ({ id: row.variantId ?? "",
      product: { merchantId: row.marketplace?.sourceMerchantId ?? input.merchantId } })) }, include: { product: true } });
    const lines = cart.items.map(item => {
      const variant = variants.find(row => row.id === item.variantId), record = records.find(row => row.id === item.marketplace?.lineItemId);
      const seller = item.marketplace?.sourceMerchantId ?? input.merchantId;
      const unit = Math.round(item.price * 100), gross = unit * item.quantity;
      assertMarketplaceProductOptions(variant?.product.metadata, item.selected_options);
      if (!variant?.isActive || !variant.product.isActive || variant.product.deletedAt || variant.product.merchantId !== seller ||
          variant.sku !== item.sku || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99 ||
          !Number.isSafeInteger(gross) || gross <= 0 || Math.abs(unit - item.price * 100) > 0.000001 ||
          (item.selected_options?.length ?? 0) > 0) throw new ConflictException("marketplace_funding_cart_mismatch");
      if (item.marketplace && (!record || record.sellerMerchantId !== seller || record.sourceVariantId !== variant.id ||
          record.quantity !== item.quantity || record.unitPriceCents !== unit || record.commissionCents !== item.marketplace.commissionCents ||
          record.commissionCents + record.sellerNetCents !== gross)) throw new ConflictException("marketplace_funding_cart_mismatch");
      return { lineItemId: record?.id ?? `host:${item.sku}`, sellerMerchantId: seller, grossAmountCents: gross,
        commissionCents: record?.commissionCents ?? 0, platformFeeCents: 0 };
    });
    for (const record of records) {
      const variant = variants.find(row => row.id === record.sourceVariantId)!;
      await assertMarketplacePartners(this.prisma, input.merchantId, record.sellerMerchantId, variant.product.categoryId);
    }
    const shipping = session.shipping as { customerPrice?: number; marketplace?: unknown } | null;
    const selectedShipping = shipping?.marketplace ? await assertMarketplaceShippingSelection(this.prisma, {
      merchantId: input.merchantId, sessionId: input.sessionId, cart, shipping,
      customer: session.customer as unknown as CheckoutSession["customer"] }) : undefined;
    if (!selectedShipping && variants.some(row => !["digital", "service"].includes(row.product.type))) {
      throw new ConflictException("marketplace_shipping_allocation_required");
    }
    // A scalar quote cannot identify the origin entitled to its proceeds.
    if (!selectedShipping && shipping?.customerPrice !== undefined && shipping.customerPrice !== 0) throw new ConflictException("marketplace_shipping_allocation_required");
    const options = await marketplacePaymentOptions(this.prisma, input.merchantId, records.map(row => row.sellerMerchantId));
    if (!this.provider.prepareMarketplaceAccount) throw new ConflictException("marketplace_capture_account_not_configured");
    const available = [];
    for (const option of options) {
      try { available.push({ ...option, account: await this.provider.prepareMarketplaceAccount(option) }); }
      catch { /* Unavailable platform accounts may only fall back before any submission. */ }
    }
    const routing = (merchant.storeSettings as MerchantStoreSettings | null)?.paymentRouting;
    const capabilities = resolveCheckoutPaymentCapabilities(routing, { asaas: available.some(row => row.provider === "asaas"),
      asaasHostedCard: available.some(row => row.provider === "asaas"), stripeCard: available.some(row => row.provider === "stripe"),
      mercadoPagoPix: false, mercadoPagoHostedCard: false });
    const selected = available.find(row => row.provider === capabilities.providers?.[input.method]);
    if (!selected) throw new ConflictException("marketplace_common_payment_provider_unavailable");
    const hostTerms: MarketplaceWindowConfig = { returnWindowDays: 0, payoutDelayDays: 0, chargebackWindowDays: 0 };
    for (const record of records) {
      const terms = record.termsJson as unknown as MarketplaceWindowConfig;
      new SettlementStateMachineService().validateConfig(terms);
      for (const key of ["returnWindowDays", "payoutDelayDays", "chargebackWindowDays"] as const) hostTerms[key] = Math.max(hostTerms[key], terms[key]);
    }
    const subtotal = lines.reduce((sum, row) => sum + row.grossAmountCents, 0);
    if (Math.round(cart.total * 100) !== subtotal) throw new ConflictException("marketplace_funding_cart_mismatch");
    const buyerServiceFeeCents = readBuyerServiceFeeCents();
    const instructions: FrozenMarketplaceFunding = { ...selected.account, hostMerchantId: input.merchantId, hostTerms,
      checkoutFingerprint: marketplacePaymentCartFingerprint({ cart, shipping: session.shipping as unknown as CheckoutSession["shipping"],
        customer: session.customer as unknown as CheckoutSession["customer"] }),
      feePolicy: "proportional_seller_sales_v1", currency: "BRL", amountCents: subtotal + buyerServiceFeeCents + (selectedShipping?.totalCents ?? 0),
      buyerServiceFeeCents, hostPlatformFeeCents: merchantTransactionFeeCentsFor(subscription), lines,
      shipping: selectedShipping?.allocations ?? [], ...(selectedShipping ? { shippingQuotes: selectedShipping.quotes } : {}), destinations: selected.destinations,
      hostStockItems: cart.items.filter(item => !item.marketplace).map(item => ({ lineItemId: `host:${item.sku}`,
        variantId: item.variantId!, sku: item.sku, quantity: item.quantity,
        requiresStock: !["digital", "service"].includes(variants.find(row => row.id === item.variantId)!.product.type) })) };
    buildMarketplaceFundingBudget(instructions, { ...instructions, providerPaymentId: "preflight", sourceId: "preflight",
      providerFeeCents: 0, netAmountCents: instructions.amountCents });
    return instructions;
  }
}
