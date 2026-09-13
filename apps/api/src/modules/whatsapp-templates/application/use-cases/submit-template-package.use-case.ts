import { Injectable } from "@nestjs/common";
import { WHATSAPP_TEMPLATE_TYPES } from "../../domain/catalog/template-types.js";
import { RecoveryTemplateLifecycleUseCase } from "./recovery-template-lifecycle.use-case.js";

/** Persist the defaults after connection; the durable monitor submits and reconciles them. */
@Injectable()
export class SubmitTemplatePackageUseCase {
  constructor(private readonly lifecycle: RecoveryTemplateLifecycleUseCase) {}
  async execute(merchantId: string, _storeName?: string) {
    const result = { submitted: 0, queued: 0, skipped: 0, failed: 0, perType: [] as Array<{ type: string; status: string; contentSid?: string }> };
    for (const type of WHATSAPP_TEMPLATE_TYPES) {
      try {
        await this.lifecycle.ensure(merchantId, type);
        const row = await this.lifecycle.record(merchantId, type, "whatsapp");
        if (["draft", "waiting_connection"].includes(row.metaStatus ?? "draft")) result.queued++;
        else result.skipped++;
        result.perType.push({ type, status: row.metaStatus ?? "draft", contentSid: row.twilioContentSid ?? undefined });
      } catch { result.failed++; }
    }
    return result;
  }
}
