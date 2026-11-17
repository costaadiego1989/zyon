import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { validateAvailabilityWindow } from "../../../catalog/domain/services/professional-availability.js";
import type { PrismaCurrentServiceFactsReader } from "../../infrastructure/prisma-current-service-facts-reader.js";
import type { LiveBusinessSnapshot, PublicBusinessAnswerSession } from "./public-business-answer-session.js";

const id = z.string().trim().min(1).max(191).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const requestSchema = z.strictObject({ productId: id, professionalId: id, variantId: id.optional(),
  fromDate: z.string().length(10), toDate: z.string().length(10) });
export type BusinessLiveRequest = z.infer<typeof requestSchema>;
export type BusinessLiveAttachment = { status: "attached" }
  | { status: "clarification"; reason: "invalid_request" | "variant_required" | "service_unavailable" | "pair_not_admitted" }
  | { status: "unavailable"; reason: "canonical_unavailable" };

/** Registers a read for the final answer boundary. Never reserves or charges. */
export class PublicBusinessLiveTools {
  constructor(private readonly prisma: Pick<PrismaClient, "$transaction">,
    private readonly tenant: Pick<TenantContextService, "get">,
    private readonly live: Pick<PrismaCurrentServiceFactsReader, "read">,
    private readonly clock: () => Date = () => new Date()) {}

  async attach(session: PublicBusinessAnswerSession, input: { merchantId: string; request: unknown }): Promise<BusinessLiveAttachment> {
    if (!input.merchantId || this.tenant.get()?.merchantId !== input.merchantId) throw Error("business_live_scope_mismatch");
    const parsed = requestSchema.safeParse(input.request);
    if (!parsed.success) return { status: "clarification", reason: "invalid_request" };
    const request = parsed.data, merchantId = input.merchantId;
    try { validateAvailabilityWindow({ fromDate: request.fromDate, toDate: request.toDate, now: this.clock() }); }
    catch { return { status: "clarification", reason: "invalid_request" }; }
    try {
      const variants = await this.prisma.$transaction(async tx => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM merchants WHERE id=${merchantId} FOR SHARE`);
        if (locked.length !== 1 || locked[0]!.id !== merchantId) throw Error("business_live_company_unavailable");
        const product = await tx.product.findFirst({ where: { id: request.productId, merchantId, type: "service", isActive: true, deletedAt: null },
          select: { variants: { where: { isActive: true, ...(request.variantId ? { id: request.variantId } : {}) }, select: { id: true }, take: 2 } } });
        return product?.variants ?? [];
      });
      if (this.tenant.get()?.merchantId !== merchantId) throw Error("business_live_scope_mismatch");
      if (!variants.length) return { status: "clarification", reason: "service_unavailable" };
      if (variants.length !== 1) return { status: "clarification", reason: "variant_required" };
      const pair = await session.captureCanonical({ merchantId, mode: "service_professional", limit: 2,
        pairs: [{ serviceId: request.productId, professionalId: request.professionalId }] });
      if (pair.status !== "ready") return { status: "clarification", reason: "pair_not_admitted" };
      session.attachLive({ ...request, variantId: variants[0]!.id }, choice => this.live.read(choice, { merchantId }));
      return { status: "attached" };
    } catch { return { status: "unavailable", reason: "canonical_unavailable" }; }
  }
}

const label = (value: string | undefined, fallback: string) => (value?.replace(/[\r\n*_`~]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)) || fallback;
/** Only machine facts enter this formatter. Generated live text is discarded. */
export function renderPublicBusinessLiveFacts(current: readonly LiveBusinessSnapshot[], options: { format?: "plain" | "whatsapp" } = {}): { message: string } {
  if (!current.length || current.length > 10) throw Error("business_live_facts_invalid");
  const sections = current.map(value => {
    const { facts, availability } = value;
    if (!Number.isSafeInteger(facts.priceInCents) || facts.priceInCents <= 0 || !/^[A-Z]{3}$/.test(facts.currency)
      || !["ready", "empty"].includes(availability.status) || !Array.isArray(availability.slots)
      || availability.status === "empty" && availability.slots.length) throw Error("business_live_facts_invalid");
    const name = label(value.publicLabels?.serviceName, "Serviço selecionado");
    const price = new Intl.NumberFormat("pt-BR", { style: "currency", currency: facts.currency }).format(facts.priceInCents / 100);
    const lines = [options.format === "whatsapp" ? `*${name}*` : name];
    if (value.publicLabels?.professionalName) lines.push("Profissional: " + label(value.publicLabels.professionalName, ""));
    lines.push("Valor do serviço: " + price);
    if (!availability.slots.length) lines.push("Não há horários livres no período consultado.");
    else {
      lines.push("Horários disponíveis nesta consulta (" + facts.timeZone + "):");
      for (const [index, slot] of availability.slots.entries()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot.startTime)
          || !Number.isFinite(Date.parse(slot.startsAt)) || !Number.isFinite(Date.parse(slot.endsAt))
          || Date.parse(slot.endsAt) <= Date.parse(slot.startsAt)) throw Error("business_live_facts_invalid");
        if (index < 12) lines.push("- " + slot.date.split("-").reverse().join("/") + " às " + slot.startTime);
      }
      if (availability.slots.length > 12) lines.push("Há outros horários neste período. Posso consultar uma data específica?");
      lines.push("Os horários podem mudar até a confirmação do agendamento.");
    }
    return lines.join("\n");
  });
  return { message: sections.join("\n\n") };
}
