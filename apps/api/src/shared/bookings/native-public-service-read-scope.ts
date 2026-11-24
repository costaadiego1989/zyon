import { UnauthorizedException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { currentWhatsAppExecution, type WhatsAppExecution } from "../whatsapp/whatsapp-automation-context.js";

/** One verified Meta turn. No buyer, cart, checkout, HTTP origin or writer. */
export interface NativePublicServiceReadScope {
  readonly transport: "whatsapp";
  readonly merchantId: string;
  readonly expiresAtUnix: number;
  readonly allowedOrigin?: undefined;
}
interface NativeReadFrame {
  readonly scope: NativePublicServiceReadScope;
  readonly execution: Readonly<WhatsAppExecution>;
  /** Installed only by the durable turn verifier, never supplied by a DTO. */
  readonly revalidate: (tx: Prisma.TransactionClient) => Promise<Date>;
}
const storage = new AsyncLocalStorage<Readonly<NativeReadFrame>>();
const deny = () => new UnauthorizedException("whatsapp_service_read_authority_required");

export function withNativePublicServiceReadScope<T>(frame: NativeReadFrame, work: (scope: NativePublicServiceReadScope) => T): T {
  const execution = currentWhatsAppExecution(), scope = frame.scope;
  if (!execution || frame.execution !== execution || execution.authority.provider !== "META_CLOUD" || storage.getStore()
    || execution.authority.merchantId !== scope.merchantId || !scope.merchantId || scope.transport !== "whatsapp"
    || scope.allowedOrigin !== undefined || !Number.isSafeInteger(scope.expiresAtUnix) || scope.expiresAtUnix <= 0
    || typeof frame.revalidate !== "function" || Object.keys(scope).some(key => !["transport", "merchantId", "expiresAtUnix"].includes(key))) throw deny();
  const bound = Object.freeze({ transport: "whatsapp" as const, merchantId: scope.merchantId, expiresAtUnix: scope.expiresAtUnix });
  return storage.run(Object.freeze({ ...frame, scope: bound }), () => work(bound));
}

/** Exact private reference plus live execution; JSON clones confer no authority. */
export async function revalidateNativePublicServiceReadScope(tx: Prisma.TransactionClient, scope: NativePublicServiceReadScope): Promise<Date> {
  const frame = storage.getStore();
  if (!frame || frame.scope !== scope || frame.execution !== currentWhatsAppExecution()) throw deny();
  const now = await frame.revalidate(tx);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || now.getTime() >= scope.expiresAtUnix * 1000) throw deny();
  return now;
}
