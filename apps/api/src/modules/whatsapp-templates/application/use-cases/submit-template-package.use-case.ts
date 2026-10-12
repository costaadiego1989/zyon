import { Injectable } from "@nestjs/common";
import { WHATSAPP_TEMPLATE_TYPES } from "../../domain/catalog/template-types.js";
import { RecoveryTemplateLifecycleUseCase } from "./recovery-template-lifecycle.use-case.js";

type SubmissionState = "submitted" | "approved" | "waiting_connection" | "draft" | "rejected" | "paused" | "disabled" | "submission_unknown";

/**
 * Registers the complete default package against the merchant's just-connected
 * Meta WABA. The lifecycle remains responsible for durable polling after this
 * first submission, but connection may never depend on a later timer to issue
 * the Meta registration requests.
 */
@Injectable()
export class SubmitTemplatePackageUseCase {
  constructor(private readonly lifecycle: RecoveryTemplateLifecycleUseCase) {}

  async execute(merchantId: string, _storeName?: string) {
    const result = {
      submitted: 0,
      queued: 0,
      skipped: 0,
      failed: 0,
      perType: [] as Array<{ type: string; status: SubmissionState | string; contentSid?: string; reason?: string }>,
    };

    for (const type of WHATSAPP_TEMPLATE_TYPES) {
      try {
        // `submit` claims the row before POSTing to Meta. Retrying this package
        // after a timeout/reconnect cannot create a duplicate template.
        const row = await this.lifecycle.submit(merchantId, type);
        const status = (row.metaStatus ?? "draft") as SubmissionState;
        const item = {
          type,
          status,
          contentSid: row.twilioContentSid ?? undefined,
          reason: row.metaRejectionReason ?? undefined,
        };
        result.perType.push(item);

        if (status === "submitted") result.submitted++;
        else if (status === "approved") result.skipped++;
        else if (status === "waiting_connection") result.queued++;
        else result.failed++;
      } catch (error) {
        // Keep registering the remaining notification scenarios even when one
        // template has invalid merchant content or a transient persistence fault.
        result.failed++;
        result.perType.push({ type, status: "draft", reason: safeReason(error) });
      }
    }
    return result;
  }
}

function safeReason(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/[\r\n]+/g, " ").slice(0, 180)
    : "template_submission_failed";
}
