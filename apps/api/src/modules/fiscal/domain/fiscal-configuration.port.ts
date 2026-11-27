import type { FiscalEnvironment, FiscalProvider, FiscalReadinessCheck } from "./fiscal-provider.js";
import type { FiscalActor, FiscalTenant } from "./fiscal-repository.port.js";

export const FISCAL_CONFIGURATION_STORE = Symbol("FISCAL_CONFIGURATION_STORE");
export interface FiscalConnectionRecord extends FiscalTenant {
  id: string; provider: FiscalProvider; issuerTaxId: string; credentialCipher: string | null; setupCipher?: string | null; erpConnectionId: string | null;
  readiness: unknown; isActive: boolean; activatedAt: Date | null; disconnectedAt: Date | null;
  stockOwner: string; emailOwner: string; whatsappOwner: string;
}
export interface FiscalConnectionCreate extends FiscalTenant {
  provider: FiscalProvider; issuerTaxId: string; credentialCipher: string | null; erpConnectionId?: string;
  stockOwner: string; emailOwner: string; whatsappOwner: string;
}
export interface FiscalConfigurationStore {
  create(input: FiscalConnectionCreate, actor: FiscalActor): Promise<FiscalConnectionRecord>;
  latest?(scope: FiscalTenant): Promise<FiscalConnectionRecord | null>;
  reconnect?(scope: FiscalTenant, id: string, credentialCipher: string | undefined, actor: FiscalActor): Promise<FiscalConnectionRecord>;
  find(scope: FiscalTenant, id: string): Promise<FiscalConnectionRecord | null>;
  active(scope: FiscalTenant): Promise<FiscalConnectionRecord | null>;
  recordReadiness(scope: FiscalTenant, id: string, checks: readonly FiscalReadinessCheck[]): Promise<FiscalConnectionRecord>;
  activate(scope: FiscalTenant, id: string, checks: readonly FiscalReadinessCheck[], actor: FiscalActor): Promise<FiscalConnectionRecord>;
  disconnect(scope: FiscalTenant, id: string, actor: FiscalActor): Promise<FiscalConnectionRecord>;
}
export interface FiscalCredentialCipherPort { encrypt(plaintext: string): string; decrypt(ciphertext: string): string }
export interface FiscalConnectionInspectorPort {
  inspect(connection: FiscalConnectionRecord, credential: string): Promise<readonly FiscalReadinessCheck[]>;
}
export interface FiscalConnectionInput {
  merchantId: string; environment: FiscalEnvironment; provider: FiscalProvider; issuerTaxId: string;
  credential?: { kind: "company_token" | "oauth" | "app_credentials"; secret: string }; erpConnectionId?: string;
  stockOwner: "zyon" | "provider"; emailOwner: "zyon" | "provider"; whatsappOwner: "zyon" | "provider";
}
