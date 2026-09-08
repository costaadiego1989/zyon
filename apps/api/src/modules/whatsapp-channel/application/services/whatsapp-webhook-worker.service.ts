import { Inject, Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import {
  WHATSAPP_WEBHOOK_INBOX, INBOX_LEASE_MS, type WhatsAppWebhookInbox,
} from "../../domain/ports/whatsapp-webhook-inbox.port.js";
import {
  WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository,
} from "../../domain/ports/whatsapp-config-repository.port.js";
import { HandleIncomingMessageUseCase, type IncomingMessageInput } from "../use-cases/handle-incoming-message.use-case.js";
import { HandleStatusUpdateUseCase, type StatusUpdateInput } from "../use-cases/handle-status-update.use-case.js";

const POLL_INTERVAL_MS = 1_000;
/** When a poll keeps failing, back off so a misconfigured DB doesn't flood logs. */
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;

@Injectable()
export class WhatsAppWebhookWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppWebhookWorker.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<void> | undefined;
  private stopping = false;
  /** Tracks consecutive poll failures so we can throttle the noise. */
  private consecutiveFailures = 0;
  private lastFailureMsg = "";
  /** Wall-clock ms of the last log we emitted, so back-off doesn't spam. */
  private lastFailureLogAt = 0;

  constructor(
    @Inject(WHATSAPP_WEBHOOK_INBOX) private readonly inbox: WhatsAppWebhookInbox,
    @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configRepo: WhatsAppConfigRepository,
    private readonly handleMessage: HandleIncomingMessageUseCase,
    private readonly handleStatus: HandleStatusUpdateUseCase,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.drain(); }, POLL_INTERVAL_MS);
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
    this.active = this.processBatch()
      .catch((err: unknown) => {
        this.recordFailure(err);
      })
      .finally(() => { this.active = undefined; });
    return this.active;
  }

  /** True while a batch is currently running. Test-only escape hatch so spec
   *  code can deterministically wait between cycles (drain() is internally
   *  de-duplicated, so two synchronous drain() calls share the same promise). */
  isDraining(): boolean {
    return this.active !== undefined;
  }

  private recordFailure(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    // Same error as last poll → suppress the duplicate log unless enough time
    // has elapsed (back-off). This prevents the per-second ERROR spam when the
    // underlying cause (e.g. missing migration, DB outage) doesn't change.
    const now = Date.now();
    const isRepeat = message === this.lastFailureMsg;
    this.consecutiveFailures += 1;
    const backoff = Math.min(BACKOFF_BASE_MS * 2 ** Math.min(this.consecutiveFailures - 1, 6), BACKOFF_MAX_MS);
    if (!isRepeat || now - this.lastFailureLogAt >= backoff) {
      this.logger.error(`whatsapp_inbox_poll_failed: ${message}`);
      this.lastFailureLogAt = now;
    }
    this.lastFailureMsg = message;
  }

  private clearFailure(): void {
    if (this.consecutiveFailures > 0) {
      this.logger.log(`whatsapp_inbox_poll_recovered after ${this.consecutiveFailures} failed attempt(s)`);
    }
    this.consecutiveFailures = 0;
    this.lastFailureMsg = "";
  }

  private async processBatch(): Promise<void> {
    for (let index = 0; index < 20 && !this.stopping; index++) {
      const claim = await this.inbox.claimNext();
      if (!claim) {
        // Successful poll with no work → reset the failure streak so the
        // back-off window collapses once the inbox is healthy again.
        this.clearFailure();
        return;
      }
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
        const config = await this.configRepo.findById(claim.configId);
        const provider = (claim.payload as IncomingMessageInput).provider ?? "BUBBLEWHATS";
        const bubbleWhatsConfigIsValid = provider !== "BUBBLEWHATS"
          || (config?.deviceId === claim.deviceId && !!config.webhookSecret?.trim());
        if (!config || config.id !== claim.configId || config.merchantId !== claim.merchantId || config.provider !== provider
          || !config.enabled || !bubbleWhatsConfigIsValid) {
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
    // Batch drained all 20 slots without throwing → inbox is healthy, reset
    // any prior failure streak so the next batch starts from a clean window.
    this.clearFailure();
  }
}
