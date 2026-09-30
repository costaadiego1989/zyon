export type MerchantStoreRole = "owner" | "admin" | "staff";

export type ManagedMerchantStore = {
  id: string;
  name: string;
  slug?: string;
  role: MerchantStoreRole;
  storeCategory?: string;
  isBillingAccount?: boolean;
};

export type CreateMerchantStoreProfile = {
  cnpj: string;
  email: string;
  phone: string;
  storeCategory: string;
};

export type MerchantStoreMembership = {
  merchantId: string;
  billingAccountMerchantId: string;
  role: MerchantStoreRole;
};

export type CreateMerchantStoreResult =
  | { status: "created"; store: ManagedMerchantStore }
  | { status: "capacity_reached" };

export interface MerchantStoreRepository {
  resolveBillingAccountMerchantId(merchantId: string): Promise<string | undefined>;
  findMembership(userId: string, merchantId: string): Promise<MerchantStoreMembership | undefined>;
  listStores(accountMerchantId: string, userId: string): Promise<ManagedMerchantStore[]>;
  createStore(input: {
    accountMerchantId: string;
    actorUserId: string;
    name: string;
    slugBase: string;
    profile: CreateMerchantStoreProfile;
  }): Promise<CreateMerchantStoreResult>;
}

export const MERCHANT_STORE_REPOSITORY = Symbol("MERCHANT_STORE_REPOSITORY");
