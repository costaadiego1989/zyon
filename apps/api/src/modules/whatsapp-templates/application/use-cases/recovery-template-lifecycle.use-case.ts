import { prepareSalesWhatsApp, salesDefaults, salesTemplateType, validateSalesEdit } from "../../domain/sales-template-content.js";
import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { RECOVERY_TEMPLATE_LIFECYCLE_REPOSITORY, type RecoveryLifecycleRepository, type RecoveryTemplateInitializer } from "../../domain/ports/recovery-template-lifecycle.port.js";
import { TEMPLATE_SUBMISSION_PORT, type TemplateSubmissionPort } from "../../domain/ports/template-submission.port.js";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudRecoveryCredentials, isApprovedSalesTemplate } from "../../domain/services/recovery-whatsapp-policy.js";

@Injectable()
export class RecoveryTemplateLifecycleUseCase implements RecoveryTemplateInitializer {
  constructor(
    @Inject(RECOVERY_TEMPLATE_LIFECYCLE_REPOSITORY) private readonly repo: RecoveryLifecycleRepository,
    @Inject(TEMPLATE_SUBMISSION_PORT) private readonly submission: TemplateSubmissionPort,
    @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configs: WhatsAppConfigRepository,
  ) {}

  async ensure(merchantId: string, type = "cart_recovery") { await this.repo.ensure(merchantId, salesTemplateType(type)); }

  async get(merchantId: string, type = "cart_recovery") {
    await this.ensure(merchantId, type);
    const { email, whatsapp } = await this.repo.read(merchantId, type);
    const config = await this.configs.findByMerchantId(merchantId).catch(() => null);
    const connected = !!connectedMetaCloudRecoveryCredentials(config, merchantId);
    const status = !connected && ["draft", "waiting_connection"].includes(whatsapp.metaStatus ?? "draft") ? "waiting_connection" : whatsapp.metaStatus ?? "draft";
    return {
      email: { subject: email.subject ?? "", body: email.body },
      suggested: salesDefaults(type),
      whatsapp: { body: whatsapp.body, revision: whatsapp.metaRevision, status, rejectionReason: whatsapp.metaRejectionReason, approvedVersions: (whatsapp.metaApprovedVersions ?? []).map(v => ({ revision: v.revision, body: v.body })) },
      whatsappConnected: connected,
      effectiveChannel: isApprovedSalesTemplate(whatsapp, merchantId, type, connectedMetaCloudRecoveryCredentials(config, merchantId)?.wabaId ?? "") && connected ? "whatsapp_template" as const : "email" as const,
    };
  }

  async save(merchantId: string, value: unknown, type = "cart_recovery") {
    const input = validateSalesEdit(type, value);
    await this.ensure(merchantId, type);
    await this.repo.save(merchantId, input, type);
    return this.get(merchantId, type);
  }

  async record(merchantId: string, type: string, channel: string) {
    if (channel !== "email" && channel !== "whatsapp") throw new BadRequestException("invalid_template_channel");
    await this.ensure(merchantId, type);
    return (await this.repo.read(merchantId, type))[channel];
  }

  async saveChannel(merchantId: string, type: string, channel: string, input: { body: string; subject?: string; revision?: number }) {
    await this.record(merchantId, type, channel);
    const pair = await this.repo.read(merchantId, type);
    if (input.revision !== pair.whatsapp.metaRevision) throw new ConflictException("template_revision_conflict");
    await this.save(merchantId, { email: { subject: channel === "email" ? input.subject : pair.email.subject,
      body: channel === "email" ? input.body : pair.email.body },
      whatsapp: { body: channel === "whatsapp" ? input.body : pair.whatsapp.body, revision: input.revision } }, type);
    const result = await this.record(merchantId, type, channel);
    return { ...result, metaRevision: (await this.repo.read(merchantId, type)).whatsapp.metaRevision };
  }

  async restore(merchantId: string, type: string, revision: number, expectedRevision: number) {
    const current = await this.record(merchantId, type, "whatsapp");
    if (current.metaRevision !== expectedRevision || current.metaStatus === "submitting" || current.metaClaimToken) throw new ConflictException("template_revision_conflict");
    const version = current.metaApprovedVersions?.find(v => v.revision === revision);
    if (!version || !this.repo.restore) throw new BadRequestException("approved_version_not_found");
    const config = await this.configs.findByMerchantId(merchantId);
    const connection = connectedMetaCloudRecoveryCredentials(config, merchantId);
    if (!connection || connection.wabaId !== version.wabaId) throw new BadRequestException("template_account_mismatch");
    const status = await this.submission.syncStatus(merchantId, version.contentSid, { language: version.metaLanguage, body: version.metaTemplateBody });
    if (status.status !== "approved" || status.contentSid !== version.contentSid) throw new BadRequestException("previous_template_not_approved");
    const latest = connectedMetaCloudRecoveryCredentials(await this.configs.findByMerchantId(merchantId), merchantId);
    if (!latest || latest.wabaId !== connection.wabaId) throw new ConflictException("template_connection_changed");
    await this.repo.restore(current, version, new Date());
    return this.get(merchantId, type);
  }

  async submit(merchantId: string, type: string) {
    const row = await this.record(merchantId, type, "whatsapp");
    // A held unknown submission is reconciled, never blindly resubmitted.
    if (row.metaStatus === "submitting" || row.metaClaimToken) return row;
    await this.processRows([row]);
    return this.record(merchantId, type, "whatsapp");
  }

  async processDue(at?: Date) {
    await this.processRows(await this.repo.due(at ?? new Date()), at);
  }

  private async processRows(rows: import("../../domain/ports/recovery-template-lifecycle.port.js").RecoveryLifecycleRecord[], at?: Date) {
    const clock = () => at ?? new Date();
    const started = Date.now();
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
        const connection = connectedMetaCloudRecoveryCredentials(config, row.merchantId);
        if (!connection) {
          await this.repo.complete(row, { status: creating ? "waiting_connection" : row.metaStatus ?? "draft", nextCheckAt: later }, creating);
          continue;
        }
        if (row.metaWabaId && row.metaWabaId !== connection.wabaId) {
          await this.repo.complete(row, { status: "disabled", reason: "template_account_mismatch", nextCheckAt: later }, creating);
          continue;
        }
        if (creating) {
          const prepared = prepareSalesWhatsApp(row.type, row.body);
          const identity = createHash("sha256").update(row.merchantId).digest("hex").slice(0, 20);
          const result = await this.submission.createAndSubmit({
            merchantId: row.merchantId, friendlyName: `${row.type}_${identity}_v${row.metaRevision}`,
            language: "pt_BR", category: prepared.category, metaBody: prepared.metaBody, sampleVariables: prepared.sampleVariables,
          });
          const uncertain = result.status === "unknown" || result.status === "submission_unknown";
          const state = uncertain ? "submission_unknown" : result.status;
          await this.repo.complete(row, {
            status: state, wabaId: connection.wabaId, contentSid: result.contentSid || null, reason: result.rejectionReason ?? null,
            checkedAt: result.status === "approved" ? clock() : undefined,
            nextCheckAt: uncertain && !result.contentSid ? null : new Date(clock().getTime() + 60_000),
          }, true);
        } else if (row.twilioContentSid) {
          const result = await this.submission.syncStatus(row.merchantId, row.twilioContentSid, { language: row.metaLanguage ?? "pt_BR", body: row.metaTemplateBody ?? "" });
          const known = ["approved", "submitted", "rejected", "paused", "disabled"].includes(result.status);
          // Never apply a response for another content revision.
          const valid = known && result.contentSid === row.twilioContentSid;
          await this.repo.complete(row, {
            status: valid ? result.status : row.metaStatus ?? "draft", wabaId: valid ? connection.wabaId : undefined,
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
