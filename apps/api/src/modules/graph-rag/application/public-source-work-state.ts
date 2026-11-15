const prefix = "public-v1:";

export function publicWorkSequence(value: string): number {
  if (typeof value !== "string" || !/^public-v1:\d{20}$/.test(value)) throw new Error("public_work_version_invalid");
  const sequence = BigInt(value.slice(prefix.length));
  if (sequence < 1n || sequence > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("public_work_version_invalid");
  return Number(sequence);
}

export function nextPublicWorkVersion(previous: string | null): string {
  const sequence = previous === null ? 0 : publicWorkSequence(previous);
  if (sequence === Number.MAX_SAFE_INTEGER) throw new Error("public_work_version_exhausted");
  return prefix + String(sequence + 1).padStart(20, "0");
}

export interface PublicWorkContent {
  merchantId: string;
  sourceType: string;
  sourceId: string;
  sourceHash: string;
  publicationState: "draft" | "published" | "withdrawn";
}

export function samePublicWorkContent(current: PublicWorkContent, next: PublicWorkContent): boolean {
  if (current.merchantId !== next.merchantId || current.sourceType !== next.sourceType || current.sourceId !== next.sourceId)
    throw new Error("public_work_scope_mismatch");
  return current.sourceHash === next.sourceHash && current.publicationState === next.publicationState;
}

export function publicWorkRetryAt(serverNow: Date, attempts: number): Date {
  if (!Number.isFinite(serverNow.getTime()) || !Number.isSafeInteger(attempts) || attempts < 1)
    throw new Error("public_work_retry_invalid");
  return new Date(serverNow.getTime() + Math.min(300_000, 1000 * 2 ** Math.min(attempts - 1, 9)));
}

export interface PublicWorkLeaseState {
  merchantId: string;
  id: string;
  status: string;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
}
export function ownsPublicWorkLease(row: PublicWorkLeaseState,
  claim: { merchantId: string; id: string; leaseToken: string }, serverNow: Date): boolean {
  return row.merchantId === claim.merchantId && row.id === claim.id && row.status === "processing"
    && Boolean(claim.leaseToken) && row.leaseToken === claim.leaseToken
    && row.leaseExpiresAt !== null && row.leaseExpiresAt.getTime() > serverNow.getTime();
}
