import { Injectable } from "@nestjs/common";
import { CrmProviderPort } from "../../domain/ports/crm-provider.port.js";
import { HubSpotCrmAdapter } from "./hubspot-crm.adapter.js";
import { PipedriveCrmAdapter } from "./pipedrive-crm.adapter.js";
import { RdStationCrmAdapter } from "./rdstation-crm.adapter.js";

export interface CrmProviderConfig {
  provider: string;
  accessToken?: string;
  refreshToken?: string;
}

/**
 * Factory that creates the appropriate CRM adapter based on provider and credentials.
 * Fails explicitly if the provider or credentials are unavailable.
 */
@Injectable()
export class CrmAdapterFactory {
  create(config: CrmProviderConfig): CrmProviderPort {
    if (!config.provider || !config.accessToken) {
      throw new Error("inventory_crm_adapter_unavailable");
    }

    switch (config.provider.toLowerCase()) {
      case "hubspot":
        return new HubSpotCrmAdapter(config.accessToken);
      case "pipedrive":
        return new PipedriveCrmAdapter(config.accessToken);
      case "rdstation":
        return new RdStationCrmAdapter(config.accessToken);
      default:
        throw new Error("inventory_crm_adapter_unavailable");
    }
  }
}
