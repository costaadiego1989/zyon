import type { SupportSettings } from "@aacp/shared-types";

export const SUPPORT_SETTINGS_REPOSITORY = "SUPPORT_SETTINGS_REPOSITORY";

export interface SupportSettingsRepository {
  get(merchantId: string): Promise<SupportSettings | null>;
  save(settings: SupportSettings): Promise<SupportSettings>;
  delete(merchantId: string): Promise<void>;
}
