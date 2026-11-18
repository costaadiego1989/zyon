import type { FiscalActor, FiscalTenant } from "./fiscal-repository.port.js";
export const FISCAL_OLIST_NOTIFICATIONS = Symbol("FISCAL_OLIST_NOTIFICATIONS");
export interface FiscalOlistNotificationsPort {
  read(scope: FiscalTenant, connectionId: string): Promise<{ configured: boolean; notificationUrl: string | null }>;
  configure(scope: FiscalTenant, connectionId: string, actor: FiscalActor, rotate: boolean): Promise<{ configured: boolean; notificationUrl: string | null }>;
  receive(connectionId: string, key: unknown, rawBody: Uint8Array | undefined): Promise<{ received: true }>;
}
