import { Horizon } from "@stellar/stellar-sdk";

const HORIZON_URL = "https://horizon.stellar.org";

export interface StellarPaymentEvent {
  id: string;
  from: string;
  amount: string;
  assetCode: string;
  assetIssuer: string | undefined;
  transactionHash: string;
  createdAt: string;
}

export type PaymentCallback = (payment: StellarPaymentEvent) => void | Promise<void>;

export function streamPaymentsForAccount(
  publicKey: string,
  onPayment: PaymentCallback,
  cursor = "now"
): () => void {
  const horizon = new Horizon.Server(HORIZON_URL);

  const closeStream = horizon
    .payments()
    .forAccount(publicKey)
    .cursor(cursor)
    .stream({
      onmessage: (record) => {
        const r = record as unknown as Record<string, unknown>;
        if (r["type"] !== "payment") return;
        void onPayment({
          id: r["id"] as string,
          from: r["from"] as string,
          amount: r["amount"] as string,
          assetCode: (r["asset_code"] as string | undefined) ?? "XLM",
          assetIssuer: r["asset_issuer"] as string | undefined,
          transactionHash: r["transaction_hash"] as string,
          createdAt: r["created_at"] as string,
        });
      },
    });

  return closeStream as () => void;
}
