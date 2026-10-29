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
const SNAPSHOT_TTL_MS = 5 * 60_000;
const RATE_LIMIT_BACKOFF_MS = 60 * 60_000;
type MetaTemplate = { name?: string; status?: string; category?: string; rejected_reason?: string; language?: string; components?: Array<{ type: string; text?: string; buttons?: Array<{ type?: string; otp_type?: string; url?: string }> }> };
type ExpectedTemplate = { language: string; body: string; category?: string };

function authenticationComponents() {
  return [{ type: "BODY", add_security_recommendation: true }, { type: "FOOTER", code_expiration_minutes: 10 },
    { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copiar código" }] }];
}

function matchesAuthenticationPreset(template: MetaTemplate): boolean {
  const body = template.components?.find(c => c.type === "BODY")?.text ?? "";
  if (!body.includes("{{1}}") || body.replace(/\{\{1\}\}/g, "").includes("{{")) return false;
  return !!template.components?.some(c => c.type === "BUTTONS" && c.buttons?.some(button => {
    if (button.type === "OTP") return button.otp_type === "COPY_CODE";
    try { const url = new URL(button.url ?? ""); return button.type === "URL" && url.protocol === "https:" && url.hostname === "www.whatsapp.com"
      && url.pathname === "/otp/code/" && url.searchParams.get("otp_type") === "COPY_CODE"; } catch { return false; }
  }));
}

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
  private readonly snapshots = new Map<string, { expiresAt: number; result: Promise<MetaTemplate[] | null> }>();
  private readonly rateLimitedUntil = new Map<string, number>();
  constructor(
    @Optional() @Inject(WHATSAPP_CONFIG_REPOSITORY)
    private readonly configRepo?: WhatsAppConfigRepository,
  ) {}

  async createAndSubmit(input: SubmitTemplateInput): Promise<TemplateSubmissionStatus> {
    const credentials = await this.credentials(input.merchantId);
    if (!credentials) return { contentSid: "", status: "draft", rejectionReason: "connection_unavailable" };
    const name = templateName(input);
    const retryAfterMs = this.retryAfter(credentials.wabaId);
    if (retryAfterMs) return { contentSid: "", status: "draft", rejectionReason: "provider_rate_limited", retryAfterMs };
    let response: Response;
    try {
      response = await fetch(`${GRAPH}/${credentials.wabaId}/message_templates`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, language: input.language, category: String(input.category || "UTILITY").toUpperCase(),
          components: input.category === "AUTHENTICATION" ? authenticationComponents() : [bodyComponent(input)] }),
      });
    } catch {
      return { contentSid: name, status: "submission_unknown", rejectionReason: "create_outcome_unknown" };
    }
    if (!response.ok) {
      if (await this.markRateLimit(response, credentials.wabaId)) return { contentSid: "", status: "draft", rejectionReason: "provider_rate_limited", retryAfterMs: this.retryAfter(credentials.wabaId) };
      if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        const existing = await this.findByName(credentials.accessToken, credentials.wabaId, name, { language: input.language, body: input.metaBody, category: input.category });
        if (existing) return existing;
        return { contentSid: "", status: "draft", rejectionReason: `create_failed_${response.status}` };
      }
      return { contentSid: name, status: "submission_unknown", rejectionReason: `create_failed_${response.status}` };
    }
    const result = await response.json().catch(() => null) as { status?: unknown; rejected_reason?: unknown } | null;
    this.snapshots.delete(credentials.wabaId);
    const resultStatus = status(result?.status);
    return {
      contentSid: name,
      status: resultStatus === "unknown" ? "submitted" : resultStatus,
      ...(typeof result?.rejected_reason === "string" && result.rejected_reason ? { rejectionReason: result.rejected_reason } : {}),
    };
  }

  async syncStatus(merchantId: string, contentSid: string, expected?: ExpectedTemplate): Promise<TemplateSubmissionStatus> {
    if (!contentSid.trim()) return { contentSid, status: "unknown", rejectionReason: "template_identifier_missing" };
    const credentials = await this.credentials(merchantId);
    if (!credentials) return { contentSid, status: "unknown", rejectionReason: "connection_unavailable" };
    const result = await this.findByName(credentials.accessToken, credentials.wabaId, contentSid, expected);
    const retryAfterMs = this.retryAfter(credentials.wabaId);
    return result ?? { contentSid, status: "unknown", rejectionReason: retryAfterMs ? "provider_rate_limited" : "template_not_found", ...(retryAfterMs ? { retryAfterMs } : {}) };
  }

  private async findByName(accessToken: string, wabaId: string, name: string, expected?: ExpectedTemplate): Promise<TemplateSubmissionStatus | null> {
    try {
      const templates = await this.templates(accessToken, wabaId);
      const item = templates?.find(template => template.name === name && (!expected || template.language === expected.language));
      if (!item) return null;
      if (expected?.category && item.category !== expected.category) return { contentSid: name, status: "disabled", rejectionReason: "template_category_mismatch" };
      if (expected && !(expected.category === "AUTHENTICATION" ? matchesAuthenticationPreset(item)
        : item.components?.find(c => c.type === "BODY")?.text === expected.body)) return { contentSid: name, status: "disabled", rejectionReason: "template_content_mismatch" };
      return {
        contentSid: name,
        status: status(item.status),
        ...(typeof item.rejected_reason === "string" && item.rejected_reason ? { rejectionReason: item.rejected_reason } : {}),
      };
    } catch { return null; }
  }

  private retryAfter(wabaId: string) { return Math.max(0, (this.rateLimitedUntil.get(wabaId) ?? 0) - Date.now()); }

  private async markRateLimit(response: Response, wabaId: string) {
    const body = await response.clone().json().catch(() => null) as { error?: { code?: number } } | null;
    if (response.status !== 429 && ![4, 17, 80007, 80008].includes(body?.error?.code ?? 0)) return false;
    this.rateLimitedUntil.set(wabaId, Date.now() + RATE_LIMIT_BACKOFF_MS);
    this.snapshots.delete(wabaId);
    return true;
  }

  private async templates(accessToken: string, wabaId: string): Promise<MetaTemplate[] | null> {
    if (this.retryAfter(wabaId)) return null;
    const cached = this.snapshots.get(wabaId);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    // One WABA snapshot serves every template in the poll, including concurrent reads.
    const result = this.readTemplates(accessToken, wabaId).catch(() => null);
    this.snapshots.set(wabaId, { expiresAt: Date.now() + SNAPSHOT_TTL_MS, result });
    return result;
  }

  private async readTemplates(accessToken: string, wabaId: string): Promise<MetaTemplate[] | null> {
    const url = new URL(`${GRAPH}/${wabaId}/message_templates`);
    url.searchParams.set("fields", "name,status,category,rejected_reason,language,components");
    url.searchParams.set("limit", "100");
    const templates: MetaTemplate[] = [];
    for (let page = 0; page < 10; page++) {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) { await this.markRateLimit(response, wabaId); return null; }
      const payload = await response.json().catch(() => null) as { data?: MetaTemplate[]; paging?: { next?: string; cursors?: { after?: string } } } | null;
      if (!Array.isArray(payload?.data)) return null;
      templates.push(...payload.data);
      const after = payload.paging?.next && payload.paging.cursors?.after;
      if (!after) return templates;
      url.searchParams.set("after", after);
    }
    return templates;
  }

  private async credentials(merchantId: string) {
    try { return connectedMetaCloudCredentials(await this.configRepo?.findByMerchantId(merchantId), merchantId); }
    catch { return null; }
  }
}
