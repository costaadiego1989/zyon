import type { FiscalActor, FiscalTenant } from "./fiscal-repository.port.js";

export const FISCAL_OLIST_OAUTH = Symbol("FISCAL_OLIST_OAUTH");
type Owners = Record<"stockOwner" | "emailOwner" | "whatsappOwner", "zyon" | "provider">;
export interface OlistAuthorizationInput extends Owners { issuerTaxId: string; clientId: string; clientSecret: string; connectionId?: string }
export interface FiscalOlistOAuthPort {
  callback(state: unknown, code: unknown, error: unknown): Promise<string>;
  configuration(scope: FiscalTenant): { redirectUri: string };
  start(scope: FiscalTenant, actor: FiscalActor, input: OlistAuthorizationInput): Promise<{ url: string; state: string; redirectUri: string; expiresInSeconds: number }>;
  complete(scope: FiscalTenant, actor: FiscalActor, state: string, code: string): Promise<{ connectionId: string; provider: "tiny"; environment: string; isActive: boolean }>;
}
