import { Injectable } from "@nestjs/common";
import { PAYMENT_INTENT_REPOSITORY } from "../../domain/ports/payment-platform-repository.port.js";
import type { PaymentIntentRepository } from "../../domain/ports/payment-platform-repository.port.js";

export interface ListPaymentChargebacksInput {
  merchantId: string;
  status?: "pending" | "disputed" | "lost" | "won";
  startDate?: Date;
  endDate?: Date;
}

export interface PaymentChargebackEntry {
  paymentIntentId: string;
  orderId: string;
  amountCents: number;
  provider: string;
  providerPaymentId: string | null;
  disputeStatus: "pending" | "disputed" | "lost" | "won";
  disputeOpenedAt: Date;
  disputeReason: string | null;
  customerEmail: string | null;
  createdAt: Date;
}

export interface ListPaymentChargebacksOutput {
  chargebacks: PaymentChargebackEntry[];
  total: number;
  totalPendingCents: number;
  totalLostCents: number;
  totalWonCents: number;
}

const DISPUTE_STATUSES = ["chargeback_pending", "chargeback_disputed", "chargeback_lost", "chargeback_won"];

@Injectable()
export class ListPaymentChargebacksUseCase {
  constructor(
    private readonly paymentIntentRepository: PaymentIntentRepository,
  ) {}

  async execute(
    input: ListPaymentChargebacksInput,
  ): Promise<ListPaymentChargebacksOutput> {
    // Fetch all PaymentIntents with chargeback-like status
    const allIntents = await this.paymentIntentRepository.findByMerchantId(
      input.merchantId,
    );

    const chargebackIntents = allIntents.filter((intent) =>
      DISPUTE_STATUSES.includes(intent.status),
    );

    const chargebacks: PaymentChargebackEntry[] = chargebackIntents.map((intent) => ({
      paymentIntentId: intent.id,
      orderId: intent.commerceOrderId ?? intent.sessionId,
      amountCents: intent.amountCents,
      provider: this.detectProvider(intent),
      providerPaymentId: intent.providerPaymentId ?? null,
      disputeStatus: this.toDisputeStatus(intent.status),
      disputeOpenedAt: intent.updatedAt,
      disputeReason: null,
      customerEmail: null,
      createdAt: intent.createdAt,
    }));

    // Filter by status if provided
    let filtered = chargebacks;
    if (input.status) {
      filtered = filtered.filter((c) => c.disputeStatus === input.status);
    }
    if (input.startDate) {
      filtered = filtered.filter((c) => c.disputeOpenedAt >= input.startDate!);
    }
    if (input.endDate) {
      filtered = filtered.filter((c) => c.disputeOpenedAt <= input.endDate!);
    }

    filtered.sort((a, b) => b.disputeOpenedAt.getTime() - a.disputeOpenedAt.getTime());

    const totalPendingCents = filtered
      .filter((c) => c.disputeStatus === "pending" || c.disputeStatus === "disputed")
      .reduce((sum, c) => sum + c.amountCents, 0);

    const totalLostCents = filtered
      .filter((c) => c.disputeStatus === "lost")
      .reduce((sum, c) => sum + c.amountCents, 0);

    const totalWonCents = filtered
      .filter((c) => c.disputeStatus === "won")
      .reduce((sum, c) => sum + c.amountCents, 0);

    return {
      chargebacks: filtered,
      total: filtered.length,
      totalPendingCents,
      totalLostCents,
      totalWonCents,
    };
  }

  private detectProvider(intent: any): string {
    if (intent.providerPaymentId?.startsWith("pi_")) return "stripe";
    if (intent.providerPaymentId?.startsWith("pay_")) return "asaas";
    return "unknown";
  }

  private toDisputeStatus(status: string): "pending" | "disputed" | "lost" | "won" {
    switch (status) {
      case "chargeback_pending":
        return "pending";
      case "chargeback_disputed":
        return "disputed";
      case "chargeback_lost":
        return "lost";
      case "chargeback_won":
        return "won";
      default:
        return "pending";
    }
  }
}
