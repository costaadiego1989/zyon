import { Injectable } from "@nestjs/common";
import { CrmProviderPort } from "../../domain/ports/crm-provider.port.js";
import { NoopCrmAdapter } from "./noop-crm.adapter.js";
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
 * Returns NoopCrmAdapter if provider unknown or credentials missing.
 */
@Injectable()
export class CrmAdapterFactory {
  create(config: CrmProviderConfig): CrmProviderPort {
    if (!config.provider || !config.accessToken) {
      return new NoopCrmAdapter();
    }

    switch (config.provider.toLowerCase()) {
      case "hubspot":
        return new HubSpotCrmAdapter(config.accessToken);
      case "pipedrive":
        return new PipedriveCrmAdapter(config.accessToken);
      case "rdstation":
        return new RdStationCrmAdapter(config.accessToken);
      default:
        return new NoopCrmAdapter();
    }
  }
}
