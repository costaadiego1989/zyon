import { Injectable, Inject, Optional } from "@nestjs/common";
import {
  WHATSAPP_CONFIG_REPOSITORY,
  type WhatsAppConfigRepository,
} from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import type {
  TemplateSubmissionPort,
  SubmitTemplateInput,
  TemplateSubmissionStatus,
} from "../../domain/ports/template-submission.port.js";
import { connectedTwilioCredentials } from "../../domain/services/recovery-whatsapp-policy.js";

const CONTENT_SID = /^HX[0-9a-fA-F]{32}$/;
const REQUEST_TIMEOUT_MS = 15_000;

function approvalStatus(value: unknown): TemplateSubmissionStatus["status"] {
  if (typeof value !== "string") return "unknown";
  switch (value.toLowerCase()) {
    case "approved": return "approved";
    case "rejected": return "rejected";
    case "paused": return "paused";
    case "disabled": return "disabled";
    case "pending":
    case "received": return "submitted";
    default: return "unknown";
  }
}

/** Tenant-authorized Content API calls. An uncertain create must never be retried blindly. */
@Injectable()
export class TwilioContentTemplateAdapter implements TemplateSubmissionPort {
  private readonly contentBase = "https://content.twilio.com/v1/Content";

  constructor(
    @Optional()
    @Inject(WHATSAPP_CONFIG_REPOSITORY)
    private readonly configRepo?: WhatsAppConfigRepository,
  ) {}

  async createAndSubmit(input: SubmitTemplateInput): Promise<TemplateSubmissionStatus> {
    const auth = await this.resolveAuth(input.merchantId);
    if (!auth) return { contentSid: "", status: "draft", rejectionReason: "connection_unavailable" };

    let contentSid: string;
    try {
      const res = await fetch(this.contentBase, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: "error",
        body: JSON.stringify({
          friendly_name: input.friendlyName,
          language: input.language,
          variables: input.sampleVariables,
          types: { "twilio/text": { body: input.metaBody } },
        }),
      });
      if (!res.ok) {
        return {
          contentSid: "",
          status: res.status >= 400 && res.status < 500 && res.status !== 408 ? "draft" : "submission_unknown",
          rejectionReason: `create_failed_${res.status}`,
        };
      }
      const data = await res.json() as { sid?: unknown } | null;
      if (typeof data?.sid !== "string" || !CONTENT_SID.test(data.sid)) {
        return { contentSid: "", status: "submission_unknown", rejectionReason: "create_invalid_sid" };
      }
      contentSid = data.sid;
    } catch {
      return { contentSid: "", status: "submission_unknown", rejectionReason: "create_outcome_unknown" };
    }

    // Connection can be revoked while the create request is in flight.
    const approvalAuth = await this.resolveAuth(input.merchantId);
    if (!approvalAuth || approvalAuth !== auth) {
      return { contentSid, status: "submission_unknown", rejectionReason: "connection_changed" };
    }
    try {
      const res = await fetch(`${this.contentBase}/${contentSid}/ApprovalRequests/whatsapp`, {
        method: "POST",
        headers: { Authorization: `Basic ${approvalAuth}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: "error",
        body: JSON.stringify({
          name: input.friendlyName.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 60),
          category: input.category,
        }),
      });
      if (!res.ok) {
        return { contentSid, status: "submission_unknown", rejectionReason: `approval_request_failed_${res.status}` };
      }
      const data = await res.json() as { status?: unknown; rejection_reason?: unknown } | null;
      const status = approvalStatus(data?.status);
      return {
        contentSid,
        status: status === "unknown" ? "submission_unknown" : status,
        ...(typeof data?.rejection_reason === "string" && data.rejection_reason
          ? { rejectionReason: data.rejection_reason } : {}),
      };
    } catch {
      return { contentSid, status: "submission_unknown", rejectionReason: "approval_outcome_unknown" };
    }
  }

  async syncStatus(merchantId: string, contentSid: string): Promise<TemplateSubmissionStatus> {
    if (!CONTENT_SID.test(contentSid)) return { contentSid, status: "unknown", rejectionReason: "invalid_content_sid" };
    const auth = await this.resolveAuth(merchantId);
    if (!auth) return { contentSid, status: "unknown", rejectionReason: "connection_unavailable" };
    try {
      const res = await fetch(`${this.contentBase}/${contentSid}/ApprovalRequests`, {
        method: "GET",
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: "error",
      });
      if (!res.ok) return { contentSid, status: "unknown" };
      const data = await res.json() as { whatsapp?: { status?: unknown; rejection_reason?: unknown } } | null;
      return {
        contentSid,
        status: approvalStatus(data?.whatsapp?.status),
        ...(typeof data?.whatsapp?.rejection_reason === "string" && data.whatsapp.rejection_reason
          ? { rejectionReason: data.whatsapp.rejection_reason } : {}),
      };
    } catch {
      return { contentSid, status: "unknown" };
    }
  }

  private async resolveAuth(merchantId: string): Promise<string | null> {
    try {
      const config = await this.configRepo?.findByMerchantId(merchantId);
      const credentials = connectedTwilioCredentials(config, merchantId);
      return credentials ? Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64") : null;
    } catch {
      return null;
    }
  }
}
