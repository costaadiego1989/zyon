import { isWhatsAppTemplateType } from "../../domain/catalog/template-types.js";
import { Injectable, Inject } from "@nestjs/common";
import { WHATSAPP_TEMPLATE_REPOSITORY, type WhatsAppTemplateRepositoryPort } from "../../domain/ports/whatsapp-template-repository.port.js";
import { RecoveryTemplateLifecycleUseCase } from "./recovery-template-lifecycle.use-case.js";

@Injectable()
export class SyncTemplateStatusesUseCase {
  constructor(@Inject(WHATSAPP_TEMPLATE_REPOSITORY) private readonly templates: WhatsAppTemplateRepositoryPort,
    private readonly lifecycle: RecoveryTemplateLifecycleUseCase) {}
  async execute(merchantId: string) {
    const rows = (await this.templates.findAllByMerchant(merchantId)).filter(t => t.channel === "whatsapp" && isWhatsAppTemplateType(t.type));
    const result = { total: rows.length, approved: 0, submitted: 0, rejected: 0, draft: 0, perType: [] as Array<{ type: string; status: string; rejectionReason?: string | null }> };
    for (const row of rows) {
      const synced = await this.lifecycle.submit(merchantId, row.type);
      const status = synced.metaStatus ?? "draft";
      if (status === "approved") result.approved++;
      else if (status === "submitted") result.submitted++;
      else if (status === "rejected") result.rejected++;
      else result.draft++;
      result.perType.push({ type: row.type, status, rejectionReason: synced.metaRejectionReason });
    }
    return result;
  }
}
