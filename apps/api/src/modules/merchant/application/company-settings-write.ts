import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

import type { BusinessMode } from "../domain/service-business-policy.js";

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function normalizeCompanyServiceNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new BadRequestException("invalid_company_service_names");
  const names: string[] = [], seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") throw new BadRequestException("invalid_company_service_name");
    const name = item.trim();
    if (!name || name.length > 160) throw new BadRequestException("invalid_company_service_name");
    const key = name.normalize("NFKC").toLocaleLowerCase("pt-BR");
    if (seen.has(key)) throw new BadRequestException("duplicate_company_service_name");
    seen.add(key); names.push(name);
  }
  return names;
}

/** Invalid historical values never become public source content. */
export function readPublicCompanyServiceNames(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  try { return normalizeCompanyServiceNames(value); }
  catch (error) { if (error instanceof BadRequestException) return undefined; throw error; }
}

/** Caller supplies the canonical mode while holding the merchant row lock. */
export function assertCompanyServiceNamesMode(patch: Record<string, unknown>, businessMode: BusinessMode) {
  if (object(patch.company) && Object.hasOwn(patch.company, "serviceNames") && patch.company.serviceNames !== undefined && businessMode !== "services")
    throw new ForbiddenException("company_service_names_requires_services");
}

export function normalizeCompanySettingsPatch(value: unknown): Record<string, unknown> {
  if (!object(value)) throw new BadRequestException("invalid_store_settings");
  if (value.company === undefined) return { ...value };
  if (!object(value.company)) throw new BadRequestException("invalid_company_settings");
  const company = { ...value.company };
  if (Object.hasOwn(company, "description")) {
    if (company.description !== undefined && (typeof company.description !== "string" || company.description.length > 1200))
      throw new BadRequestException("invalid_company_description");
    if (typeof company.description === "string") company.description = company.description.trim();
    else delete company.description;
  }
  if (Object.hasOwn(company, "serviceNames")) {
    if (company.serviceNames === undefined) delete company.serviceNames;
    else company.serviceNames = normalizeCompanyServiceNames(company.serviceNames);
  }
  return { ...value, company };
}

/** Merge the stored canonical document, never an administrative fallback. */
export function mergeCompanySettingsPatch(current: unknown, incoming: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...(object(current) ? current : {}) };
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "business_mode" || value === undefined) continue;
    const next = object(value) && object(merged[key]) ? mergeCompanySettingsPatch(merged[key], value) : value;
    Object.defineProperty(merged, key, { value: next, enumerable: true, configurable: true, writable: true });
  }
  return merged;
}

export function publicCompanySnapshot(settings: unknown, businessMode: BusinessMode) {
  const company = object(settings) && object(settings.company) ? settings.company : {};
  const published: Record<string, unknown> = {};
  for (const field of ["description", "razaoSocial", "cnpj", "inscricaoEstadual", "email", "phone"]) {
    if (typeof company[field] === "string" && company[field].trim()) published[field] = company[field].trim();
  }
  const names = businessMode === "services" ? readPublicCompanyServiceNames(company.serviceNames) : undefined;
  if (names?.length) published.serviceNames = names;
  if (object(company.address)) {
    const address: Record<string, string> = {};
    for (const field of ["street", "number", "complement", "neighborhood", "city", "state", "zip"]) {
      if (typeof company.address[field] === "string" && company.address[field].trim()) address[field] = company.address[field].trim();
    }
    if (Object.keys(address).length) published.address = address;
  }
  return published;
}

export async function enqueueCompanySettingsWork(
  tx: Pick<Prisma.TransactionClient, "publicSourceWork" | "knowledgeChunk">,
  merchantId: string, before: unknown, after: unknown, beforeMode: BusinessMode, afterMode: BusinessMode = beforeMode,
) {
  const published = publicCompanySnapshot(after, afterMode), content = JSON.stringify(published);
  if (JSON.stringify(publicCompanySnapshot(before, beforeMode)) === content) return;
  const sourceHash = createHash("sha256").update(content).digest("hex");
  await tx.publicSourceWork.create({ data: {
    merchantId, sourceType: "company", sourceId: merchantId, sourceVersion: randomUUID(), sourceHash,
    publicationState: Object.keys(published).length ? "published" : "withdrawn",
  } });
  await tx.knowledgeChunk.deleteMany({ where: { merchantId, sourceType: "company", sourceId: merchantId } });
}
