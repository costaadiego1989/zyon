import { dashboardJson } from "../http/client.js";

export type RecoveryTemplateStatus =
  | "waiting_connection" | "draft" | "submitting" | "submitted" | "approved"
  | "rejected" | "paused" | "disabled" | "submission_unknown";

export interface RecoveryTemplates {
  suggested?: { email: { subject: string; body: string }; whatsapp: { body: string } };
  email: { subject: string; body: string };
  whatsapp: { body: string; revision: number; status: RecoveryTemplateStatus; rejectionReason: string | null };
  whatsappConnected: boolean;
  effectiveChannel: "whatsapp_template" | "email";
}

export interface RecoveryTemplatesUpdate {
  email: { subject: string; body: string };
  whatsapp: { body: string; revision: number };
}

export function getRecoveryTemplates(apiBaseUrl: string, fetchImpl?: typeof fetch): Promise<RecoveryTemplates> {
  return dashboardJson(apiBaseUrl, "/cart-recovery/templates", {}, fetchImpl);
}

export function saveRecoveryTemplates(
  apiBaseUrl: string, draft: RecoveryTemplatesUpdate, fetchImpl?: typeof fetch,
): Promise<RecoveryTemplates> {
  // Approval status is authoritative on the server and never submitted by the editor.
  return dashboardJson(apiBaseUrl, "/cart-recovery/templates", {
    method: "PUT",
    jsonBody: { email: { subject: draft.email.subject, body: draft.email.body },
      whatsapp: { body: draft.whatsapp.body, revision: draft.whatsapp.revision } },
  }, fetchImpl);
}
