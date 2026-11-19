import type { PrismaClient } from "@prisma/client";
import type { MetaAdsProduct } from "@zyon/shared-types";
import type { ProductRepositoryPort } from "../../catalog/domain/ports/product-repository.port.js";
import type { MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import type { PaymentPlatformRepository } from "../../payment/domain/ports/payment-platform-repository.port.js";
import { effectiveBillingPlan } from "../../payment/domain/billing-plans.js";
import { assertPaymentAmount, orderTotalCents, type PaymentAmountBreakdown } from "../../payment/domain/payment-amount.js";
import { MetaAdsError, type CommerceContextPort, type PaidOrderFact, type Clock } from "../domain/types.js";
import { requireIdentifier, stableDigest, type MetaAdsEnvironment } from "../domain/offer.js";

interface PurchaseRow { id: string; merchant_id: string; session_id: string; order_total: string; currency: string; completed_at: Date;
  payment_status: string | null; amount_cents: number | null; approved_amount_cents: number | null; amount_breakdown: PaymentAmountBreakdown | null;
  status_history: Array<{ status: string; occurredAt: string }> | null; refunded_cents: bigint | null; }

/** Anti-corruption adapter: domain reads use exported contracts; payment reconciliation is a tenant-filtered read projection. */
export class CommerceContextAdapter implements CommerceContextPort {
  constructor(private readonly prisma: PrismaClient, private readonly catalog: Pick<ProductRepositoryPort, "search" | "findByVariantIds"> & Partial<Pick<ProductRepositoryPort,"listCategories">>,
    private readonly merchants: Pick<MerchantRepository, "getProfile">, private readonly billing: Pick<PaymentPlatformRepository, "getBilling">,
    private readonly env: MetaAdsEnvironment, private readonly clock: Clock = () => new Date()) {}
  async getPlan(merchantId: string) {
    requireIdentifier(merchantId);
    return effectiveBillingPlan(await this.billing.getBilling(merchantId), this.clock());
  }
  private async store(merchantId: string) {
    requireIdentifier(merchantId);
    const profile = await this.merchants.getProfile(merchantId);
    if (!profile || profile.id !== merchantId) throw new MetaAdsError("merchant_not_found", 404);
    try {
      const url = new URL(this.env.STOREFRONT_PUBLIC_URL ?? "");
      const slug = profile.storeSettings?.slug ?? profile.slug;
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || typeof slug !== 'string' || !slug.trim()) throw new Error();
      url.pathname = `/store/${encodeURIComponent(slug)}`;
      return { profile, url };
    } catch { throw new MetaAdsError("storefront_url_unavailable", 503); }
  }
  async getProfile(merchantId: string) {
    const { profile, url } = await this.store(merchantId);
    const subscription = await this.billing.getBilling(merchantId);
    let email = profile.storeSettings?.company?.email;
    if (!email) {
      const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { billingAccountMerchantId: true } });
      const owner = await this.prisma.merchantUser.findFirst({ where: { merchantId: merchant?.billingAccountMerchantId ?? merchantId, role: { in: ["owner", "admin"] } }, select: { email: true }, orderBy: { createdAt: "asc" } });
      email = owner?.email;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new MetaAdsError("addon_billing_email_required", 409);
    return { name: profile.name, email, storefrontUrl: url.href, stripeCustomerId: subscription?.stripeCustomerId ?? null };
  }
  async categories(merchantId:string,input:{query?:string;limit?:number}={}){
    requireIdentifier(merchantId);const limit=input.limit??5;
    if(!Number.isSafeInteger(limit)||limit<1||limit>5||(input.query?.length??0)>200)throw new MetaAdsError('catalog_query_invalid');
    if(!this.catalog.listCategories)throw new MetaAdsError('catalog_categories_unavailable',503);
    const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const query=normalize(input.query?.trim()??'');
    const rows=(await this.catalog.listCategories(merchantId,{publicOnly:true})).filter(row=>row.productCount>0&&(!query||normalize(row.name).includes(query))).sort((a,b)=>a.id.localeCompare(b.id));
    return {categories:rows.slice(0,limit).map(({id,name,productCount})=>({id,name,productCount})),hasMore:rows.length>limit};
  }
  async products(merchantId: string, input: { variantIds?: string[]; query?: string; categoryId?:string; limit?: number } = {}): Promise<MetaAdsProduct[]> {
    const { url } = await this.store(merchantId);
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (input.query?.length ?? 0) > 200) throw new MetaAdsError("catalog_query_invalid");
    if (input.variantIds && (input.variantIds.length < 1 || input.variantIds.length > 30 || new Set(input.variantIds).size !== input.variantIds.length)) throw new MetaAdsError("campaign_products_invalid");
    for (const variantId of input.variantIds ?? []) requireIdentifier(variantId);
    if(input.categoryId)requireIdentifier(input.categoryId);
    if (input.variantIds && !this.catalog.findByVariantIds) throw new MetaAdsError("catalog_selection_unavailable", 503);
    const products = input.variantIds ? await this.catalog.findByVariantIds!(merchantId, input.variantIds) : (await this.catalog.search({ merchantId, query: input.query, ...(input.categoryId?{categoryId:input.categoryId}:{}), limit, status: "active" })).products;
    const variants: MetaAdsProduct[] = [];
    for (const product of products) {
      if (product.merchantId !== merchantId) throw new MetaAdsError("catalog_tenant_mismatch", 403);
      for (const variant of product.variants) {
        if (input.variantIds && !input.variantIds.includes(variant.id)) continue;
        const link = new URL(url); link.searchParams.set("show", "content"); link.searchParams.set("product", product.id);
        const value = { productId: product.id, variantId: variant.id, name: product.name, description: product.description ?? "", sku: variant.sku,
          imageUrl: [...variant.media].sort((a, b) => a.order - b.order).find(media => media.type === "IMAGE")?.url ?? null,
          priceCents: variant.basePriceInCents, currency: variant.currency, stockQuantity: ["digital", "service"].includes(product.type) ? null : Math.max(0, variant.stockQuantity - variant.stockReserved),
          active: product.isActive && variant.isActive && (!["digital", "service"].includes(product.type) || product.hasStock), storefrontUrl: link.href };
        const { stockQuantity: _stockQuantity, ...commercial } = value;
        variants.push({ ...value, commercialVersion: stableDigest(commercial) });
      }
    }
    return input.variantIds ? input.variantIds.flatMap(variantId => variants.filter(v => v.variantId === variantId)) : variants.slice(0, limit);
  }
  async paidOrder(merchantId: string, orderId: string): Promise<PaidOrderFact | null> {
    requireIdentifier(merchantId);
    if (!orderId || orderId.length > 200) throw new MetaAdsError("order_id_invalid");
    const [row] = await this.prisma.$queryRaw<PurchaseRow[]>`SELECT o.id,o.merchant_id,o.session_id,o.order_total::text,o.currency,o.completed_at,
      p.status AS payment_status,p.amount_cents,p.approved_amount_cents,p.amount_breakdown,p.status_history,
      (SELECT COALESCE(SUM(rf.amount_in_cents),0) FROM returns r JOIN return_refunds rf ON rf.return_id=r.id
        WHERE r.merchant_id=${merchantId} AND (r.order_id=o.id OR r.order_id=o.external_order_id) AND rf.status='COMPLETED') AS refunded_cents
      FROM completed_orders o LEFT JOIN LATERAL (SELECT * FROM payment_intents pi WHERE pi.merchant_id=${merchantId} AND pi.session_id=o.session_id
        AND pi.currency=o.currency AND pi.status IN ('approved','refunded','chargeback_won') ORDER BY pi.updated_at DESC,pi.id DESC LIMIT 1) p ON true
      WHERE o.merchant_id=${merchantId} AND (o.id=${orderId} OR o.external_order_id=${orderId}) ORDER BY (o.id=${orderId}) DESC,o.completed_at ASC LIMIT 1`;
    if (!row) return null;
    const paid = Boolean(row.payment_status); const amount = Math.round(Number(row.order_total) * 100);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new MetaAdsError("purchase_amount_unreconciled", 409);
    if (paid) {
      const approved = row.approved_amount_cents ?? row.amount_cents ?? 0;
      if (row.amount_breakdown) {
        assertPaymentAmount(row.amount_breakdown, approved, row.currency);
        if (orderTotalCents(row.amount_breakdown, approved) !== amount) throw new MetaAdsError("purchase_amount_unreconciled", 409);
      } else if (approved < amount) throw new MetaAdsError("purchase_amount_unreconciled", 409);
    }
    const approvedAt = row.status_history?.find(entry => entry.status === "approved")?.occurredAt;
    const paidAt = approvedAt && Number.isFinite(new Date(approvedAt).getTime()) ? new Date(approvedAt) : row.completed_at;
    return { orderId: row.id, merchantId, sessionId: row.session_id, paid, paidAt: paidAt.toISOString(), currency: row.currency, paidCents: paid ? amount : 0,
      refundedCents: !paid ? 0 : row.payment_status === "refunded" ? amount : Math.min(amount, Number(row.refunded_cents ?? 0)),
      // Existing checkout snapshots contain no immutable full cost ledger. Today's catalog is not historical cost.
      costCents: null, costCoverage: "unavailable" };
  }
  async paidOrders(merchantId: string, since: string, until: string): Promise<PaidOrderFact[]> {
    requireIdentifier(merchantId); const start = new Date(since); const end = new Date(until);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() - start.getTime() > 366 * 86400000) throw new MetaAdsError("metrics_period_invalid");
    const result: PaidOrderFact[] = []; let cursor = "";
    while (true) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM completed_orders WHERE merchant_id=${merchantId} AND completed_at>=${start} AND completed_at<${end} AND id>${cursor} ORDER BY id ASC LIMIT 250`;
      for (const row of rows) { const fact = await this.paidOrder(merchantId, row.id); if (fact?.paid) result.push(fact); }
      if (rows.length < 250) return result;
      cursor = rows[rows.length - 1].id;
    }
  }
}
