/** Supported template boundary for other modules. */
export { WhatsAppTemplatesModule } from "./whatsapp-templates.module.js";
export { TEMPLATE_SUBMISSION_PORT } from "./domain/ports/template-submission.port.js";
export type {
  TemplateSubmissionPort,
  TemplateSubmissionStatus,
} from "./domain/ports/template-submission.port.js";
