import type { CheckoutSession } from "@/api/checkout-session";

export interface StripeConfirmRequest {
  paymentIntentId: string;
}

export interface CryptoConfirmRequest {
  paymentIntentId: string;
  sessionId: string;
  txHash: string;
  walletAddress: string;
}

export interface ApiResult {
  ok: boolean;
  status: number;
}

function authHeaders(api: CheckoutSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${api.authToken}`,
  };
}

export async function confirmStripePayment(
  api: CheckoutSession,
  req: StripeConfirmRequest
): Promise<ApiResult> {
  const result = await api.confirmStripePayment(req.paymentIntentId);
  return { ok: result.status === "approved", status: result.status === "approved" ? 200 : 409 };
}

export async function confirmCryptoPayment(
  api: CheckoutSession,
  req: CryptoConfirmRequest
): Promise<ApiResult> {
  const res = await fetch(
    `${api.apiBaseUrl}/embed/payment/intents/${req.paymentIntentId}/crypto/confirm`,
    {
      method: "POST",
      headers: authHeaders(api),
      body: JSON.stringify({
        session_id: req.sessionId,
        tx_hash: req.txHash,
        wallet_address: req.walletAddress,
      }),
    }
  );
  return { ok: res.ok, status: res.status };
}
