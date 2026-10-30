export const WALLET_CHECK_INTERVAL_MS = 15 * 60_000;
export const WALLET_MIN_REFRESH_MS = 30_000;

export type WalletErrorCode = "reconnect_required" | "permission_denied" | "provider_unavailable" | "invalid_response";

export class ShippingWalletError extends Error {
  constructor(readonly code: WalletErrorCode) { super(code); }
}

/** Provider balance is authoritative; reserved and debts are reported separately. */
export function parseShippingWallet(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ShippingWalletError("invalid_response");
  const data = value as Record<string, unknown>;
  return {
    balanceCents: moneyCents(data.balance),
    reservedCents: moneyCents(data.reserved ?? 0, true),
    debtsCents: moneyCents(data.debts ?? 0, true),
  };
}

function moneyCents(value: unknown, positive = false): number {
  if ((typeof value !== "number" && typeof value !== "string") || !/^-?\d+(?:\.\d{1,2})?$/.test(String(value))) {
    throw new ShippingWalletError("invalid_response");
  }
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > 2_147_483_647 || (positive && cents < 0)) {
    throw new ShippingWalletError("invalid_response");
  }
  return cents;
}

export function walletLocation(base: string) {
  if (base === "https://melhorenvio.com.br") return {
    environment: "live" as const, rechargeUrl: "https://app.melhorenvio.com.br/melhor-carteira",
  };
  if (base === "https://sandbox.melhorenvio.com.br") return {
    environment: "test" as const, rechargeUrl: "https://sandbox.melhorenvio.com.br/painel/melhor-carteira",
  };
  throw new ShippingWalletError("provider_unavailable");
}

export const formatWalletMoney = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function lowWalletContent(balanceCents: number, thresholdCents: number) {
  return {
    title: "Saldo baixo no Melhor Envio",
    body: `Seu saldo no Melhor Envio é de ${formatWalletMoney(balanceCents)}, abaixo do limite de ${formatWalletMoney(thresholdCents)}. Adicione créditos para evitar interrupções na compra de etiquetas.`,
  };
}
