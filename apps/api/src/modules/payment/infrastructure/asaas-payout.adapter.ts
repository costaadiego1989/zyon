import {
  PayoutSubmissionError,
  type AsaasInternalPayoutInput,
  type AsaasInternalPayoutSubmission,
  type PaymentPayoutProviderPort,
} from "../domain/ports/payment-payout-provider.port.js";

type AsaasTransferResponse = {
  id?: string;
  status?: string;
  failReason?: string | null;
};

function nonEmpty(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function asaasFailureCode(status: number): string {
  return `asaas_transfer_create_failed_${status}`;
}

/**
 * Platform-account transfer adapter for delayed merchant payout. It only
 * supports linked Asaas wallets; PIX/TED destinations are intentionally out
 * of scope because they have a different risk and reconciliation lifecycle.
 */
export class AsaasPayoutAdapter implements PaymentPayoutProviderPort {
  private readonly normalizedBaseUrl: string;

  constructor(
    apiBaseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
  ) {
    this.normalizedBaseUrl = apiBaseUrl.replace(/\/+$/, "").replace(/\/v3$/, "");
  }

  async submitAsaasInternalPayout(input: AsaasInternalPayoutInput): Promise<AsaasInternalPayoutSubmission> {
    const payoutDestination = nonEmpty(input.payoutDestination, "asaas_payout_destination_required");
    const payoutReference = nonEmpty(input.payoutReference, "asaas_payout_reference_required");
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
      throw new Error("asaas_payout_amount_invalid");
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.normalizedBaseUrl}/v3/transfers/`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          access_token: this.apiKey,
        },
        body: JSON.stringify({
          value: Number((input.amountCents / 100).toFixed(2)),
          walletId: payoutDestination,
          externalReference: payoutReference,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // The provider may have accepted the request before a broken connection
      // or timeout. Keep the hold submitted for manual/reconciliation review.
      throw new PayoutSubmissionError("asaas_transfer_submission_unknown", false);
    }

    if (!response.ok) {
      throw new PayoutSubmissionError(asaasFailureCode(response.status), true);
    }

    let transfer: AsaasTransferResponse;
    try {
      transfer = await response.json() as AsaasTransferResponse;
    } catch {
      throw new PayoutSubmissionError("asaas_transfer_response_unknown", false);
    }
    const providerTransferId = typeof transfer.id === "string" ? transfer.id.trim() : "";
    if (!providerTransferId) throw new PayoutSubmissionError("asaas_transfer_missing_id", false);

    const providerStatus = typeof transfer.status === "string" ? transfer.status.trim().toUpperCase() : "";
    if (providerStatus === "FAILED" || providerStatus === "CANCELLED") {
      return {
        providerTransferId,
        state: "failed",
        failureCode: `asaas_transfer_${providerStatus.toLowerCase()}`,
      };
    }

    // Even a synchronous DONE response is not a release signal. Asaas asks
    // integrations to reconcile the transfer result through its webhooks.
    return { providerTransferId, state: "submitted" };
  }
}
