import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { DomainEventEnvelope } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import {
  ShippingQuoteEntity,
  type ShippingQuoteResult,
  type ShippingQuoteSnapshot
} from "../../domain/entities/shipping-quote.entity.js";
import type { ShippingCheckoutQuoteRepository, ShippingCheckoutTransaction } from "../../application/ports/shipping-checkout-transaction.port.js";
import { PrismaCheckoutRepository } from "../../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { PrismaMerchantRepository } from "../../../merchant/infrastructure/prisma-merchant.repository.js";
import { PrismaOwnDeliveryConfigRepository } from "./prisma-own-delivery-config.repository.js";
import { CheckoutCommercialBenefitsService } from "../../../cashback/application/checkout-commercial-benefits.service.js";
import { lockExecutionMerchant } from "../../../revenue-manager/infrastructure/strategy-execution-ledger.js";

interface ShippingQuoteRow {
  id: string;
  merchantId: string;
  sessionId: string;
  destinationZip: string;
  quoteKey: string;
  results: Prisma.JsonValue;
  selectedCarrierKey: string | null;
  createdAt: Date;
  expiresAt: Date;
}

@Injectable()
export class PrismaShippingQuoteRepository implements ShippingCheckoutQuoteRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly benefits?: CheckoutCommercialBenefitsService,
    private readonly inTransaction = false) {}

  async withCheckoutTransaction<T>(scope: { merchantId: string; sessionId: string }, work: (context: ShippingCheckoutTransaction) => Promise<T>): Promise<T> {
    const run = async (tx: Prisma.TransactionClient) => {
      await this.benefits?.lockInTransaction(tx, scope.merchantId);
      await lockExecutionMerchant(tx, scope.merchantId);
      await tx.$queryRaw`SELECT merchant_id FROM merchant_rules WHERE merchant_id=${scope.merchantId} FOR SHARE`;
      await tx.$queryRaw`SELECT merchant_id FROM own_delivery_configs WHERE merchant_id=${scope.merchantId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id=${scope.merchantId} AND session_id=${scope.sessionId} FOR UPDATE`;
      const client = tx as PrismaClient;
      return work({ prisma: client, sessions: new PrismaCheckoutRepository(tx, true, undefined, this.benefits),
        quotes: new PrismaShippingQuoteRepository(client, this.benefits, true),
        merchantRules: new PrismaMerchantRepository(client), ownDeliveryConfig: new PrismaOwnDeliveryConfigRepository(client) });
    };
    return this.inTransaction ? run(this.prisma) : this.prisma.$transaction(run);
  }

  async saveWithEvents(quote: ShippingQuoteEntity): Promise<void> {
    const snapshot = quote.snapshot();
    const events = quote.pullEvents();
    const save = async (tx: Prisma.TransactionClient) => {
      await tx.shippingQuote.upsert({
        where: { id: snapshot.id },
        create: this.toCreate(snapshot),
        update: {
          results: snapshot.results as unknown as Prisma.InputJsonValue,
          selectedCarrierKey: snapshot.selected_carrier_key,
          expiresAt: new Date(snapshot.expires_at)
        }
      });
      for (const event of events) {
        await tx.outboxMessage.upsert({
          where: { eventId: event.event_id },
          create: this.toOutboxCreate(event),
          update: {}
        });
      }
    };
    if (this.inTransaction) await save(this.prisma);
    else await this.prisma.$transaction(save);
  }

  async findById(id: string, merchantId: string): Promise<ShippingQuoteEntity | null> {
    const row = await this.prisma.shippingQuote.findFirst({ where: { id: id.trim(), merchantId } });
    return row ? ShippingQuoteEntity.rehydrate(toSnapshot(row as ShippingQuoteRow)) : null;
  }

  async findBySession(sessionId: string, merchantId: string): Promise<ShippingQuoteEntity | null> {
    const row = await this.prisma.shippingQuote.findFirst({
      where: { sessionId: sessionId.trim(), merchantId },
      orderBy: { createdAt: "desc" }
    });
    return row ? ShippingQuoteEntity.rehydrate(toSnapshot(row as ShippingQuoteRow)) : null;
  }

  async findValidByKey(
    quoteKey: string,
    merchantId: string,
    now: Date = new Date()
  ): Promise<ShippingQuoteEntity | null> {
    if (!quoteKey) return null;
    const row = await this.prisma.shippingQuote.findFirst({
      where: { quoteKey, merchantId, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" }
    });
    return row ? ShippingQuoteEntity.rehydrate(toSnapshot(row as ShippingQuoteRow)) : null;
  }

  private toCreate(snapshot: ShippingQuoteSnapshot): Prisma.ShippingQuoteUncheckedCreateInput {
    return {
      id: snapshot.id,
      merchantId: snapshot.merchant_id,
      sessionId: snapshot.session_id,
      destinationZip: snapshot.destination_zip,
      quoteKey: snapshot.quote_key,
      results: snapshot.results as unknown as Prisma.InputJsonValue,
      selectedCarrierKey: snapshot.selected_carrier_key,
      createdAt: new Date(snapshot.created_at),
      expiresAt: new Date(snapshot.expires_at)
    };
  }

  private toOutboxCreate(event: DomainEventEnvelope): Prisma.OutboxMessageUncheckedCreateInput {
    return {
      eventId: event.event_id,
      eventType: event.event_type,
      schemaVersion: event.schema_version,
      merchantId: event.merchant_id,
      occurredAt: new Date(event.occurred_at),
      correlationId: event.correlation_id,
      causationId: event.causation_id,
      producer: event.producer,
      payload: event.payload as Prisma.InputJsonValue
    };
  }
}

function toSnapshot(row: ShippingQuoteRow): ShippingQuoteSnapshot {
  return {
    id: row.id,
    merchant_id: row.merchantId,
    session_id: row.sessionId,
    destination_zip: row.destinationZip,
    quote_key: row.quoteKey,
    results: Array.isArray(row.results) ? (row.results as unknown as ShippingQuoteResult[]) : [],
    selected_carrier_key: row.selectedCarrierKey,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt.toISOString()
  };
}
