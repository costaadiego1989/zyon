import { BadRequestException } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { lockCatalogMerchant } from "../../../shared/persistence/catalog-stock-ledger.js";
import { decryptPii, isPiiEncrypted } from "../../../shared/crypto/pii-cipher.service.js";
import { brazilianPhoneForms } from "../../whatsapp-channel/application/services/whatsapp-checkout-identity.service.js";
import { readCancellationPoliciesWithin } from "../../operations/application/cancel-service-appointment.use-case.js";
import { serviceAppointmentChangeIntent, serviceAppointmentReference, type ServiceAppointmentChangeIntent } from "../domain/service-appointment-change-intent.js";

export class ServiceAppointmentChangePrompt extends Error {
  constructor(readonly reply: string, readonly notService = false) { super("service_appointment_change_choice_required"); }
}
export interface BuyerAppointmentChangeContext {
  action: ServiceAppointmentChangeIntent;
  appointment: { id: string; professionalId: string; productId: string; variantId: string; serviceName: string; professionalName: string;
    startsAt: string; endsAt: string; timeZone: string; durationMinutes: number; priceInCents: number; currency: string; operationalStatus: string; version: number; policyVersion: number };
  policyHash: string;
  policies: Awaited<ReturnType<typeof readCancellationPoliciesWithin>>["policies"];
}
const missing = "🤖 *Identifique o agendamento*\n\nNão consegui identificar esse agendamento na sua conta. Confira a referência em Meus Dados ou fale com a equipe. Nenhuma alteração foi feita.";
const date = (value: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(value);

/** Canonical modality must precede service-only owner checks or prompts. */
export async function assertServiceAppointmentChangeModeWithin(tx: Prisma.TransactionClient, merchantId: string) {
  await lockCatalogMerchant(tx, merchantId);
  const merchant = await tx.merchant.findUnique({ where: { id: merchantId }, select: { businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true } });
  if (!merchant || merchant.businessMode !== "services" || !merchant.businessModeSelectedAt || merchant.businessModeNeedsReview)
    throw new ServiceAppointmentChangePrompt("", true);
}

/** Real leased channel caller only. Keep merchant before account SHARE; do
 * not replace encrypted stored PII with an input phone or an external reader. */
export async function assertWhatsAppAppointmentChangeOwnerWithin(tx: Prisma.TransactionClient, input: { merchantId: string; buyerId?: string; phone: string }) {
  if (!input.buyerId) throw new NotFoundException("whatsapp_handoff_buyer_not_found");
  await lockCatalogMerchant(tx, input.merchantId);
  await tx.$queryRaw(Prisma.sql`SELECT global_user_id FROM buyer_accounts WHERE global_user_id = ${input.buyerId} FOR SHARE`);
  const account = await tx.buyerAccount.findUnique({ where: { globalUserId: input.buyerId }, select: { phone: true } });
  let phone: string | undefined;
  try { phone = account?.phone ? isPiiEncrypted(account.phone) ? decryptPii(account.phone) : account.phone : undefined; } catch { /* Unreadable PII supplies no owner. */ }
  if (!phone || !brazilianPhoneForms(phone).includes(input.phone.replace(/\D/g, ""))) throw new NotFoundException("whatsapp_handoff_buyer_not_found");
}

/** Call only inside the existing authenticated channel/intake transaction.
 * There is no model/HTTP reader for this function. Every target query fixes
 * both merchant and actual verified buyer. No operational/financial writer. */
export async function readBuyerAppointmentChangeWithin(tx: Prisma.TransactionClient, input: { merchantId: string; buyerId?: string; message: string }): Promise<BuyerAppointmentChangeContext | undefined> {
  const action = serviceAppointmentChangeIntent(input.message);
  if (!action) throw new BadRequestException("service_appointment_change_request_required");
  await assertServiceAppointmentChangeModeWithin(tx, input.merchantId);
  const account = input.buyerId ? await tx.buyerAccount.findUnique({ where: { globalUserId: input.buyerId }, select: { globalUserId: true } }) : null;
  if (!account) throw new ServiceAppointmentChangePrompt("🤖 *Acesse seus agendamentos*\n\nPara identificar um agendamento com segurança, entre na sua conta em Meus Dados. Depois me diga qual atendimento deseja alterar.");
  const reference = serviceAppointmentReference(input.message);
  if (reference === null) throw new ServiceAppointmentChangePrompt("🤖 *Escolha um agendamento*\n\nEnvie apenas uma referência por solicitação. Nenhuma alteração foi feita.");
  const appointments = await tx.serviceAppointment.findMany({ where: { merchantId: input.merchantId, buyerGlobalUserId: account.globalUserId, ...(reference ? { id: reference } : {}) },
    select: { id: true, professionalId: true, productId: true, variantId: true, startsAt: true, endsAt: true, timeZone: true, durationMinutes: true,
      priceInCents: true, currency: true, operationalStatus: true, version: true, policyVersion: true, product: { select: { name: true } }, professional: { select: { publicName: true } } },
    orderBy: [{ startsAt: "desc" }, { id: "asc" }], take: 6 });
  if (!appointments.length) throw new ServiceAppointmentChangePrompt(missing);
  if (appointments.length !== 1) {
    const verb = action === "cancel" ? "cancelar" : "remarcar";
    const lines = appointments.slice(0, 5).map(row => `• ${row.product.name.replace(/\s+/g, " ").slice(0, 100)} — ${date(row.startsAt)} (Brasília)\n  #${row.id}`);
    throw new ServiceAppointmentChangePrompt(`🤖 *Qual agendamento você quer ${verb}?*\n\n${lines.join("\n\n")}\n\n${appointments.length > 5 ? "Há outros agendamentos na sua conta. Consulte a referência em Meus Dados.\n\n" : ""}Responda: Quero ${verb} o agendamento #referência\n\nNenhuma alteração foi feita.`);
  }
  const row = appointments[0]!, policy = await readCancellationPoliciesWithin(tx, input.merchantId);
  return { action, appointment: { id: row.id, professionalId: row.professionalId, productId: row.productId, variantId: row.variantId,
    serviceName: row.product.name, professionalName: row.professional.publicName, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(),
    timeZone: row.timeZone, durationMinutes: row.durationMinutes, priceInCents: row.priceInCents, currency: row.currency,
    operationalStatus: row.operationalStatus, version: row.version, policyVersion: row.policyVersion }, policyHash: policy.hash, policies: policy.policies };
}

export function serviceAppointmentChangeMetadata(value: BuyerAppointmentChangeContext) {
  // policyVersion is exclusively the immutable booked ServiceBusinessPolicy
  // version required by T33. policyHash/sourceVersion/sourceHash describe the
  // separate CURRENT public policy view; neither can replace booked terms.
  return { action: value.action, appointmentId: value.appointment.id, appointmentVersion: value.appointment.version,
    policyVersion: value.appointment.policyVersion, policyHash: value.policyHash,
    publishedPolicies: value.policies.filter(policy => policy.publicationState === "published").map(policy => ({ sourceId: policy.sourceId, sourceVersion: policy.sourceVersion, sourceHash: policy.sourceHash })) };
}
export function serviceAppointmentChangeOperatorText(value: BuyerAppointmentChangeContext): string {
  const action = value.action === "cancel" ? "cancelamento" : "remarcação", row = value.appointment;
  const published = value.policies.filter(policy => policy.publicationState === "published" && policy.text);
  return `📅 Solicitação de ${action}\n\nAgendamento: #${row.id}\nServiço: ${row.serviceName}\nProfissional: ${row.professionalName}\nHorário: ${date(new Date(row.startsAt))} (Brasília)\nEstado registrado: ${row.operationalStatus}\n\n${published.length
    ? "Políticas publicadas da empresa:\n\n" + published.map(policy => `${policy.sourceId}:\n${policy.text}`).join("\n\n")
    : "Nenhuma política publicada foi encontrada. A equipe precisa orientar o comprador sem presumir condições."}\n\nEsta é uma solicitação para análise humana. O agendamento e seus valores não foram alterados.`;
}
export const SERVICE_APPOINTMENT_CHANGE_ACK = "🤝 *Solicitação encaminhada*\n\nA equipe recebeu seu pedido e vai analisar o agendamento e as políticas da empresa. Você receberá a resposta por aqui.\n\n*Esta solicitação não altera nem cancela o agendamento automaticamente e não realiza reembolso.*";
