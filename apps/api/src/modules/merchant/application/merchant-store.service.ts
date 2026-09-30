import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { BillingPlanMeteringService } from "../../payment/infrastructure/billing/billing-plan-guard.js";
import {
  MERCHANT_STORE_REPOSITORY,
  type CreateMerchantStoreProfile,
  type ManagedMerchantStore,
  type MerchantStoreRepository,
  type MerchantStoreRole,
} from "../domain/ports/merchant-store.repository.port.js";
import { isValidStoreCategory } from "../domain/services/store-category.js";

export type MerchantStoreActor = {
  userId: string;
  merchantId: string;
  role: MerchantStoreRole;
};

@Injectable()
export class MerchantStoreService {
  constructor(
    @Inject(MERCHANT_STORE_REPOSITORY) private readonly repository: MerchantStoreRepository,
    private readonly billing: BillingPlanMeteringService,
  ) {}

  async list(actor: MerchantStoreActor): Promise<ManagedMerchantStore[]> {
    return this.repository.listStores(await this.accountFor(actor.merchantId), actor.userId);
  }

  async create(input: {
    actor: MerchantStoreActor;
    name: string;
    cnpj: string;
    email: string;
    phone: string;
    storeCategory: string;
  }): Promise<ManagedMerchantStore> {
    if (input.actor.role !== "owner") {
      throw new ForbiddenException({ code: "multi_store_owner_required" });
    }
    const accountMerchantId = await this.accountFor(input.actor.merchantId);
    if (await this.billing.getEffectivePlan(accountMerchantId) !== "scale") {
      throw new ForbiddenException({ code: "multi_store_requires_scale", required_plan: "scale" });
    }

    const name = normalizeStoreName(input.name);
    const profile = normalizeStoreProfile(input);
    const result = await this.repository.createStore({
      accountMerchantId,
      actorUserId: input.actor.userId,
      name,
      slugBase: slugFromStoreName(name),
      profile,
    });
    if (result.status === "created") return result.store;
    if (result.status === "capacity_reached") {
      throw new ForbiddenException({ code: "multi_store_limit_reached", limit: 5, required_plan: "scale" });
    }
    throw new Error("merchant_store_create_unexpected_result");
  }

  async activate(actor: MerchantStoreActor, targetMerchantId: string): Promise<{ merchantId: string; role: MerchantStoreRole }> {
    const accountMerchantId = await this.accountFor(actor.merchantId);
    const requestedMerchantId = targetMerchantId.trim();
    const target = await this.repository.findMembership(actor.userId, requestedMerchantId);
    if (!target || target.merchantId !== requestedMerchantId || target.billingAccountMerchantId !== accountMerchantId) {
      throw new ForbiddenException({ code: "merchant_store_access_denied" });
    }
    return { merchantId: target.merchantId, role: target.role };
  }

  private async accountFor(merchantId: string): Promise<string> {
    const accountMerchantId = await this.repository.resolveBillingAccountMerchantId(merchantId.trim());
    if (!accountMerchantId) throw new NotFoundException({ code: "merchant_store_account_not_found" });
    return accountMerchantId;
  }
}

function normalizeStoreName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new ConflictException({ code: "merchant_store_name_too_short" });
  if (name.length > 80) throw new ConflictException({ code: "merchant_store_name_too_long" });
  return name;
}

function normalizeStoreProfile(input: { cnpj: string; email: string; phone: string; storeCategory: string }): CreateMerchantStoreProfile {
  const cnpj = input.cnpj.replace(/\D/g, "");
  if (!isValidCnpj(cnpj)) throw new BadRequestException({ code: "merchant_store_cnpj_invalid" });

  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException({ code: "merchant_store_email_invalid" });
  }

  const phone = input.phone.replace(/\D/g, "");
  if (phone.length < 10 || phone.length > 15) throw new BadRequestException({ code: "merchant_store_phone_invalid" });

  const storeCategory = input.storeCategory.trim();
  if (!isValidStoreCategory(storeCategory)) {
    throw new BadRequestException({ code: "merchant_store_category_invalid" });
  }
  return { cnpj, email, phone, storeCategory };
}

function slugFromStoreName(value: string): string {
  const slug = value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length < 3 || slug.length > 80) throw new ConflictException({ code: "merchant_store_slug_invalid" });
  return slug;
}

function isValidCnpj(value: string): boolean {
  if (!/^\d{14}$/.test(value) || /^(\d)\1{13}$/.test(value)) return false;
  const digit = (slice: string, weights: number[]) => {
    const sum = slice.split("").reduce((total, item, index) => total + Number(item) * weights[index]!, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return digit(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(value[12])
    && digit(value.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(value[13]);
}
