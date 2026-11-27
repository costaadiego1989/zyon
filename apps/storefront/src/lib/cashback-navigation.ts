import type { CashbackWalletView } from "@zyon/shared-types";

export function storeCashbackEnabled(config: unknown, merchantId: string | undefined): boolean {
  if (!merchantId || !config || typeof config !== "object") return false;
  const snapshot = config as { merchantId?: unknown; cashbackEnabled?: unknown };
  return snapshot.merchantId === merchantId && snapshot.cashbackEnabled === true;
}

export function hasExistingCashback(wallet: CashbackWalletView | null, transactionCount = 0): boolean {
  return Boolean(wallet && (wallet.balance.availableCents > 0 || wallet.balance.pendingCents > 0
    || wallet.balance.reservedCents > 0 || transactionCount > 0));
}

export function cashbackWelcomeReplies(replies: string[], enabled: boolean): string[] {
  return enabled ? replies : replies.filter(label => !/cashback/i.test(label));
}

export function isCashbackBalanceLink(label: string): boolean {
  return /^(?:\/cashback|cashback|(?:meu |consultar |ver )?(?:saldo de )?cashback)$/i.test(label.trim());
}
