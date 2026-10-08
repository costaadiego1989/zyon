import { ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Cart, CustomerHints, PackageDimensions, ShippingQuote } from "@zyon/shared-types";
import { assertMarketplacePartners } from "./prisma-marketplace-cart.repository.js";
import { assertMarketplaceProductOptions } from "../../domain/services/marketplace-product-options.js";
import { assertMarketplaceShippingContract, marketplaceShippingContractHash, type MarketplaceShippingContract } from
  "../../../shipping/domain/marketplace-shipping-contract.js";
import { assertCarrierQuote } from "../../../shipping/domain/marketplace-shipment-journal.js";

export interface MarketplaceShippingQuoteBinding {
  merchantId: string; quoteId: string; quoteKey: string; carrierKey: string; amountCents: number;
  carrierQuoteHash?: string;
}
export interface MarketplaceShippingSelection extends ShippingQuote {
  marketplace: { version: 1; quotes: MarketplaceShippingQuoteBinding[] };
}
export interface MarketplaceShippingCheckout {
  merchantId: string; sessionId: string; cart: Cart; shipping?: unknown; customer?: CustomerHints | null;
}
type Db = Prisma.TransactionClient;
function fail(reason: string): never { throw new ConflictException(`marketplace_shipping_${reason}`); }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const zip = (value: unknown) => typeof value === "string" ? value.replace(/\D/g, "") : "";
const validCents = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647;

/** Cross-merchant reads below are restricted to persisted, authorized cart lines.
 * Quotes are owned by the host; their origin is cryptographically bound in the key. */
export async function marketplaceShippingOrigins(db: Db, input: MarketplaceShippingCheckout) {
  const { cart } = input;
  if (!input.merchantId || !input.sessionId || cart.currency !== "BRL" || !cart.items?.length || cart.items.length > 100 ||
      cart.currentDiscount || cart.commercialNudge || cart.commerceCartRef) fail("cart_invalid");
  const cartRef = (cart as Cart & { cart_ref?: string }).cart_ref ?? input.sessionId;
  const records = await db.crossStoreLineItem.findMany({ where: { hostMerchantId: input.merchantId, checkoutSessionId: cartRef } });
  if (!records.length || records.length !== cart.items.filter(item => item.marketplace).length) fail("cart_invalid");
  const variants = await db.productVariant.findMany({ where: { id: { in: cart.items.map(item => item.variantId ?? "") } },
    include: { product: true, price: true, stock: true } });
  const lines = [];
  for (const item of cart.items) {
    const variant = variants.find(row => row.id === item.variantId), seller = item.marketplace?.sourceMerchantId ?? input.merchantId;
    const unit = Math.round(item.price * 100), record = records.find(row => row.id === item.marketplace?.lineItemId);
    if (!variant?.isActive || !variant.product.isActive || variant.product.deletedAt || variant.product.merchantId !== seller ||
        variant.sku !== item.sku || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99 ||
        !validCents(unit) || unit <= 0 || Math.abs(unit - item.price * 100) > 0.000001 ||
        variant.price?.currency !== "BRL" || variant.price.basePriceInCents !== unit) fail("cart_invalid");
    assertMarketplaceProductOptions(variant.product.metadata, item.selected_options);
    if (item.marketplace) {
      if (!record || record.orderId || record.sellerMerchantId !== seller || record.sourceVariantId !== variant.id ||
          record.quantity !== item.quantity || record.unitPriceCents !== unit || record.commissionCents !== item.marketplace.commissionCents ||
          record.stockReservationId !== item.marketplace.stockReservationId) fail("cart_invalid");
      await assertMarketplacePartners(db, input.merchantId, seller, variant.product.categoryId);
    }
    const physical = !["digital", "service"].includes(variant.product.type);
    const dimensions = [variant.weightGrams, variant.heightCm, variant.widthCm, variant.lengthCm];
    if (physical && dimensions.some(value => typeof value !== "number" || !Number.isFinite(value) || value <= 0)) fail("dimensions_required");
    // Merchant originZip cannot identify a warehouse when stock spans origins.
    if (physical && variant.stock.length !== 1) fail("warehouse_mapping_required");
    lines.push({ merchantId: seller, lineId: record?.id ?? `host:${item.sku}`, variantId: variant.id, sku: item.sku,
      quantity: item.quantity, unitPriceCents: unit, physical, dimensions, warehouseId: physical ? variant.stock[0].warehouseId : null });
  }
  lines.sort((a, b) => a.lineId.localeCompare(b.lineId));
  if (new Set(lines.map(line => line.lineId)).size !== lines.length || Math.round(cart.total * 100) !==
      lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0)) fail("cart_invalid");
  const physicalMerchants = [...new Set(lines.filter(line => line.physical).map(line => line.merchantId))].sort();
  const address = input.customer?.address;
  const destinationZip = zip(address?.zip);
  if (physicalMerchants.length && !/^\d{8}$/.test(destinationZip)) fail("destination_required");
  const addressIdentity = [destinationZip, address?.street?.trim() ?? "", address?.number?.trim() ?? "", address?.complement?.trim() ?? "",
    address?.neighborhood?.trim() ?? "", address?.city?.trim() ?? "", address?.state?.trim().toUpperCase() ?? ""];
  const origins = [];
  for (const merchantId of physicalMerchants) {
    const merchant = await db.merchant.findUnique({ where: { id: merchantId }, select: {
      melhorEnvioEnabled: true, melhorEnvioAccessToken: true, melhorEnvioRefreshToken: true, ownDeliveryConfig: true } });
    if (!merchant?.melhorEnvioEnabled || (!merchant.melhorEnvioAccessToken && !merchant.melhorEnvioRefreshToken)) fail("carrier_account_required");
    if (merchant.ownDeliveryConfig?.enabled) fail("own_delivery_not_supported");
    // MerchantRule has no Merchant relation. The participant identity has already
    // been checked above; a parameterized read avoids host middleware rewriting it.
    const rules = await db.$queryRaw<Array<{ originZip: string | null; allowFreeShipping: boolean; threshold: Prisma.Decimal; updatedAt: Date }>>`
      SELECT origin_zip AS "originZip", allow_free_shipping AS "allowFreeShipping", free_shipping_min_cart_value AS threshold,
        updated_at AS "updatedAt" FROM merchant_rules WHERE merchant_id = ${merchantId}`;
    const rule = rules[0], originZip = zip(rule?.originZip);
    if (!rule || !/^\d{8}$/.test(originZip)) fail("origin_required");
    const ownLines = lines.filter(line => line.merchantId === merchantId), subtotal = ownLines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
    if (rule.allowFreeShipping && subtotal >= Math.round(Number(rule.threshold) * 100)) fail("subsidy_allocation_required");
    const packages: PackageDimensions[] = ownLines.filter(line => line.physical).map(line => ({
      weightKg: line.dimensions[0]! / 1000, heightCm: line.dimensions[1]!, widthCm: line.dimensions[2]!, lengthCm: line.dimensions[3]!, quantity: line.quantity }));
    const physicalLines = ownLines.filter(line => line.physical);
    const shipmentContract: MarketplaceShippingContract = { version: 2, merchantId, originZip, destinationZip,
      products: physicalLines.map((line, index) => ({ ...packages[index], lineItemId: line.lineId, variantId: line.variantId,
        sku: line.sku, unitValueCents: line.unitPriceCents })),
      insuranceTotalCents: physicalLines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0) };
    const quoteKey = `marketplace-v2:${hash({ host: input.merchantId, session: input.sessionId, cartRef, merchantId, originZip,
      destination: addressIdentity, lines, ruleVersion: rule.updatedAt.toISOString() })}:${marketplaceShippingContractHash(shipmentContract)}`;
    assertMarketplaceShippingContract(shipmentContract, quoteKey, merchantId);
    origins.push({ merchantId, originZip, destinationZip, cartTotalCents: subtotal, packages, quoteKey, shipmentContract,
      insuranceProducts: physicalLines.map(line => ({ id: line.lineId, unitValueCents: line.unitPriceCents })),
      sessionId: `marketplace:${hash([input.merchantId, input.sessionId, merchantId])}` });
  }
  return { destinationZip, origins };
}

export async function assertMarketplaceShippingSelection(db: Db, input: MarketplaceShippingCheckout, now = new Date()) {
  const shipping = input.shipping as Partial<MarketplaceShippingSelection> | null;
  const selected = shipping?.marketplace;
  if (!selected || selected.version !== 1 || !Array.isArray(selected.quotes)) fail("selection_required");
  if (selected.quotes.some(row => !row || typeof row.merchantId !== "string" || typeof row.quoteId !== "string" ||
      typeof row.quoteKey !== "string" || typeof row.carrierKey !== "string" || !validCents(row.amountCents))) fail("selection_mismatch");
  const { origins, destinationZip } = await marketplaceShippingOrigins(db, input);
  if (selected.quotes.length !== origins.length || new Set(selected.quotes.map(row => row.merchantId)).size !== origins.length ||
      new Set(selected.quotes.map(row => row.quoteId)).size !== origins.length) fail("selection_mismatch");
  const quotes: MarketplaceShippingQuoteBinding[] = [];
  let deliveryDays = 0;
  for (const origin of origins) {
    const binding = selected.quotes.find(row => row.merchantId === origin.merchantId)!;
    if (!binding || binding.quoteKey !== origin.quoteKey) fail("selection_mismatch");
    const quote = await db.shippingQuote.findFirst({ where: { id: binding.quoteId, merchantId: input.merchantId, sessionId: origin.sessionId } });
    if (!quote || quote.quoteKey !== origin.quoteKey || quote.destinationZip !== destinationZip || quote.expiresAt <= now ||
        quote.selectedCarrierKey !== binding.carrierKey || !Array.isArray(quote.results)) fail("quote_invalid");
    const matches = (quote.results as Array<Record<string, unknown>>).filter(row => row.carrier_key === binding.carrierKey);
    const result = matches[0];
    if (matches.length !== 1 || !result || result.currency !== "BRL" || !/^melhor-envio-(1|2|17)$/.test(binding.carrierKey) || !validCents(result.price) || result.price <= 0 ||
        result.price !== binding.amountCents || !Number.isSafeInteger(result.eta_days) || Number(result.eta_days) < 0) fail("quote_invalid");
    const contract = assertMarketplaceShippingContract(result.marketplaceShipmentContract, binding.quoteKey, origin.merchantId);
    if (typeof binding.carrierQuoteHash !== "string") fail("carrier_quote_binding_required");
    assertCarrierQuote(result.marketplaceCarrierQuote, binding.carrierQuoteHash!, contract,
      Number(binding.carrierKey.slice("melhor-envio-".length)), binding.amountCents);
    deliveryDays = Math.max(deliveryDays, Number(result.eta_days));
    quotes.push({ merchantId: origin.merchantId, quoteId: quote.id, quoteKey: origin.quoteKey,
      carrierKey: binding.carrierKey, amountCents: result.price,
      ...(binding.carrierQuoteHash !== undefined ? { carrierQuoteHash: binding.carrierQuoteHash } : {}) });
  }
  const total = quotes.reduce((sum, row) => sum + row.amountCents, 0);
  if (!validCents(total) || typeof shipping?.customerPrice !== "number" || Math.abs(shipping.customerPrice * 100 - total) > 0.000001 ||
      shipping.destinationZip !== destinationZip) fail("selection_mismatch");
  return { quotes, allocations: quotes.map(row => ({ merchantId: row.merchantId, amountCents: row.amountCents })), totalCents: total, deliveryDays };
}
