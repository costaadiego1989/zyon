import { Injectable } from "@nestjs/common";
import { PAYMENT_REPOSITORY } from "../../domain/ports/payment-repository.port.js";
import type { PaymentRepository } from "../../domain/ports/payment-repository.port.js";

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

const CHARGEBACK_STATUS_PREFIX = "chargeback_";

@Injectable()
export class ListPaymentChargebacksUseCase {
  constructor(
    private readonly paymentRepository: PaymentRepository,
  ) {}

  async execute(
    input: ListPaymentChargebacksInput,
  ): Promise<ListPaymentChargebacksOutput> {
    // Fetch all PaymentIntents with chargeback-like status
    const chargebackIntents = await this.paymentRepository.listByMerchantId(
      input.merchantId,
      "chargeback_",
    );

    const chargebacks: PaymentChargebackEntry[] = chargebackIntents.map((intent) => {
      const snap = intent.snapshot();
      return {
        paymentIntentId: snap.id,
        orderId: snap.commerceOrderId ?? snap.sessionId,
        amountCents: snap.amountCents,
        provider: this.detectProvider(snap),
        providerPaymentId: snap.providerPaymentId ?? null,
        disputeStatus: this.toDisputeStatus(snap.status),
        disputeOpenedAt: snap.updatedAt,
        disputeReason: null,
        customerEmail: null,
        createdAt: snap.createdAt,
      };
    });

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
