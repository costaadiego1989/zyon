import { BadRequestException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

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

function publicCompanySnapshot(settings: unknown) {
  const company = object(settings) && object(settings.company) ? settings.company : {};
  const published: Record<string, unknown> = {};
  for (const field of ["description", "razaoSocial", "cnpj", "inscricaoEstadual", "email", "phone"]) {
    if (typeof company[field] === "string" && company[field].trim()) published[field] = company[field].trim();
  }
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
  merchantId: string, before: unknown, after: unknown,
) {
  const published = publicCompanySnapshot(after), content = JSON.stringify(published);
  if (JSON.stringify(publicCompanySnapshot(before)) === content) return;
  const sourceHash = createHash("sha256").update(content).digest("hex");
  await tx.publicSourceWork.create({ data: {
    merchantId, sourceType: "company", sourceId: merchantId, sourceVersion: randomUUID(), sourceHash,
    publicationState: Object.keys(published).length ? "published" : "withdrawn",
  } });
  await tx.knowledgeChunk.deleteMany({ where: { merchantId, sourceType: "company", sourceId: merchantId } });
}
