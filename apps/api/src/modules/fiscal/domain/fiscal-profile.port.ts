import type { FiscalProvider } from "./fiscal-provider.js";
import type { FiscalActor, FiscalTenant } from "./fiscal-repository.port.js";
import type { FiscalRecipientField } from "./fiscal-recipient.js";

export interface FiscalItemRule {
  productType: "physical" | "food"; ncm: string; cfop: string; origin: string; unit: string;
  taxes: Record<string, string | number>;
}
export interface FiscalProfileConfiguration {
  currency: string; supportedProductTypes: ("physical" | "food")[]; items: Record<string, FiscalItemRule>;
}
export interface FiscalProfileDraft extends FiscalTenant {
  provider: FiscalProvider; operation: string; issuerRegime: string; itemRules: unknown;
  recipientRequirements: unknown; sourceContractVersion: string;
}
export interface FiscalProfileRecord extends FiscalProfileDraft {
  id: string; version: number; confirmedBy: string | null; confirmedAt: Date | null;
}
export interface FiscalProfileStore {
  createVersion(input: FiscalProfileDraft, actor: FiscalActor): Promise<FiscalProfileRecord>;
  find(scope: FiscalTenant, id: string): Promise<FiscalProfileRecord | null>;
  latest(scope: FiscalTenant, provider: FiscalProvider, operation: string): Promise<FiscalProfileRecord | null>;
  latestConfirmed?(scope: FiscalTenant, provider: FiscalProvider, operation: string): Promise<FiscalProfileRecord | null>;
  confirm(scope: FiscalTenant, id: string, actor: FiscalActor): Promise<FiscalProfileRecord>;
}
/** Only reviewed contract profiles are supplied by wiring. A merchant cannot declare provider support. */
export interface FiscalProfileSupportPort {
  describe?(provider: FiscalProvider): { sourceContractVersion: string; operations: readonly string[]; currencies: readonly string[]; issuerRegimes: readonly string[]; productTypes: readonly string[]; minimumRecipientRequirements?: readonly FiscalRecipientField[] } | null;
  find(provider: FiscalProvider, sourceContractVersion: string): {
    operations: readonly string[]; currencies: readonly string[]; issuerRegimes: readonly string[]; productTypes: readonly string[]; minimumRecipientRequirements?: readonly FiscalRecipientField[];
  } | null;
}
export type FiscalProfileReadiness = { ready: true; configuration: FiscalProfileConfiguration; requirements: FiscalRecipientField[] }
  | { ready: false; state: "action_required"; code: "fiscal_profile_unconfirmed" | "fiscal_operation_unsupported" };
