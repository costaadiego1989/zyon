import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import {
  WHATSAPP_CONFIG_REPOSITORY,
  type WhatsAppConfigRepository,
} from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";

export const TWILIO_CONTENT_TEMPLATE_ADAPTER = Symbol("TwilioContentTemplateAdapter");

export interface CreateTemplateInput {
  merchantId: string;
  friendlyName: string;
  language: string; // "pt_BR"
  /** Positional body, e.g. "Oi {{1}}! Use o cupom {{2}} e ganhe {{3}} OFF." */
  metaBody: string;
  /** Sample values per position for Twilio/Meta review, e.g. {"1":"Ana","2":"LY123","3":"10%"}. */
  sampleVariables: Record<string, string>;
  category: string; // UTILITY | MARKETING
}

export interface TemplateStatus {
  contentSid: string;
  status: "draft" | "submitted" | "approved" | "rejected" | "unknown";
  rejectionReason?: string;
}

/**
 * Bridges to Meta template approval via Twilio Content API.
 *
 *   POST /v1/Content                                  → create Content Template
 *   POST /v1/Content/{sid}/ApprovalRequests/whatsapp  → request WhatsApp approval
 *   GET  /v1/Content/{sid}/ApprovalRequests           → read approval status
 *
 * Dev-safe: when no Twilio credentials are configured, methods return a `draft`
 * status without calling out, so the dashboard flow works locally.
 */
@Injectable()
export class TwilioContentTemplateAdapter {
  private readonly logger = new Logger(TwilioContentTemplateAdapter.name);
  private readonly contentBase = "https://content.twilio.com/v1/Content";

  constructor(
    @Optional()
    @Inject(WHATSAPP_CONFIG_REPOSITORY)
    private readonly configRepo?: WhatsAppConfigRepository
  ) {}

  async createAndSubmit(input: CreateTemplateInput): Promise<TemplateStatus> {
    const auth = await this.resolveAuth(input.merchantId);
    if (!auth) {
      this.logger.warn(
        `Twilio Content API not configured for merchant ${input.merchantId} — returning draft (no submission)`
      );
      return { contentSid: "", status: "draft" };
    }

    // 1) Create the Content Template (twilio/text type with variables).
    const createBody = {
      friendly_name: input.friendlyName,
      language: input.language,
      variables: input.sampleVariables,
      types: {
        "twilio/text": { body: input.metaBody },
      },
    };

    let contentSid: string;
    try {
      const res = await fetch(this.contentBase, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createBody),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        this.logger.error(`Twilio Content create failed (${res.status}): ${t}`);
        return { contentSid: "", status: "draft", rejectionReason: `create_failed_${res.status}` };
      }
      const data = (await res.json()) as { sid?: string };
      contentSid = String(data.sid ?? "");
      if (!contentSid) return { contentSid: "", status: "draft", rejectionReason: "no_sid" };
    } catch (err) {
      this.logger.error(`Twilio Content create error: ${err instanceof Error ? err.message : String(err)}`);
      return { contentSid: "", status: "draft", rejectionReason: "network_error" };
    }

    // 2) Request WhatsApp approval.
    try {
      const res = await fetch(`${this.contentBase}/${contentSid}/ApprovalRequests/whatsapp`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: input.friendlyName.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 60),
          category: input.category,
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        this.logger.warn(`Twilio approval request failed (${res.status}): ${t}`);
        return { contentSid, status: "draft", rejectionReason: `approval_request_failed_${res.status}` };
      }
    } catch (err) {
      this.logger.warn(`Twilio approval request error: ${err instanceof Error ? err.message : String(err)}`);
      return { contentSid, status: "draft", rejectionReason: "approval_network_error" };
    }

    this.logger.log(`Template ${contentSid} submitted to Meta for approval`);
    return { contentSid, status: "submitted" };
  }

  async syncStatus(merchantId: string, contentSid: string): Promise<TemplateStatus> {
    const auth = await this.resolveAuth(merchantId);
    if (!auth || !contentSid) {
      return { contentSid, status: "draft" };
    }
    try {
      const res = await fetch(`${this.contentBase}/${contentSid}/ApprovalRequests`, {
        method: "GET",
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!res.ok) {
        return { contentSid, status: "unknown" };
      }
      const data = (await res.json()) as {
        whatsapp?: { status?: string; rejection_reason?: string };
      };
      const raw = data.whatsapp?.status?.toLowerCase() ?? "";
      const status: TemplateStatus["status"] =
        raw === "approved"
          ? "approved"
          : raw === "rejected"
            ? "rejected"
            : raw === "pending" || raw === "received"
              ? "submitted"
              : "unknown";
      return {
        contentSid,
        status,
        rejectionReason: data.whatsapp?.rejection_reason,
      };
    } catch (err) {
      this.logger.debug(`syncStatus error: ${err instanceof Error ? err.message : String(err)}`);
      return { contentSid, status: "unknown" };
    }
  }

  private async resolveAuth(merchantId: string): Promise<string | null> {
    let accountSid: string | undefined;
    let authToken: string | undefined;

    if (this.configRepo) {
      try {
        const cfg = await this.configRepo.findByMerchantId(merchantId);
        const c = (cfg?.credentials ?? {}) as Record<string, unknown>;
        if (c.accountSid && c.authToken) {
          accountSid = String(c.accountSid);
          authToken = String(c.authToken);
        }
      } catch {
        // fall through to env
      }
    }
    accountSid ??= process.env.TWILIO_ACCOUNT_SID;
    authToken ??= process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) return null;
    return Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  }
}
