/**
 * Optional hook to auto-submit the platform's WhatsApp template package to Meta
 * when a merchant connects their WABA. Bound to the shared
 * SubmitTemplatePackageUseCase in module wiring; declared as a port here so
 * ConfigureWhatsAppUseCase stays decoupled from the whatsapp-templates module.
 */
export const TEMPLATE_PACKAGE_SUBMITTER = Symbol("TEMPLATE_PACKAGE_SUBMITTER");

export interface TemplatePackageSubmitter {
  execute(merchantId: string, storeName?: string): Promise<unknown>;
}
