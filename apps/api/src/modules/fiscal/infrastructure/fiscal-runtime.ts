import type { PrismaClient } from "@prisma/client";
import { FiscalOlistOAuthService } from "./fiscal-olist-oauth.service.js";
import { FiscalOlistNotifications } from "./fiscal-olist-notifications.js";
import type {
  DomainEvent,
  DomainEventBus,
} from "../../../shared/events/domain-event-bus.port.js";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { PrismaFiscalStockCoordinator } from "../../../shared/persistence/fiscal-stock-coordination.js";
import type { PaymentProviderPort } from "../../payment/domain/ports/payment-provider.port.js";
import type { EmailSenderPort } from "../../notifications/domain/ports/email-sender.port.js";
import type { WhatsAppConfigRepository } from "../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import type { StrictWhatsAppSenderPort } from "../../whatsapp-channel/domain/ports/whatsapp-sender.port.js";
import type { WhatsAppTemplateRepositoryPort } from "../../whatsapp-templates/domain/ports/whatsapp-template-repository.port.js";
import type { WhatsAppTemplateSenderPort } from "../../whatsapp-templates/domain/ports/whatsapp-template-sender.port.js";
import { FiscalConnectionService } from "../application/fiscal-connection.service.js";
import { FiscalProfileService } from "../application/fiscal-profile.service.js";
import { FiscalPendingConfigurationService } from "../application/fiscal-pending-configuration.service.js";
import { FiscalSetupService } from "../application/fiscal-setup.service.js";
import { FiscalBeforePaymentService } from "../application/fiscal-before-payment.service.js";
import { FiscalRecipientPreparationService } from "../application/fiscal-recipient-preparation.service.js";
import { FiscalRecipientCollectionService } from "../application/fiscal-recipient-collection.service.js";
import { FiscalIssuanceService } from "../application/fiscal-issuance.service.js";
import { FiscalReconciliationService } from "../application/fiscal-reconciliation.service.js";
import { FiscalCancellationService } from "../application/fiscal-cancellation.service.js";
import { FiscalDocumentService } from "../application/fiscal-document.service.js";
import { FiscalDeliveryService } from "../application/fiscal-delivery.service.js";
import { FiscalMerchantInvoicesService } from "../application/fiscal-merchant-invoices.service.js";
import { FiscalCredentialCipher } from "./fiscal-credential-cipher.js";
import { FiscalRuntimeConfiguration } from "./fiscal-runtime-configuration.js";
import { PrismaFiscalConfigurationRepository } from "./prisma-fiscal-configuration.repository.js";
import { PrismaFiscalProfileRepository } from "./prisma-fiscal-profile.repository.js";
import { PrismaFiscalRecipientRepository } from "./prisma-fiscal-recipient.repository.js";
import { PrismaFiscalRecipientCollectionRepository } from "./prisma-fiscal-recipient-collection.repository.js";
import { PrismaFiscalCheckoutReader } from "./prisma-fiscal-checkout.reader.js";
import { PrismaFiscalIssuanceStore } from "./prisma-fiscal-issuance.store.js";
import { PrismaFiscalRepository } from "./prisma-fiscal.repository.js";
import { PrismaFiscalDocumentAccess } from "./prisma-fiscal-document.access.js";
import { FiscalPaymentEvidenceReader } from "./fiscal-payment-evidence.reader.js";
import { FiscalProviderFactory } from "./fiscal-provider.factory.js";
import { FiscalStockEvidenceReader } from "./fiscal-stock-evidence.reader.js";
import { FiscalArtifactStore } from "./fiscal-artifact.store.js";
import { FiscalWorker } from "./fiscal.worker.js";
import { ViaCepFiscalAddressLookup } from "./viacep-fiscal-address.lookup.js";
import { fiscalProfileSupport } from "./fiscal-profile-support.js";
import { FiscalWebhookDispatcher } from "./fiscal-webhook.dispatcher.js";
import { FiscalDeliveryDispatcher } from "./fiscal-delivery.dispatcher.js";
import { FiscalBuyerPortal } from "./fiscal-buyer-portal.js";
import { FiscalEmailSender } from "./fiscal-email.sender.js";
import { FiscalWhatsAppSender } from "./fiscal-whatsapp.sender.js";
import { FiscalWhatsAppPolicy } from "./fiscal-whatsapp.policy.js";
import { FiscalDeliveryAccounts } from "./fiscal-delivery-accounts.js";
import { OnOrderFiscalReviewHandler } from "./on-order-fiscal-review.handler.js";
import type { FiscalObservationPort } from "../domain/fiscal-observation.port.js";

/** Composition only. Construction and registration perform no remote operation or business write. */
export class FiscalRuntime {
  readonly environment =
    process.env.NODE_ENV === "production"
      ? ("production" as const)
      : ("homologation" as const);
  readonly cipher = new FiscalCredentialCipher();
  readonly olistOAuth: FiscalOlistOAuthService;
  readonly olistNotifications: FiscalOlistNotifications;
  readonly profiles: FiscalProfileService;
  readonly pending: FiscalPendingConfigurationService;
  readonly setup: FiscalSetupService;
  readonly configuration: FiscalRuntimeConfiguration;
  readonly connections: FiscalConnectionService;
  readonly recipientStore: PrismaFiscalRecipientRepository;
  readonly postal = new ViaCepFiscalAddressLookup();
  readonly preparation: FiscalRecipientPreparationService;
  readonly beforePayment: FiscalBeforePaymentService;
  readonly collection: FiscalRecipientCollectionService;
  readonly store: PrismaFiscalIssuanceStore;
  readonly issuance: FiscalIssuanceService;
  readonly reconciliation: FiscalReconciliationService;
  readonly cancellation: FiscalCancellationService;
  readonly documents: FiscalDocumentService;
  readonly deliveries: FiscalDeliveryService;
  readonly invoices: FiscalMerchantInvoicesService;
  readonly webhook: FiscalWebhookDispatcher;
  readonly deliveryCallbacks: FiscalDeliveryDispatcher;
  readonly worker: FiscalWorker;
  private active?: Promise<void>;
  private stopping = false;
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tenants: TenantContextService,
    private readonly bus: DomainEventBus,
    payment: PaymentProviderPort,
    email: EmailSenderPort,
    configs: WhatsAppConfigRepository,
    meta: StrictWhatsAppSenderPort,
    twilio: StrictWhatsAppSenderPort,
    templates: WhatsAppTemplateRepositoryPort,
    templateSender: WhatsAppTemplateSenderPort,
    observations: FiscalObservationPort
  ) {
    this.olistOAuth = new FiscalOlistOAuthService(prisma, this.cipher);
    this.olistNotifications = new FiscalOlistNotifications(prisma, this.cipher);
    this.profiles = new FiscalProfileService(
      new PrismaFiscalProfileRepository(prisma),
      fiscalProfileSupport,
      (profile, actor) => this.pending.confirmed(profile, actor)
    );
    this.pending = new FiscalPendingConfigurationService(
      prisma,
      this.profiles,
      tenants
    );
    this.setup = new FiscalSetupService(
      prisma,
      this.cipher,
      tenants,
      (scope, id, actor) => this.pending.configuredConnection(scope, id, actor)
    );
    this.configuration = new FiscalRuntimeConfiguration(
      prisma,
      this.cipher,
      this.setup
    );
    this.connections = new FiscalConnectionService(
      new PrismaFiscalConfigurationRepository(prisma),
      this.cipher,
      this.configuration,
      (scope, id, actor) => this.pending.configuredConnection(scope, id, actor)
    );
    this.recipientStore = new PrismaFiscalRecipientRepository(prisma);
    this.preparation = new FiscalRecipientPreparationService(
      this.recipientStore,
      this.postal
    );
    this.beforePayment = new FiscalBeforePaymentService(
      new PrismaFiscalCheckoutReader(prisma, this.environment, tenants),
      this.profiles,
      this.preparation
    );
    this.collection = new FiscalRecipientCollectionService(
      new PrismaFiscalRecipientCollectionRepository(prisma),
      this.beforePayment,
      this.postal
    );
    this.store = new PrismaFiscalIssuanceStore(
      prisma,
      () => new Date(),
      this.profiles,
      observations
    );
    const providers = new FiscalProviderFactory({
      credential: (scope) => this.configuration.credentials.credential(scope),
      authorization: {
        read: (scope) => this.configuration.credentials.authorization(scope),
      },
      accountEvidence: this.configuration.accountEvidence,
      policyVersion: (context) =>
        (context.profile.itemRules as { policyVersion?: string })
          ?.policyVersion ?? "",
    });
    const stock = new PrismaFiscalStockCoordinator(prisma, observations);
    const effects = new FiscalStockEvidenceReader({
      credential: (scope) => this.configuration.credentials.credential(scope),
      olistOrigin: (scope) => this.configuration.stockOrigin(scope),
    });
    this.issuance = new FiscalIssuanceService(
      this.store,
      providers,
      new FiscalPaymentEvidenceReader(prisma, payment, this.setup, tenants)
    );
    this.reconciliation = new FiscalReconciliationService(
      this.store,
      providers,
      effects,
      stock
    );
    this.cancellation = new FiscalCancellationService(
      prisma,
      this.store,
      providers
    );
    const artifacts = new FiscalArtifactStore(prisma);
    this.documents = new FiscalDocumentService(
      new PrismaFiscalDocumentAccess(prisma, tenants),
      artifacts,
      this.store,
      providers
    );
    const portal = new FiscalBuyerPortal(
      prisma,
      process.env.STOREFRONT_URL || "https://app.zyon.com.br"
    );
    const accounts = new FiscalDeliveryAccounts(
      prisma,
      this.cipher,
      process.env,
      fetch,
      email
    );
    this.deliveries = new FiscalDeliveryService(prisma, this.store, {
      email: new FiscalEmailSender(email, accounts, artifacts, portal),
      whatsapp: new FiscalWhatsAppSender(
        configs,
        new FiscalWhatsAppPolicy(prisma),
        meta,
        twilio,
        templates,
        templateSender,
        portal,
        process.env.API_PUBLIC_URL || "https://api.zyon.com.br",
        this.cipher
      ),
    }, observations);
    this.deliveryCallbacks = new FiscalDeliveryDispatcher(
      this.deliveries,
      accounts,
      process.env.API_PUBLIC_URL || "https://api.zyon.com.br"
    );
    this.invoices = new FiscalMerchantInvoicesService(
      prisma,
      new PrismaFiscalRepository(prisma),
      this.issuance,
      this.reconciliation,
      this.cancellation,
      this.documents,
      this.pending
    );
    this.webhook = new FiscalWebhookDispatcher(
      prisma,
      {
        read: async (connection) => {
          const setup = await this.setup.read(connection, connection.id);
          return setup?.focusWebhook
            ? {
                provider: "focus",
                headerName: setup.focusWebhook.authorizationHeader,
                secret: setup.focusWebhook.authorization,
              }
            : null;
        },
      },
      this.reconciliation
    );
    this.worker = new FiscalWorker(
      prisma,
      this.issuance,
      {
        run: async (claim) => {
          await this.reconciliation.run(claim);
          await this.recover(claim.merchantId, claim.environment, claim.id);
        },
      },
      stock
    );
  }
  private scoped<T>(merchantId: string, work: () => T): T {
    return this.tenants.run(
      { merchantId, userId: "fiscal-runtime", role: "system" },
      work
    );
  }
  private async recover(
    merchantId: string,
    environment: "production" | "homologation",
    id: string
  ) {
    const scope = { merchantId, environment };
    const result = await this.documents.recover(scope, id);
    const channels = await this.deliveries.dispatchAll(scope, id);
    if (!result.complete || channels.some((c) => c.status === "rejected"))
      throw new Error("fiscal_recovery_pending");
  }
  onModuleInit() {
    new OnOrderFiscalReviewHandler(
      this.prisma,
      this.bus,
      this.cancellation
    ).onModuleInit();
    const register = (
      type: string,
      work: (event: DomainEvent) => Promise<void>
    ) =>
      this.bus.subscribe(
        type,
        (e) => this.scoped(e.merchantId, () => work(e)),
        type + ".runtime.v1"
      );
    register("fiscal.reconciliation.requested", (e) =>
      this.webhook.consume(e.merchantId, e.payload)
    );
    register("fiscal.olist.notification.received", (e) =>
      this.olistNotifications.consume(e.merchantId, e.payload)
    );
    register("fiscal.stock.release_requested", (e) =>
      this.worker.handleStockRelease(e.merchantId, e.payload)
    );
    register("fiscal.document.authorized", async (e) => {
      const value = e.payload as {
        intentId?: string;
        environment?: "production" | "homologation";
      };
      if (
        !value.intentId ||
        !["production", "homologation"].includes(value.environment ?? "")
      )
        throw new Error("fiscal_recovery_request_invalid");
      await this.recover(e.merchantId, value.environment!, value.intentId);
    });
    for (const type of ["fiscal.intent.queued", "fiscal.issuance.requested"])
      register(type, async (e) => {
        const p = e.payload as { environment?: "production" | "homologation" };
        if (!["production", "homologation"].includes(p.environment ?? ""))
          throw new Error("fiscal_issuance_request_invalid");
        await this.worker.runOnce({
          merchantId: e.merchantId,
          environment: p.environment!,
        });
      });
  }
  /** Called by the existing outbox scheduler, never by import/constructor/bootstrap. */
  onModuleDestroy() {
    this.stopping = true;
  }
  tick(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.active) return this.active;
    this.active = (async () => {
      const due = await this.prisma.fiscalIntent.findMany({
        where: {
          state: {
            in: [
              "queued",
              "processing",
              "reconciliation_required",
              "authorized",
              "cancelled",
            ],
          },
          nextAttemptAt: { lte: new Date() },
          OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
        },
        select: { merchantId: true, environment: true },
        distinct: ["merchantId", "environment"],
        take: 20,
      });
      for (const scope of due) {
        if (this.stopping) break;
        await this.scoped(scope.merchantId, () => this.worker.runOnce(scope));
      }
    })().finally(() => {
      this.active = undefined;
    });
    return this.active;
  }
}
