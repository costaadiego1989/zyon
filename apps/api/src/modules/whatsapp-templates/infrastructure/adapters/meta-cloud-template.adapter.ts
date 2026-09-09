import { Inject, Injectable, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  WHATSAPP_CONFIG_REPOSITORY,
  type WhatsAppConfigRepository,
} from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudCredentials } from "../../../whatsapp-channel/domain/services/connected-meta-cloud-credentials.js";
import type {
  SubmitTemplateInput,
  TemplateSubmissionPort,
  TemplateSubmissionStatus,
} from "../../domain/ports/template-submission.port.js";

const GRAPH = "https://graph.facebook.com/v23.0";
const TIMEOUT_MS = 15_000;

function status(value: unknown): TemplateSubmissionStatus["status"] {
  switch (String(value ?? "").toUpperCase()) {
    case "APPROVED": return "approved";
    case "PENDING":
    case "PENDING_DELETION": return "submitted";
    case "REJECTED": return "rejected";
    case "PAUSED": return "paused";
    case "DISABLED": return "disabled";
    default: return "unknown";
  }
}

function templateName(input: SubmitTemplateInput): string {
  const readable = input.friendlyName.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "template";
  const digest = createHash("sha256")
    .update(`${input.language}|${input.category}|${input.metaBody}`)
    .digest("hex")
    .slice(0, 10);
  return `zyon_${readable.slice(0, 48)}_${digest}`.slice(0, 512);
}

function bodyComponent(input: SubmitTemplateInput) {
  const positions = [...input.metaBody.matchAll(/{{(\d+)}}/g)]
    .map(match => Number(match[1]))
    .filter((value, index, values) => Number.isSafeInteger(value) && value > 0 && values.indexOf(value) === index)
    .sort((a, b) => a - b);
  const body: Record<string, unknown> = { type: "BODY", text: input.metaBody };
  if (positions.length) body.example = { body_text: [positions.map(position => input.sampleVariables[String(position)] ?? "exemplo")] };
  return body;
}

/** Official Cloud API implementation. `contentSid` stores the opaque Meta template name. */
@Injectable()
export class MetaCloudTemplateAdapter implements TemplateSubmissionPort {
  constructor(
    @Optional() @Inject(WHATSAPP_CONFIG_REPOSITORY)
    private readonly configRepo?: WhatsAppConfigRepository,
  ) {}

  async createAndSubmit(input: SubmitTemplateInput): Promise<TemplateSubmissionStatus> {
    const credentials = await this.credentials(input.merchantId);
    if (!credentials) return { contentSid: "", status: "draft", rejectionReason: "connection_unavailable" };
    const name = templateName(input);
    let response: Response;
    try {
      response = await fetch(`${GRAPH}/${credentials.wabaId}/message_templates`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, language: input.language, category: String(input.category || "UTILITY").toUpperCase(), components: [bodyComponent(input)] }),
      });
    } catch {
      return { contentSid: name, status: "submission_unknown", rejectionReason: "create_outcome_unknown" };
    }
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        const existing = await this.findByName(credentials.accessToken, credentials.wabaId, name);
        if (existing) return existing;
        return { contentSid: "", status: "draft", rejectionReason: `create_failed_${response.status}` };
      }
      return { contentSid: name, status: "submission_unknown", rejectionReason: `create_failed_${response.status}` };
    }
    const result = await response.json().catch(() => null) as { status?: unknown; rejected_reason?: unknown } | null;
    const resultStatus = status(result?.status);
    return {
      contentSid: name,
      status: resultStatus === "unknown" ? "submitted" : resultStatus,
      ...(typeof result?.rejected_reason === "string" && result.rejected_reason ? { rejectionReason: result.rejected_reason } : {}),
    };
  }

  async syncStatus(merchantId: string, contentSid: string): Promise<TemplateSubmissionStatus> {
    if (!contentSid.trim()) return { contentSid, status: "unknown", rejectionReason: "template_identifier_missing" };
    const credentials = await this.credentials(merchantId);
    if (!credentials) return { contentSid, status: "unknown", rejectionReason: "connection_unavailable" };
    return (await this.findByName(credentials.accessToken, credentials.wabaId, contentSid))
      ?? { contentSid, status: "unknown", rejectionReason: "template_not_found" };
  }

  private async findByName(accessToken: string, wabaId: string, name: string): Promise<TemplateSubmissionStatus | null> {
    try {
      const url = new URL(`${GRAPH}/${wabaId}/message_templates`);
      url.searchParams.set("name", name);
      url.searchParams.set("fields", "name,status,rejected_reason");
      url.searchParams.set("limit", "100");
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) return null;
      const payload = await response.json().catch(() => null) as { data?: Array<{ name?: unknown; status?: unknown; rejected_reason?: unknown }> } | null;
      const item = payload?.data?.find(template => template.name === name);
      if (!item) return null;
      return {
        contentSid: name,
        status: status(item.status),
        ...(typeof item.rejected_reason === "string" && item.rejected_reason ? { rejectionReason: item.rejected_reason } : {}),
      };
    } catch { return null; }
  }

  private async credentials(merchantId: string) {
    try { return connectedMetaCloudCredentials(await this.configRepo?.findByMerchantId(merchantId), merchantId); }
    catch { return null; }
  }
}
