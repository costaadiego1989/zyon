import { FISCAL_RECIPIENT_FIELDS, type FiscalRecipientField } from "../domain/fiscal-recipient.js";
import { FISCAL_PROVIDERS, type FiscalProvider } from "../domain/fiscal-provider.js";
import type { FiscalActor, FiscalTenant } from "../domain/fiscal-repository.port.js";
import type { FiscalProfileConfiguration, FiscalProfileDraft, FiscalProfileRecord, FiscalProfileStore,
  FiscalProfileSupportPort, FiscalProfileReadiness } from "../domain/fiscal-profile.port.js";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export class FiscalProfileService {
  constructor(private readonly store: FiscalProfileStore, private readonly support: FiscalProfileSupportPort, private readonly confirmed?: (profile: FiscalProfileRecord, actor: FiscalActor) => Promise<void>) {}
  async read(scope: FiscalTenant, provider: string, operation: string) {
    if (!scope.merchantId?.trim() || !["homologation", "production"].includes(scope.environment) || !FISCAL_PROVIDERS.includes(provider as FiscalProvider) || operation !== "sale") throw new Error("fiscal_profile_invalid");
    const profile = await this.store.latest(scope, provider as FiscalProvider, operation);
    const confirmed = profile?.confirmedAt && profile.confirmedBy ? profile : await this.store.latestConfirmed?.(scope, provider as FiscalProvider, operation) ?? null;
    const project = (value: FiscalProfileRecord | null) => value ? { id: value.id, merchantId: value.merchantId, environment: value.environment, provider: value.provider, operation: value.operation, issuerRegime: value.issuerRegime, version: value.version, itemRules: value.itemRules, recipientRequirements: value.recipientRequirements, sourceContractVersion: value.sourceContractVersion, confirmedAt: value.confirmedAt, confirmedBy: value.confirmedBy } : null;
    const contract = this.support.describe?.(provider as FiscalProvider);
    return { profile: project(profile), confirmedProfile: project(confirmed), supportedContract: contract ? { sourceContractVersion: contract.sourceContractVersion, operations: [...contract.operations], currencies: [...contract.currencies], issuerRegimes: [...contract.issuerRegimes], productTypes: [...contract.productTypes], minimumRecipientRequirements: [...(contract.minimumRecipientRequirements ?? [])] } : null };
  }
  draft(input: FiscalProfileDraft, actor: FiscalActor) {
    if (!actor.actorId?.trim()) throw new Error("fiscal_actor_required");
    if (!input.merchantId?.trim() || !["homologation", "production"].includes(input.environment)
      || !["focus", "bling", "omie", "tiny"].includes(input.provider) || !input.operation?.trim()
      || !input.issuerRegime?.trim() || !input.sourceContractVersion?.trim()) throw new Error("fiscal_profile_invalid");
    return this.store.createVersion(input, actor);
  }
  private validate(profile: FiscalProfileRecord): FiscalProfileReadiness {
    const config = profile.itemRules;
    const requirements = profile.recipientRequirements;
    if (!object(config) || !object(config.items) || !Object.keys(config.items).length
      || !Array.isArray(config.supportedProductTypes) || !config.supportedProductTypes.length
      || !Array.isArray(requirements) || !requirements.length
      || requirements.some(field => !FISCAL_RECIPIENT_FIELDS.includes(field as FiscalRecipientField))) {
      return { ready: false, state: "action_required", code: "fiscal_profile_unconfirmed" };
    }
    const supported = this.support.find(profile.provider, profile.sourceContractVersion);
    if (!supported || !supported.operations.includes(profile.operation) || !supported.issuerRegimes.includes(profile.issuerRegime)
      || !supported.currencies.includes(String(config.currency))
      || config.supportedProductTypes.some(type => !["physical", "food"].includes(type) || !supported.productTypes.includes(type))) {
      return { ready: false, state: "action_required", code: "fiscal_operation_unsupported" };
    }
    for (const rule of Object.values(config.items)) {
      if (!object(rule) || !config.supportedProductTypes.includes(rule.productType)
        || !/^[0-9]{8}$/.test(String(rule.ncm)) || !/^[0-9]{4}$/.test(String(rule.cfop))
        || !/^[0-8]$/.test(String(rule.origin)) || typeof rule.unit !== "string" || !rule.unit.trim() || rule.unit.length > 6
        || !object(rule.taxes) || !Object.keys(rule.taxes).length
        || Object.values(rule.taxes).some(value => typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value) || value < 0))) {
        return { ready: false, state: "action_required", code: "fiscal_profile_unconfirmed" };
      }
    }
    return { ready: true, configuration: structuredClone(config) as unknown as FiscalProfileConfiguration,
      requirements: [...new Set([...requirements, ...(supported.minimumRecipientRequirements ?? [])])] as FiscalRecipientField[] };
  }
  readiness(profile: FiscalProfileRecord | null): FiscalProfileReadiness {
    if (!profile?.confirmedAt || !profile.confirmedBy) return { ready: false, state: "action_required", code: "fiscal_profile_unconfirmed" };
    return this.validate(profile);
  }
  async confirm(scope: FiscalTenant, id: string, actor: FiscalActor) {
    if (!actor.actorId?.trim()) throw new Error("fiscal_actor_required");
    const profile = await this.store.find(scope, id);
    if (!profile) throw new Error("fiscal_profile_not_found");
    const readiness = this.validate(profile);
    if (!readiness.ready) throw new Error(readiness.code);
    const confirmed = await this.store.confirm(scope, id, actor);
    await this.confirmed?.(confirmed, actor);
    return confirmed;
  }
}
