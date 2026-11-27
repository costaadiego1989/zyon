import { Injectable } from "@nestjs/common";
import { BuyerRelationshipReader } from "../../buyer-account/relationship.public-api.js";
import { BillingPlanMeteringService } from "../../payment/relationship.public-api.js";
import { CampaignConsentReader } from "../../campaign-consent/public-api.js";
import type { MarketingContext } from "../domain/marketing-context.port.js";
@Injectable()
export class MarketingContextAdapter implements MarketingContext {
  constructor(
    private readonly billing: BillingPlanMeteringService,
    private readonly buyers: BuyerRelationshipReader,
    private readonly consents: CampaignConsentReader
  ) {}
  plan(id: string) {
    return this.billing.getEffectivePlan(id);
  }
  buyer(id: string) {
    return this.buyers.account(id);
  }
  verifiedAccount(phone: string) {
    return this.buyers.verifiedAccount(phone);
  }
  async blockedAccounts(
    items: Array<{ accountId: string; consentAt: string }>,
    merchantId: string
  ) {
    const [global, store] = await Promise.all([
      this.buyers.blockedAccounts(items),
      this.consents.blockedAccounts(merchantId, items),
    ]);
    return new Set([...global, ...store]);
  }
  async blockedByPreference(
    accountId: string,
    consentAt: string,
    merchantId: string
  ) {
    return (
      await this.blockedAccounts([{ accountId, consentAt }], merchantId)
    ).has(accountId);
  }
}
