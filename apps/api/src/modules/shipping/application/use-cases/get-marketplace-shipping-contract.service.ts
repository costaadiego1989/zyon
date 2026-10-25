import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { FrozenMarketplaceFunding } from "../../../marketplace/domain/services/marketplace-funding-budget.js";
import { fundingHash } from "../../../marketplace/infrastructure/repositories/prisma-marketplace-funding.repository.js";
import { assertMarketplaceShippingContract } from "../../domain/marketplace-shipping-contract.js";
import { assertCarrierQuote } from "../../domain/marketplace-shipment-journal.js";

/** Read-only recovery of the paid quotation. This is not authorization to buy a
 * label: a per-origin purchase journal, full addresses and returned carrier
 * volumes are still required by that separate operation. */
@Injectable()
export class GetMarketplaceShippingContractService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: { merchantId: string; paymentIntentId: string; originMerchantId: string }) {
    return this.prisma.$transaction(tx => this.read(tx, input), { isolationLevel: "RepeatableRead" });
  }

  async read(tx: Prisma.TransactionClient, input: { merchantId: string; paymentIntentId: string; originMerchantId: string }) {
      const missing = () => new NotFoundException("marketplace_shipping_contract_not_found");
      const invalid = () => new ConflictException("marketplace_shipping_contract_payment_invalid");
      // Query both records with an explicit host predicate. A nested relation
      // alone does not enforce the application's tenant middleware.
      const payment = await tx.paymentIntent.findFirst({ where: { id: input.paymentIntentId, merchantId: input.merchantId } });
      const plan = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: input.paymentIntentId, hostMerchantId: input.merchantId } });
      if (!payment || !plan || payment.merchantId !== input.merchantId || plan.hostMerchantId !== input.merchantId) throw missing();
      const frozen = plan.instructions as unknown as FrozenMarketplaceFunding;
      const creation = payment.creation as { input?: { marketplaceFunding?: unknown } } | null;
      if (plan.status !== "funded" || !plan.fundedAt || payment.status !== "approved" || payment.currency !== "BRL" ||
          !payment.providerPaymentId || payment.providerPaymentId !== plan.providerPaymentId || payment.amountCents !== plan.amountCents ||
          payment.approvedAmountCents !== plan.amountCents || !frozen || fundingHash(frozen) !== plan.instructionsHash ||
          fundingHash(creation?.input?.marketplaceFunding ?? null) !== plan.instructionsHash || frozen.hostMerchantId !== input.merchantId ||
          frozen.amountCents !== plan.amountCents || frozen.currency !== "BRL" || frozen.provider !== plan.provider ||
          frozen.environment !== plan.environment || frozen.accountFingerprint !== plan.accountFingerprint ||
          !Array.isArray(frozen.shipping) || !Array.isArray(frozen.lines)) throw invalid();
      const bindings = frozen.shippingQuotes?.filter(row => row.merchantId === input.originMerchantId);
      if (!bindings?.length) throw missing();
      if (bindings.length !== 1) throw invalid();
      const binding = bindings[0];
      const quote = await tx.shippingQuote.findFirst({ where: { id: binding.quoteId, merchantId: input.merchantId } });
      if (!quote || quote.quoteKey !== binding.quoteKey || quote.selectedCarrierKey !== binding.carrierKey || !Array.isArray(quote.results)) throw invalid();
      const options = (quote.results as Array<Record<string, unknown>>).filter(row => row.carrier_key === binding.carrierKey);
      const option = options[0];
      if (options.length !== 1 || !option || option.currency !== "BRL" || option.price !== binding.amountCents ||
          !/^melhor-envio-[1-9]\d*$/.test(binding.carrierKey) ||
          frozen.shipping.filter(row => row.merchantId === input.originMerchantId && row.amountCents === binding.amountCents).length !== 1) throw invalid();
      const contract = assertMarketplaceShippingContract(option.marketplaceShipmentContract, binding.quoteKey, input.originMerchantId);
      if (contract.destinationZip !== quote.destinationZip) throw invalid();
      // Product price/configuration and quote expiry can change after payment.
      // The frozen quote digest is authoritative; do not price the order again.
      for (const product of contract.products) {
        const lines = frozen.lines.filter(line => line.lineItemId === product.lineItemId && line.sellerMerchantId === input.originMerchantId);
        if (lines.length !== 1 || lines[0].grossAmountCents !== product.unitValueCents * product.quantity) throw invalid();
      }
      const carrierQuote = binding.carrierQuoteHash ? assertCarrierQuote(option.marketplaceCarrierQuote, binding.carrierQuoteHash,
        contract, Number(binding.carrierKey.slice("melhor-envio-".length)), binding.amountCents) : undefined;
      return { fundingPlanId: plan.paymentIntentId, checkoutFingerprint: frozen.checkoutFingerprint, sessionId: payment.sessionId,
        paymentIntentId: plan.paymentIntentId, providerPaymentId: plan.providerPaymentId, quoteId: quote.id,
        quoteKey: quote.quoteKey, carrierKey: binding.carrierKey, serviceId: Number(binding.carrierKey.slice("melhor-envio-".length)),
        amountCents: binding.amountCents, currency: "BRL" as const, shipment: contract,
        ...(carrierQuote ? { carrierQuote, carrierQuoteHash: binding.carrierQuoteHash } : {}) };
  }
}
