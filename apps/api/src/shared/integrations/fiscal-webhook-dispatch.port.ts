export const FISCAL_WEBHOOK_DISPATCH = Symbol.for("zyon.fiscal.webhook.dispatch");
export class FiscalWebhookDispatchError extends Error { constructor(readonly status: 400 | 401 | 503, code: string) { super(code); } }
/** Trusted internal account binding, produced only AFTER the configured receiver verifies raw HMAC. */
export interface FiscalWebhookDispatchPort {
  receive(provider: string, connectionRef: string, body: unknown, rawBody: Uint8Array | undefined, headers: Readonly<Record<string, unknown>>): Promise<{ received: true; ignored?: boolean }>;
  fromBlingAccount(input: { merchantId: string; erpConnectionId: string; externalAccountId: string; eventId: string; body: unknown }): Promise<{ received: true; ignored?: boolean }>;
}
