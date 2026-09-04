import type { SupportSettings } from "@zyon/shared-types";
import type { SupportSettingsRepository } from "../domain/ports/support-settings-repository.port.js";

export class InMemorySupportSettingsRepository implements SupportSettingsRepository {
  private store = new Map<string, SupportSettings>();

  async get(merchantId: string): Promise<SupportSettings | null> {
    return this.store.get(merchantId) ?? null;
  }

  async save(settings: SupportSettings): Promise<SupportSettings> {
    this.store.set(settings.merchantId, { ...settings });
    return { ...settings };
  }

  async delete(merchantId: string): Promise<void> {
    this.store.delete(merchantId);
  }
}
