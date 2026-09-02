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
  /** true = deal still open (lead not yet purchased); false/undefined = won (sale). */
  open?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CrmProviderPort {
  upsertContact(merchantId: string, contact: CrmContact): Promise<void>;
  createDeal(merchantId: string, deal: CrmDeal): Promise<void>;
  /**
   * Lightweight authenticated call to verify the credentials are valid before a
   * connection is persisted as "connected". Returns true if the CRM accepts the
   * token, false otherwise. Must not throw.
   */
  validateCredentials(): Promise<boolean>;
}
