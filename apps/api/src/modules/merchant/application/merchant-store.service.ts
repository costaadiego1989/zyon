import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { BillingPlanMeteringService } from "../../payment/infrastructure/billing/billing-plan-guard.js";
import {
  MERCHANT_STORE_REPOSITORY,
  type ManagedMerchantStore,
  type MerchantStoreRepository,
  type MerchantStoreRole,
} from "../domain/ports/merchant-store.repository.port.js";
import { Inject } from "@nestjs/common";

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
    const accountMerchantId = await this.accountFor(actor.merchantId);
    return this.repository.listStores(accountMerchantId, actor.userId);
  }

  async create(input: { actor: MerchantStoreActor; name: string; slug: string }): Promise<ManagedMerchantStore> {
    if (input.actor.role !== "owner") {
      throw new ForbiddenException({ code: "multi_store_owner_required" });
    }
    const accountMerchantId = await this.accountFor(input.actor.merchantId);
    if (await this.billing.getEffectivePlan(accountMerchantId) !== "scale") {
      throw new ForbiddenException({ code: "multi_store_requires_scale", required_plan: "scale" });
    }

    const name = normalizeStoreName(input.name);
    const slug = normalizeStoreSlug(input.slug);
    const result = await this.repository.createStore({
      accountMerchantId,
      actorUserId: input.actor.userId,
      name,
      slug,
    });
    if (result.status === "created") return result.store;
    if (result.status === "capacity_reached") {
      throw new ForbiddenException({ code: "multi_store_limit_reached", limit: 5, required_plan: "scale" });
    }
    throw new ConflictException({ code: "merchant_store_slug_taken" });
  }

  async activate(actor: MerchantStoreActor, targetMerchantId: string): Promise<{ merchantId: string; role: MerchantStoreRole }> {
    const accountMerchantId = await this.accountFor(actor.merchantId);
    const target = await this.repository.findMembership(actor.userId, targetMerchantId.trim());
    if (!target || target.billingAccountMerchantId !== accountMerchantId) {
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

function normalizeStoreSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length < 3) throw new ConflictException({ code: "merchant_store_slug_invalid" });
  if (slug.length > 80) throw new ConflictException({ code: "merchant_store_slug_invalid" });
  return slug;
}
