export const FISCAL_DELIVERY_DISPATCH = Symbol("FiscalDeliveryDispatch");
export interface MetaDeliveryStatus { id?: string; status?: string; recipient_id?: string; recipient_phone?: string }
export interface FiscalDeliveryDispatchPort {
  fromMeta(phoneNumberId: string, statuses: MetaDeliveryStatus[]): Promise<void>;
  resend(hookRef: string, raw: Buffer | undefined, headers: Record<string, unknown>): Promise<void>;
  twilio(configId: string, signature: unknown, body: unknown, originalUrl: string): Promise<void>;
}
export class FiscalDeliveryCallbackError extends Error { constructor(readonly status: number, code: string) { super(code); } }
