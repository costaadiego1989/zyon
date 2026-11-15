import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ServiceProfessionalInput } from "./service-professional-input.js";
import { serviceScheduleError, serviceScheduleFromMetadata, type ServiceScheduleConfig } from "./service-schedule.js";

export interface ProfessionalServiceFacts {
  merchantId: string;
  professional: { id: string; merchantId: string; isActive: boolean; isPublished: boolean; timeZone: string; version: number };
  link: { id: string; merchantId: string; professionalId: string; productId: string; isActive: boolean };
  product: { id: string; merchantId: string; type: string; isActive: boolean; deletedAt: Date | null; metadata: unknown; categoryId: string | null };
  category: { id: string; merchantId: string; isActive: boolean } | null;
  variant: { id: string; productId: string; isActive: boolean; price: { basePriceInCents: number; currency: string } | null };
}

export function resolveProfessionalServiceLink(facts: ProfessionalServiceFacts) {
  const { merchantId, professional, link, product, category, variant } = facts;
  if (professional.merchantId !== merchantId || link.merchantId !== merchantId || product.merchantId !== merchantId
    || link.professionalId !== professional.id || link.productId !== product.id || variant.productId !== product.id
    || (product.categoryId && (!category || category.id !== product.categoryId || category.merchantId !== merchantId))) throw new NotFoundException("professional_service_not_found");
  if (!professional.isActive || !professional.isPublished || !link.isActive || !product.isActive || product.deletedAt || product.type !== "service"
    || !variant.isActive || (category && !category.isActive)) throw new NotFoundException("professional_service_not_available");
  const schedule = serviceScheduleFromMetadata(product.metadata);
  if (!schedule || serviceScheduleError(schedule)) throw new BadRequestException("service_duration_not_configured");
  if (!variant.price || !Number.isSafeInteger(variant.price.basePriceInCents) || variant.price.basePriceInCents <= 0 || !/^[A-Z]{3}$/.test(variant.price.currency)) throw new BadRequestException("service_price_not_configured");
  return { merchantId, professionalId: professional.id, professionalVersion: professional.version, professionalServiceId: link.id,
    productId: product.id, variantId: variant.id, categoryId: product.categoryId, durationMinutes: (schedule as ServiceScheduleConfig).durationMinutes,
    timeZone: professional.timeZone, priceInCents: variant.price.basePriceInCents, currency: variant.price.currency };
}

export function publicProfessionalProfile(raw: unknown): NonNullable<ServiceProfessionalInput["publicProfile"]> {
  const result: NonNullable<ServiceProfessionalInput["publicProfile"]> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  const profile = raw as Record<string, unknown>;
  if (typeof profile.description === "string" && profile.description.length <= 1200) result.description = profile.description;
  if (Array.isArray(profile.specialties) && profile.specialties.length <= 20
    && profile.specialties.every(value => typeof value === "string" && value.trim().length > 0 && value.length <= 100))
    result.specialties = profile.specialties.filter((value): value is string => typeof value === "string");
  return result;
}

export async function readProfessionalServiceLink(tx: Pick<Prisma.TransactionClient, "professionalService">, input: { merchantId: string; professionalId: string; productId: string; variantId: string }) {
  const row = await tx.professionalService.findFirst({ where: { merchantId: input.merchantId, professionalId: input.professionalId, productId: input.productId }, include: {
    professional: true, product: { include: { category: true, variants: { where: { id: input.variantId }, include: { price: true }, take: 1 } } },
  } });
  const variant = row?.product.variants[0];
  if (!row || !variant) throw new NotFoundException("professional_service_not_found");
  return resolveProfessionalServiceLink({ merchantId: input.merchantId, professional: row.professional, link: row, product: row.product, category: row.product.category, variant });
}
