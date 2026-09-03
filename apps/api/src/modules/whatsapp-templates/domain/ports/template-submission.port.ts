/**
 * Port for submitting WhatsApp templates to Meta for approval (bridged via
 * Twilio Content API) and reading their approval status.
 */
export const TEMPLATE_SUBMISSION_PORT = Symbol("TemplateSubmissionPort");

export interface SubmitTemplateInput {
  merchantId: string;
  friendlyName: string;
  language: string;
  /** positional body, e.g. "Oi {{1}}! Use {{2}}". */
  metaBody: string;
  /** position → sample value for the Meta review. */
  sampleVariables: Record<string, string>;
  category: string; // UTILITY | MARKETING
}

export interface TemplateSubmissionStatus {
  contentSid: string;
  status: "draft" | "submitted" | "approved" | "rejected" | "unknown";
  rejectionReason?: string;
}

export interface TemplateSubmissionPort {
  createAndSubmit(input: SubmitTemplateInput): Promise<TemplateSubmissionStatus>;
  syncStatus(merchantId: string, contentSid: string): Promise<TemplateSubmissionStatus>;
}
