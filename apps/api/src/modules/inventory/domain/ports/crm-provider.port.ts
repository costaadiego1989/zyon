export const CRM_PROVIDER_PORT = Symbol("CRM_PROVIDER_PORT");

export interface CrmContact {
  email: string;
  name?: string;
  phone?: string;
  tags?: string[];
}

export interface CrmDeal {
  contactEmail: string;
  title: string;
  valueCents: number;
  stage?: string;
  metadata?: Record<string, unknown>;
}

export interface CrmProviderPort {
  upsertContact(merchantId: string, contact: CrmContact): Promise<void>;
  createDeal(merchantId: string, deal: CrmDeal): Promise<void>;
}
