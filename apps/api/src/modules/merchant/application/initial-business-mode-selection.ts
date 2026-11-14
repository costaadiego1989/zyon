import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { assertCompatibleBusinessModeChange, parseBusinessMode, ServiceBusinessPolicyError } from "../domain/service-business-policy.js";

export function isInitialBusinessSelectionWrite(settings: Record<string, unknown>): boolean {
  return Object.hasOwn(settings, "business_mode") || settings.registration_pending === false || settings.oauth_registration_pending === false;
}

/** Run in the SAME transaction as the settings write. The body cannot open the
 * pending state or bypass the dedicated guarded mode-change command. */
export async function selectInitialBusinessMode(
  tx: Pick<Prisma.TransactionClient, "merchant" | "product" | "serviceAppointment" | "paymentIntent">,
  merchantId: string,
  incoming: Record<string, unknown>,
): Promise<void> {
  if (!isInitialBusinessSelectionWrite(incoming)) return;
  const current = await tx.merchant.findUnique({ where: { id: merchantId }, select: {
    businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true, storeSettings: true,
  } });
  if (!current) throw new NotFoundException("merchant_not_found");
  const settings = current.storeSettings && typeof current.storeSettings === "object" && !Array.isArray(current.storeSettings)
    ? current.storeSettings as Record<string, unknown> : {};
  const pending = settings.registration_pending === true || settings.oauth_registration_pending === true;
  if (!Object.hasOwn(incoming, "business_mode")) {
    if (!current.businessModeSelectedAt && pending) throw new BadRequestException("business_mode_required");
    return;
  }
  let mode;
  try { mode = parseBusinessMode(incoming.business_mode); }
  catch (error) { if (error instanceof ServiceBusinessPolicyError) throw new BadRequestException(error.code); throw error; }
  if (current.businessModeSelectedAt) {
    if (current.businessMode !== mode) throw new ConflictException("business_mode_change_requires_command");
    return;
  }
  if (!pending || current.businessModeNeedsReview) throw new ConflictException("business_mode_selection_not_pending");
  const facts = {
    activeProductOffers: await tx.product.count({ where: { merchantId, isActive: true, type: { in: ["physical", "digital"] } } }),
    activeServiceOffers: await tx.product.count({ where: { merchantId, isActive: true, type: "service" } }),
    ongoingAppointments: await tx.serviceAppointment.count({ where: { merchantId, operationalStatus: { in: ["pending", "scheduled", "in_service"] } } }),
  };
  try { assertCompatibleBusinessModeChange(mode, facts); }
  catch (error) { if (error instanceof ServiceBusinessPolicyError) throw new ConflictException(error.code); throw error; }
  if (current.businessMode !== mode && await tx.paymentIntent.count({ where: { merchantId, status: { in: ["pending", "requires_action"] } } }))
    throw new ConflictException("business_mode_financial_attempt_pending");
  const selected = await tx.merchant.updateMany({ where: {
    id: merchantId, businessModeSelectedAt: null, businessModeNeedsReview: false,
    OR: [{ storeSettings: { path: ["registration_pending"], equals: true } },
      { storeSettings: { path: ["oauth_registration_pending"], equals: true } }],
  }, data: { businessMode: mode, businessModeSelectedAt: new Date() } });
  if (selected.count !== 1) throw new ConflictException("business_mode_selection_conflict");
}
