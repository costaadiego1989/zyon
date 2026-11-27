import { Inject, Injectable, OnModuleInit, Optional } from "@nestjs/common";
import { StorefrontRelationshipReader } from "../../storefront/relationship.public-api.js";
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
  type DomainEvent,
} from "../../../shared/events/domain-event-bus.port.js";
import { CheckoutRelationshipReader } from "../../checkout/relationship.public-api.js";
import { PaymentRelationshipReader } from "../../payment/relationship.public-api.js";
import {
  MARKETING_REPOSITORY,
  type MarketingRepository,
} from "../domain/marketing.repository.js";
import {
  MARKETING_CLASSIFIER,
  type MarketingClassifier,
} from "../domain/marketing-classifier.port.js";
import { MarketingContactsService } from "../application/marketing-contacts.service.js";
import { MarketingObservability } from "./marketing-observability.js";

@Injectable()
export class MarketingEventsHandler implements OnModuleInit {
  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly bus: DomainEventBus,
    @Inject(MARKETING_REPOSITORY)
    private readonly repository: MarketingRepository,
    private readonly contacts: MarketingContactsService,
    @Inject(CheckoutRelationshipReader)
    private readonly checkout: Pick<
      CheckoutRelationshipReader,
      "session" | "order"
    >,
    @Inject(PaymentRelationshipReader)
    private readonly payments: Pick<PaymentRelationshipReader, "pending">,
    @Inject(MARKETING_CLASSIFIER)
    private readonly classifier: MarketingClassifier,
    private readonly observability: MarketingObservability,
    @Optional() private readonly storefront?: StorefrontRelationshipReader,
  ) {}
  onModuleInit() {
    for (const event of [
      "order.completed",
      "customer.registered",
      "funnel.step_completed",
    ]) {
      this.bus.subscribe(event, (e) => this.handle(e), `marketing.${event}`);
    }
  }
  async handle(event: DomainEvent) {
    const payload =
      event.payload && typeof event.payload === "object"
        ? (event.payload as Record<string, unknown>)
        : {};
    if (typeof payload.session_id === "string")
      await this.projectSession(event.merchantId, payload.session_id);
  }
  async projectSession(merchantId: string, key: string) {
    if (!(await this.contacts.enabled(merchantId))) return;
    return this.observability.run("projection", async () => {
      const facts = await this.checkout.session(merchantId, key);
      if (!facts) {
        if (!await this.storefront?.shopping(merchantId,key)) return;
        const contact=await this.repository.transaction(merchantId,"cart-projection",async tx=>{
          const conversation=(await tx.conversationByExternal("site",key)) ?? (await tx.conversationByExternal("whatsapp",key));
          return conversation?.contactId ? tx.contact(conversation.contactId) : null;
        });
        if (contact && ["new","interested"].includes(contact.stage)) await this.contacts.move(merchantId,contact.id,"shopping",
          "verified_storefront_cart",key,contact.version,"business");
        return;
      }
      let contact = await this.repository.transaction(
        merchantId,
        "projection",
        async (tx) =>
          (await tx.contactByAccount(facts.globalUserId)) ??
          (facts.verifiedPhone
            ? await tx.contactByPhone(facts.verifiedPhone.replace(/\D/g, ""))
            : null)
      );
      if (!contact) return;
      const order = await this.checkout.order(merchantId, facts.sessionId);
      if (order) {
        await this.contacts.recordPurchase(
          merchantId,
          contact.id,
          order.id,
          order.amountCents,
          order.occurredAt
        );
        return;
      }
      const pending = await this.payments.pending(merchantId, facts.sessionId);
      const next = pending
        ? "payment_pending"
        : facts.shopping && !["payment_pending", "lost"].includes(contact.stage)
        ? "shopping"
        : null;
      if (next && next !== contact.stage)
        await this.contacts.move(
          merchantId,
          contact.id,
          next,
          "verified_checkout_state",
          facts.sessionId,
          contact.version,
          "business"
        );
    });
  }
  async classify(
    merchantId: string,
    conversationId: string,
    contactId: string,
    text: string,
    messageId: string
  ) {
    const contact = await this.repository.transaction(
      merchantId,
      "classification-read",
      (tx) => tx.contact(contactId)
    );
    if (!contact || contact.stage !== "new") return;
    await this.observability.run("classification", async () => {
      const result = await this.classifier.classify({
        merchantId,
        conversationId,
        messageId,
        text,
      });
      if (!result) return;
      await this.contacts.move(
        merchantId,
        contactId,
        "interested",
        result.evidence,
        messageId,
        contact.version,
        "ai"
      );
      if (result.interests.length)
        await this.repository.transaction(
          merchantId,
          `contact:${contactId}`,
          async (tx) => {
            const current = await tx.contact(contactId);
            if (current)
              await tx.saveContact({
                ...current,
                interests: [
                  ...new Set([...current.interests, ...result.interests]),
                ].slice(0, 20),
              });
          }
        );
    });
  }
}
