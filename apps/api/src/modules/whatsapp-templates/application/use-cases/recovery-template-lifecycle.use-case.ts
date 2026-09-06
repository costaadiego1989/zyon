import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { RECOVERY_TEMPLATE_LIFECYCLE_REPOSITORY, type RecoveryLifecycleRepository, type RecoveryTemplateInitializer } from "../../domain/ports/recovery-template-lifecycle.port.js";
import { TEMPLATE_SUBMISSION_PORT, type TemplateSubmissionPort } from "../../domain/ports/template-submission.port.js";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import { connectedTwilioCredentials, isApprovedRecoveryTemplate } from "../../domain/services/recovery-whatsapp-policy.js";
import { RECOVERY_TEMPLATE_DEFAULTS, prepareRecoveryWhatsApp, validateRecoveryTemplateEdit } from "../../domain/recovery-template-content.js";

@Injectable()
export class RecoveryTemplateLifecycleUseCase implements RecoveryTemplateInitializer {
  constructor(
    @Inject(RECOVERY_TEMPLATE_LIFECYCLE_REPOSITORY) private readonly repo: RecoveryLifecycleRepository,
    @Inject(TEMPLATE_SUBMISSION_PORT) private readonly submission: TemplateSubmissionPort,
    @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configs: WhatsAppConfigRepository,
  ) {}

  async ensure(merchantId: string) { await this.repo.ensure(merchantId); }

  async get(merchantId: string) {
    await this.ensure(merchantId);
    const { email, whatsapp } = await this.repo.read(merchantId);
    const config = await this.configs.findByMerchantId(merchantId).catch(() => null);
    const connected = !!connectedTwilioCredentials(config, merchantId);
    const status = !connected && ["draft", "waiting_connection"].includes(whatsapp.metaStatus ?? "draft") ? "waiting_connection" : whatsapp.metaStatus ?? "draft";
    return {
      email: { subject: email.subject ?? "", body: email.body },
      suggested: RECOVERY_TEMPLATE_DEFAULTS,
      whatsapp: { body: whatsapp.body, revision: whatsapp.metaRevision, status, rejectionReason: whatsapp.metaRejectionReason },
      whatsappConnected: connected,
      effectiveChannel: connected && isApprovedRecoveryTemplate(whatsapp, merchantId) ? "whatsapp_template" as const : "email" as const,
    };
  }

  async save(merchantId: string, value: unknown) {
    const input = validateRecoveryTemplateEdit(value);
    await this.ensure(merchantId);
    await this.repo.save(merchantId, input);
    return this.get(merchantId);
  }

  async processDue(at?: Date) {
    const clock = () => at ?? new Date();
    const started = Date.now();
    const rows = await this.repo.due(clock());
    for (const row of rows) {
      if (Date.now() - started > 45_000) break;
      const now = clock();
      const creating = ["draft", "waiting_connection"].includes(row.metaStatus ?? "draft") && !row.twilioContentSid;
      if (!await this.repo.claim(row, now, creating)) continue;
      const later = new Date(now.getTime() + 60_000);
      try {
        // A process crash while creating content cannot authorize a second POST.
        if (row.metaStatus === "submitting" || row.metaStatus === "submission_unknown" && !row.twilioContentSid) {
          await this.repo.complete(row, { status: "submission_unknown", reason: "submission_acceptance_unknown", nextCheckAt: null }, false);
          continue;
        }
        const config = await this.configs.findByMerchantId(row.merchantId).catch(() => null);
        if (!connectedTwilioCredentials(config, row.merchantId)) {
          await this.repo.complete(row, { status: creating ? "waiting_connection" : row.metaStatus ?? "draft", nextCheckAt: later }, creating);
          continue;
        }
        if (creating) {
          const prepared = prepareRecoveryWhatsApp(row.body);
          const identity = createHash("sha256").update(row.merchantId).digest("hex").slice(0, 20);
          const result = await this.submission.createAndSubmit({
            merchantId: row.merchantId, friendlyName: `recovery_${identity}_v${row.metaRevision}`,
            language: "pt_BR", category: "MARKETING", metaBody: prepared.metaBody, sampleVariables: prepared.sampleVariables,
          });
          const uncertain = result.status === "unknown" || result.status === "submission_unknown";
          const state = uncertain ? "submission_unknown" : result.status;
          await this.repo.complete(row, {
            status: state, contentSid: result.contentSid || null, reason: result.rejectionReason ?? null,
            checkedAt: result.status === "approved" ? clock() : undefined,
            nextCheckAt: uncertain && !result.contentSid ? null : new Date(clock().getTime() + 60_000),
          }, true);
        } else if (row.twilioContentSid) {
          const result = await this.submission.syncStatus(row.merchantId, row.twilioContentSid);
          const known = ["approved", "submitted", "rejected", "paused", "disabled"].includes(result.status);
          // Never apply a response for another content revision.
          const valid = known && result.contentSid === row.twilioContentSid;
          await this.repo.complete(row, {
            status: valid ? result.status : row.metaStatus ?? "draft",
            reason: valid ? result.rejectionReason ?? null : undefined,
            checkedAt: valid ? clock() : undefined, nextCheckAt: new Date(clock().getTime() + 60_000),
          }, false);
        } else {
          await this.repo.complete(row, { status: row.metaStatus ?? "draft", nextCheckAt: null }, false);
        }
      } catch {
        // A failed save leaves the durable claim to expire. Never repeat a POST
        // just because persisting its result failed.
        await this.repo.complete(row, { status: creating ? "submission_unknown" : row.metaStatus ?? "draft", nextCheckAt: creating ? null : later }, creating).catch(() => undefined);
      }
    }
  }
}
