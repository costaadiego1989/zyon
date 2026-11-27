import { randomUUID, createHash } from "node:crypto";
import type { createFiscalFixture } from "./fiscal-fixture.js";
import type { Prisma } from "@prisma/client";

/** Synthetic fixtures use the same persisted commercial linkage as fiscal snapshots. */
export async function seedFiscalSale(fixture: Awaited<ReturnType<typeof createFiscalFixture>>, options: {
  merchantId?: string; orderMerchantId?: string; orderId?: string; connectionId?: string;
  guestBuyer?: boolean; issuance?: boolean; stockOwner?: string; approvedAmountCents?: number; orderTotalCents?: number; buyerGlobalUserId?: string; orderLineItems?: Prisma.InputJsonValue;
  emailOwner?: "zyon" | "provider"; buyerEmail?: string | null; profileItemRules?: Prisma.InputJsonObject;
  buyerPhone?: string | null; profileSourceContractVersion?: string;
  environment?: "homologation" | "production"; provider?: "bling" | "omie" | "tiny" | "focus";
} = {}) {
  const prisma = fixture.prisma;
  const nonce = randomUUID().replaceAll("-", "");
  const merchantId = options.merchantId ?? fixture.tag + "_" + nonce;
  const orderMerchantId = options.orderMerchantId ?? merchantId;
  const orderId = options.orderId ?? "sale_" + nonce;
  const environment = options.environment ?? "homologation";
  const provider = options.provider ?? "focus";
  const now = new Date("2026-11-14T12:00:00.000Z");
  for (const id of new Set([merchantId, orderMerchantId])) {
    await prisma.merchant.upsert({ where: { id }, create: { id, name: "Loja fiscal sintética" }, update: {} });
  }
  let completedOrder = await prisma.completedOrder.findFirst({ where: { merchantId: orderMerchantId, externalOrderId: orderId } });
  if (!completedOrder) {
    const sessionId = fixture.tag + "_session_" + nonce;
    await prisma.checkoutSession.create({ data: { merchantId: orderMerchantId, sessionId, globalUserId: options.guestBuyer ? fixture.tag + "_unlinked_guest" : options.buyerGlobalUserId ?? fixture.tag + "_buyer",
      conversationId: fixture.tag + "_conversation_" + nonce, cart: { items: [{ sku: "sku_a", quantity: 1, unitPriceCents: 1000 }] }, createdAt: now, updatedAt: now } });
    completedOrder = await prisma.completedOrder.create({ data: { merchantId: orderMerchantId, sessionId, externalOrderId: orderId,
      orderTotal: options.issuance ? (options.orderTotalCents ?? options.approvedAmountCents ?? 2101) / 100 : 10, currency: "BRL", completedAt: now,
      shippingCents: options.issuance ? 202 : 0, lineItemsJson: options.orderLineItems ?? [{ lineId: "line_a", snapshotVersion: 2, sku: options.issuance ? "shirt" : "sku_a", quantity: options.issuance ? 2 : 1, unitPriceCents: 1000, productType: "physical" }] } });
  }
  const connection = options.connectionId ? await prisma.fiscalConnection.findFirstOrThrow({ where: { id: options.connectionId, merchantId, environment, provider } }) : await prisma.fiscalConnection.create({ data: { merchantId, environment, provider, issuerTaxId: "12ABC34501DE35",
    credentialCipher: "synthetic-cipher-not-a-provider-token", readiness: [], stockOwner: options.stockOwner ?? "zyon", emailOwner: options.emailOwner ?? "zyon", whatsappOwner: "zyon" } });
  const profile = await prisma.fiscalProfileVersion.upsert({ where: { merchantId_environment_provider_operation_version: { merchantId, environment, provider, operation: "sale", version: 1 } },
    create: { merchantId, environment, provider, operation: "sale", version: 1, issuerRegime: "simples_nacional", itemRules: options.profileItemRules ?? (options.issuance ? {
      currency: "BRL", supportedProductTypes: ["physical"], operation: { natureza_operacao: "Venda de mercadoria", tipo_documento: 1, finalidade_emissao: 1, local_destino: 1, consumidor_final: 1, presenca_comprador: 2, modalidade_frete: 0, indicador_inscricao_estadual_destinatario: 9 },
      items: { shirt: { productType: "physical", ncm: "61091000", cfop: "5102", origin: "0", unit: "UN", taxes: { icms_situacao_tributaria: "102", pis_situacao_tributaria: "07", cofins_situacao_tributaria: "07" } } }
    } : {}),
      recipientRequirements: ["name", "taxId"], sourceContractVersion: options.profileSourceContractVersion ?? "synthetic-v1", confirmedBy: fixture.tag + "_owner", confirmedAt: now }, update: {} });
  const snapshot = await prisma.fiscalSaleSnapshot.upsert({ where: { merchantId_orderId_environment: { merchantId, orderId, environment } },
    create: { merchantId, orderMerchantId, completedOrderId: completedOrder.id, orderId, environment, completedAt: now,
      buyerGlobalUserId: options.guestBuyer ? null : options.buyerGlobalUserId ?? fixture.tag + "_buyer", recipient: { name: "Comprador sintÃƒÆ’Ã‚Â©tico", taxId: "52998224725", ...(options.issuance ? { address: { street: "Rua Um", number: "12", neighborhood: "Centro", city: "Sao Paulo", state: "SP", postalCode: "01001000", cityCode: "3550308", countryCode: "1058" } } : {}) },
      items: options.issuance ? {
        version: 1, sessionId: completedOrder.sessionId, connectionId: connection.id, profileVersionId: profile.id, erpConnectionId: null,
        buyerContacts: { ...(options.buyerEmail !== null ? { email: options.buyerEmail ?? "buyer@example.test" } : {}), name: "Comprador", ...(options.buyerPhone !== null ? { phone: options.buyerPhone ?? "+5511999999999" } : {}) },
        policy: { stockOwner: options.stockOwner ?? "zyon", emailOwner: options.emailOwner ?? "zyon", whatsappOwner: "zyon" }, readinessCode: null, pendingLines: [], excludedLines: [],
        commercialLines: [{ lineId: "line_a", sellerMerchantId: merchantId, productType: "physical", sku: "shirt", name: "Camiseta", quantity: 2, unitPriceCents: 1000, grossCents: 2000, discountCents: 101, shippingCents: 202, totalCents: 2101 }],
        lines: [{ lineId: "line_a", sellerMerchantId: merchantId, productType: "physical", sku: "shirt", name: "Camiseta", quantity: 2, unitPriceCents: 1000, grossCents: 2000, discountCents: 101, shippingCents: 202, totalCents: 2101 }],
        fiscalTotals: { subtotalCents: 2000, discountCents: 101, shippingCents: 202, totalCents: 2101 }
      } : [{ lineId: "line_a", sku: "sku_a", quantity: 1, unitPriceCents: 1000 }], subtotalCents: options.issuance ? 2000 : 1000, discountCents: options.issuance ? 101 : 0,
      shippingCents: options.issuance ? 202 : 0, totalCents: options.issuance ? 2101 : 1000, paymentProofRef: "synthetic_approval_" + nonce,
      contentHash: createHash("sha256").update(nonce).digest("hex") }, update: {} });
  const intentData = { merchantId, environment, orderId, operation: "sale", connectionId: connection.id, profileVersionId: profile.id,
    snapshotId: snapshot.id, stableReference: "synthetic_nfe_" + nonce, state: "queued" as const, ...(options.issuance ? { nextAttemptAt: new Date(0) } : {}) };
  const intent = await prisma.fiscalIntent.create({ data: intentData });
  return { merchantId, orderMerchantId, orderId, environment, provider, connection, profile, snapshot, intent, intentData, completedOrder };
}
