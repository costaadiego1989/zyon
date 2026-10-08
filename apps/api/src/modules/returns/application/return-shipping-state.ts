/** Authorization stays in the existing resolution record until a real label
 * exists. Old support decisions used LABEL_GENERATED without creating a label. */
export function awaitingReturnLabel(ret: { status: string; label?: unknown }) {
  return !ret.label && ["REQUESTED", "LABEL_GENERATED"].includes(ret.status);
}

export function returnShippingState(ret: { status: string; resolution?: unknown; label?: {
  carrier: string; trackingNumber: string; labelUrl?: string | null; expiresAt: Date;
} | null } | null) {
  if (!ret) return undefined;
  const resolution = (ret.resolution ?? {}) as Record<string, unknown>;
  const authorized = typeof resolution.returnAuthorizedAt === "string" || ret.status === "LABEL_GENERATED" || Boolean(ret.label);
  return { authorized, awaitingCode: authorized && awaitingReturnLabel(ret),
    carrier: ret.label?.carrier ?? null, postingCode: ret.label?.trackingNumber ?? null,
    labelUrl: ret.label?.labelUrl ?? null, expiresAt: ret.label?.expiresAt.toISOString() ?? null,
    declarations: Array.isArray(resolution.returnDeclarations) ? resolution.returnDeclarations as Array<{ originMerchantId: string; originName: string; url: string | null }> : [],
  };
}
