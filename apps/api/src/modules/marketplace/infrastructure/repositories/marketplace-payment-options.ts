import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Cart } from "@zyon/shared-types";

/** Explicit cross-merchant reads through relations preserve tenant middleware. */
export async function marketplacePaymentOptions(db: Prisma.TransactionClient, hostId: string, sellerIds: string[]) {
  const ids = [...new Set([hostId, ...sellerIds])].sort();
  const merchants = await db.merchant.findMany({ where: { id: { in: ids } }, select: { id: true,
    paymentConnections: { select: { provider: true, environment: true, status: true, chargesEnabled: true,
      payoutsEnabled: true, externalAccountId: true, walletId: true } } } });
  if (merchants.length !== ids.length) throw new ConflictException("marketplace_payment_merchant_missing");
  if (merchants.some(merchant => merchant.paymentConnections.filter(connection => connection.status === "active").length > 2)) {
    throw new ConflictException("marketplace_payment_connection_limit");
  }
  const options: NonNullable<Cart["marketplacePaymentOptions"]> = [];
  // Mercado Pago is intentionally absent until its commercial 1:N contract
  // has a capture/transfer/refund adapter. Connecting MP alone is not proof.
  for (const provider of ["stripe", "asaas"] as const) {
    const connected = merchants.map(merchant => ({ merchantId: merchant.id,
      connection: merchant.paymentConnections.find(connection => connection.provider === provider &&
        connection.status === "active" && connection.chargesEnabled && connection.payoutsEnabled) }));
    if (connected.some(row => !row.connection)) continue;
    const environments = new Set(connected.map(row => row.connection!.environment));
    const environment = connected[0]!.connection!.environment;
    if (environments.size !== 1 || (environment !== "test" && environment !== "live")) continue;
    const destinations = connected.map(row => ({ merchantId: row.merchantId,
      destination: (provider === "stripe" ? row.connection!.externalAccountId : row.connection!.walletId)?.trim() ?? "" }));
    if (destinations.some(row => !row.destination || (provider === "stripe" && !row.destination.startsWith("acct_")))) continue;
    // Shared destinations would merge distinct merchants' receivables.
    if (new Set(destinations.map(row => row.destination)).size !== destinations.length) continue;
    options.push({ provider, environment, destinations });
  }
  if (!options.length) throw new ConflictException("marketplace_common_payment_provider_unavailable");
  return options;
}
