import { Inject, Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import {
  WHATSAPP_WEBHOOK_INBOX, INBOX_LEASE_MS, type WhatsAppWebhookInbox,
} from "../../domain/ports/whatsapp-webhook-inbox.port.js";
import {
  WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository,
} from "../../domain/ports/whatsapp-config-repository.port.js";
import { HandleIncomingMessageUseCase, type IncomingMessageInput } from "../use-cases/handle-incoming-message.use-case.js";
import { HandleStatusUpdateUseCase, type StatusUpdateInput } from "../use-cases/handle-status-update.use-case.js";

@Injectable()
export class WhatsAppWebhookWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppWebhookWorker.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<void> | undefined;
  private stopping = false;

  constructor(
    @Inject(WHATSAPP_WEBHOOK_INBOX) private readonly inbox: WhatsAppWebhookInbox,
    @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configRepo: WhatsAppConfigRepository,
    private readonly handleMessage: HandleIncomingMessageUseCase,
    private readonly handleStatus: HandleStatusUpdateUseCase,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.drain(); }, 1_000);
    this.timer.unref();
    void this.drain();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    clearInterval(this.timer);
    await this.active;
  }

  /** Exposed for deterministic worker integration tests and manual maintenance runners. */
  drain(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.active) return this.active;
    this.active = this.processBatch().catch(() => {
      this.logger.error("whatsapp_inbox_poll_failed");
    }).finally(() => { this.active = undefined; });
    return this.active;
  }

  private async processBatch(): Promise<void> {
    for (let index = 0; index < 20 && !this.stopping; index++) {
      const claim = await this.inbox.claimNext();
      if (!claim) return;
      let leaseLost = false;
      let renewing: Promise<void> | undefined;
      const heartbeat = setInterval(() => {
        if (renewing || leaseLost) return;
        renewing = this.inbox.renew(claim).then((renewed) => { leaseLost = !renewed; })
          .catch(() => { leaseLost = true; }).finally(() => { renewing = undefined; });
      }, INBOX_LEASE_MS / 4);
      heartbeat.unref();
      let errorCode = "whatsapp_inbox_processing_failed";
      try {
        const config = await this.configRepo.findByDeviceId(claim.deviceId);
        if (!config || config.id !== claim.configId || config.merchantId !== claim.merchantId
          || config.deviceId !== claim.deviceId || config.provider !== "BUBBLEWHATS"
          || !config.enabled || !config.webhookSecret?.trim()) {
          errorCode = "whatsapp_channel_changed_or_disabled";
          throw new Error(errorCode);
        }
        if (leaseLost) throw new Error("whatsapp_inbox_lease_lost");
        if (claim.kind === "message") {
          const payload = claim.payload as IncomingMessageInput & { ignored?: boolean };
          if (!payload.ignored) await this.handleMessage.execute(payload);
        } else {
          await this.handleStatus.execute(claim.payload as StatusUpdateInput);
        }
        if (leaseLost || !await this.inbox.complete(claim)) {
          this.logger.warn(`whatsapp_inbox_completion_lease_lost id=${claim.id}`);
        }
      } catch {
        if (!leaseLost) await this.inbox.fail(claim, errorCode);
        this.logger.warn(`whatsapp_inbox_attempt_failed id=${claim.id} attempt=${claim.attempts} code=${errorCode}`);
      } finally {
        clearInterval(heartbeat);
        await renewing;
      }
    }
  }
}
