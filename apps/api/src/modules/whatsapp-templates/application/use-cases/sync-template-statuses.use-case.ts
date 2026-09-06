import { Injectable, Logger, Inject } from "@nestjs/common";
import {
  WHATSAPP_TEMPLATE_REPOSITORY,
  type WhatsAppTemplateRepositoryPort,
} from "../../domain/ports/whatsapp-template-repository.port.js";
import {
  TEMPLATE_SUBMISSION_PORT,
  type TemplateSubmissionPort,
} from "../../domain/ports/template-submission.port.js";

export interface PackageStatus {
  total: number;
  approved: number;
  submitted: number;
  rejected: number;
  draft: number;
  perType: Array<{ type: string; status: string; rejectionReason?: string | null }>;
}

/**
 * Refresh Meta approval status for all of a merchant's WhatsApp templates that
 * have a ContentSid, and return an aggregate for the dashboard.
 */
@Injectable()
export class SyncTemplateStatusesUseCase {
  private readonly logger = new Logger(SyncTemplateStatusesUseCase.name);

  constructor(
    @Inject(WHATSAPP_TEMPLATE_REPOSITORY)
    private readonly templates: WhatsAppTemplateRepositoryPort,
    @Inject(TEMPLATE_SUBMISSION_PORT)
    private readonly submission: TemplateSubmissionPort
  ) {}

  async execute(merchantId: string): Promise<PackageStatus> {
    const all = await this.templates.findAllByMerchant(merchantId);
    const whatsapp = all.filter((t) => t.channel === "whatsapp");
    const status: PackageStatus = {
      total: whatsapp.length,
      approved: 0,
      submitted: 0,
      rejected: 0,
      draft: 0,
      perType: [],
    };

    for (const tpl of whatsapp) {
      let current = tpl.metaStatus ?? "draft";
      if (tpl.twilioContentSid && tpl.type !== "cart_recovery") {
        const synced = await this.submission.syncStatus(merchantId, tpl.twilioContentSid);
        if (synced.status !== "unknown" && synced.status !== current) {
          current = synced.status;
          await this.templates.updateMeta({
            merchantId,
            type: tpl.type,
            channel: "whatsapp",
            metaStatus: synced.status,
            metaRejectionReason: synced.rejectionReason ?? null,
          }).catch(() => undefined);
        }
      }
      if (current === "approved") status.approved++;
      else if (current === "submitted") status.submitted++;
      else if (current === "rejected") status.rejected++;
      else status.draft++;
      status.perType.push({ type: tpl.type, status: current, rejectionReason: tpl.metaRejectionReason });
    }

    return status;
  }
}
