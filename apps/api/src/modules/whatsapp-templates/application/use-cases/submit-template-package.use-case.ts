import { Injectable, Logger, Inject } from "@nestjs/common";
import {
  WHATSAPP_TEMPLATE_REPOSITORY,
  type WhatsAppTemplateRepositoryPort,
} from "../../domain/ports/whatsapp-template-repository.port.js";
import {
  TEMPLATE_SUBMISSION_PORT,
  type TemplateSubmissionPort,
} from "../../domain/ports/template-submission.port.js";
import { buildCatalog } from "../../domain/catalog/template-catalog.js";
import { WHATSAPP_TEMPLATE_TYPES } from "../../domain/catalog/template-types.js";

export interface SubmitTemplatePackageResult {
  submitted: number;
  skipped: number;
  failed: number;
  perType: Array<{ type: string; status: string; contentSid?: string }>;
}

/**
 * Seed + submit the platform's default WhatsApp template package for one
 * merchant (called on WABA connect). Idempotent: types already carrying a
 * ContentSid are skipped. Never throws — a failed submission is logged and the
 * loop continues, so it can run non-blocking after connect.
 */
@Injectable()
export class SubmitTemplatePackageUseCase {
  private readonly logger = new Logger(SubmitTemplatePackageUseCase.name);

  constructor(
    @Inject(WHATSAPP_TEMPLATE_REPOSITORY)
    private readonly templates: WhatsAppTemplateRepositoryPort,
    @Inject(TEMPLATE_SUBMISSION_PORT)
    private readonly submission: TemplateSubmissionPort
  ) {}

  async execute(merchantId: string, storeName = "sua loja"): Promise<SubmitTemplatePackageResult> {
    const catalog = buildCatalog(storeName);
    const result: SubmitTemplatePackageResult = { submitted: 0, skipped: 0, failed: 0, perType: [] };

    for (const type of WHATSAPP_TEMPLATE_TYPES) {
      // Recovery has a versioned, durable lifecycle; this legacy package must
      // never overwrite edited content or race its submission worker.
      if (type === "cart_recovery") continue;
      const def = catalog[type];
      try {
        // Persist the base template (freeform + meta positional) if absent/outdated.
        const existing = await this.templates.findByMerchantAndType(merchantId, type, "whatsapp");
        if (existing?.twilioContentSid && existing.metaStatus && existing.metaStatus !== "draft") {
          result.skipped++;
          result.perType.push({ type, status: existing.metaStatus, contentSid: existing.twilioContentSid });
          continue;
        }

        await this.templates.upsert({
          merchantId,
          type,
          channel: "whatsapp",
          name: def.label,
          body: def.freeformBody,
          metaCategory: def.category,
          metaLanguage: def.language,
          metaTemplateBody: def.metaBody,
          metaVariableMap: def.variableMap,
        });

        const submission = await this.submission.createAndSubmit({
          merchantId,
          friendlyName: `${merchantId}_${type}_whatsapp`.slice(0, 64),
          language: def.language,
          metaBody: def.metaBody,
          sampleVariables: def.sampleVariables,
          category: def.category,
        });

        await this.templates.updateMeta({
          merchantId,
          type,
          channel: "whatsapp",
          twilioContentSid: submission.contentSid || undefined,
          metaStatus: submission.status,
          metaRejectionReason: submission.rejectionReason ?? null,
        });

        if (submission.status === "submitted" || submission.status === "approved") result.submitted++;
        else result.failed++;
        result.perType.push({ type, status: submission.status, contentSid: submission.contentSid });
      } catch (err) {
        result.failed++;
        result.perType.push({ type, status: "error" });
        this.logger.warn(`submit-package: ${type} failed`, {
          merchantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.logger.log(
      `submit-package for ${merchantId}: submitted=${result.submitted} skipped=${result.skipped} failed=${result.failed}`
    );
    return result;
  }
}
