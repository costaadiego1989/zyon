import { createHash } from "node:crypto";

export type PublicBusinessSourceType = "company" | "business_hours" | "professional" | "service" | "faq" | "policy";
export type PublicSourcePublication = "draft" | "published" | "withdrawn";
interface PublicSourceIdentity {
  merchantId: string;
  sourceId: string;
  sourceVersion: string;
  publicationState: PublicSourcePublication;
}
export type PublicBusinessSourceInput = PublicSourceIdentity & (
  | { sourceType: "company"; row: { name: string; storeCategory?: string | null; storeSettings?: unknown; businessMode?: "products" | "services" } }
  | { sourceType: "business_hours"; row: { storeSettings?: unknown } }
  | { sourceType: "professional"; row: { publicName: string; publicProfile?: unknown; timeZone: string; isActive: boolean; isPublished: boolean } }
  | { sourceType: "service"; row: { name: string; description?: string | null; type: string; isActive: boolean; deletedAt?: Date | null; metadata?: unknown;
    category?: { merchantId: string; id: string; name: string; isActive: boolean } | null;
    professionals?: Array<{ merchantId: string; professionalId: string; publicName: string; isActive: boolean; isPublished: boolean; linkIsActive: boolean }> } }
  | { sourceType: "faq"; row: { question: string; answer: string } }
  | { sourceType: "policy"; row: { title: string; content: string } }
);
type PublicValue = string | number | boolean | PublicValue[] | { [key: string]: PublicValue };
type PublicData = Record<string, PublicValue>;
export interface PublicBusinessSourceProjection extends PublicSourceIdentity {
  sourceType: PublicBusinessSourceType;
  sourceHash: string;
  publicData: PublicData;
  text: string;
}

export function withdrawnPublicBusinessSource(merchantId: string, sourceType: PublicBusinessSourceType,
  sourceId: string, sourceVersion: string): PublicBusinessSourceProjection {
  if ([merchantId, sourceId, sourceVersion].some(value => typeof value !== "string" || !value.trim())
    || !(sourceTypes as readonly string[]).includes(sourceType)) invalid();
  const identity = { merchantId, sourceType, sourceId, publicationState: "withdrawn" as const };
  const sourceHash = createHash("sha256").update(JSON.stringify(stable({ ...identity, publicData: {} }))).digest("hex");
  return { ...identity, sourceVersion, sourceHash, publicData: {}, text: "" };
}

const sourceTypes = ["company", "business_hours", "professional", "service", "faq", "policy"] as const;
function invalid(): never { throw new Error("public_source_invalid"); }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, required = false): string {
  if (value === undefined || value === null) return required ? invalid() : "";
  if (typeof value !== "string") return invalid();
  const result = value.trim();
  if (required && !result) return invalid();
  return result;
}
function copyText(target: PublicData, key: string, value: unknown) {
  const content = text(value);
  if (content) target[key] = content;
}
function stable(value: PublicValue): PublicValue {
  if (Array.isArray(value)) return value.map(stable);
  return value && typeof value === "object" ? Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, stable(item)])) : value;
}

/** Only canonical stored company fields belong here. An administrative profile
 * with owner-email fallback is a different input and must not be substituted. */
function companyData(row: Extract<PublicBusinessSourceInput, { sourceType: "company" }>["row"]): PublicData {
  const company = record(record(row.storeSettings).company);
  const data: PublicData = { name: text(row.name, true) };
  copyText(data, "storeCategory", row.storeCategory);
  for (const field of ["description", "razaoSocial", "cnpj", "inscricaoEstadual", "email", "phone"] as const)
    copyText(data, field, company[field]);
  if (row.businessMode === "services" && company.serviceNames !== undefined) {
    if (!Array.isArray(company.serviceNames) || company.serviceNames.length > 100) invalid();
    const names = company.serviceNames.map(value => {
      const name = text(value, true);
      if (name.length > 160) invalid();
      return name;
    });
    if (names.length) data.serviceNames = names;
  }
  const address = record(company.address), publicAddress: PublicData = {};
  for (const field of ["street", "number", "complement", "neighborhood", "city", "state", "zip"] as const)
    copyText(publicAddress, field, address[field]);
  if (Object.keys(publicAddress).length) data.address = publicAddress;
  return data;
}

function hoursData(row: Extract<PublicBusinessSourceInput, { sourceType: "business_hours" }>["row"]): PublicData {
  const hours = record(row.storeSettings).businessHours;
  if (hours === undefined) return { hours: [] };
  if (!Array.isArray(hours)) invalid();
  const result = hours.map((value): PublicData => {
    const hour = record(value), day = text(hour.day, true);
    if (typeof hour.closed !== "boolean") invalid();
    if (hour.closed) return { day, closed: true };
    const startTime = text(hour.startTime, true), endTime = text(hour.endTime, true);
    if (![startTime, endTime].every(time => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))) invalid();
    return { day, startTime, endTime, closed: false };
  });
  return { hours: result };
}

function professionalData(row: Extract<PublicBusinessSourceInput, { sourceType: "professional" }>["row"]): PublicData {
  const data: PublicData = { name: text(row.publicName, true) }, profile = record(row.publicProfile);
  copyText(data, "description", profile.description);
  if (profile.specialties !== undefined) {
    if (!Array.isArray(profile.specialties)) invalid();
    data.specialties = [...new Set(profile.specialties.map(value => text(value, true)))].sort();
  }
  data.timeZone = text(row.timeZone, true);
  return data;
}

function serviceData(merchantId: string, row: Extract<PublicBusinessSourceInput, { sourceType: "service" }>["row"]): PublicData {
  if (row.type !== "service") invalid();
  const data: PublicData = { name: text(row.name, true) }, metadata = record(row.metadata);
  copyText(data, "description", row.description);
  copyText(data, "serviceType", metadata.serviceType);
  const duration = record(metadata.serviceSchedule).durationMinutes;
  if (duration !== undefined) {
    if (typeof duration !== "number" || !Number.isSafeInteger(duration) || duration < 1) invalid();
    data.durationMinutes = duration;
  }
  if (row.category) {
    if (row.category.merchantId !== merchantId) throw new Error("public_source_foreign_tenant");
    if (row.category.isActive) data.category = { id: text(row.category.id, true), name: text(row.category.name, true) };
  }
  if (row.professionals) {
    const published = new Map<string, PublicData>();
    for (const professional of row.professionals) {
      if (professional.merchantId !== merchantId) throw new Error("public_source_foreign_tenant");
      if (professional.isActive && professional.isPublished && professional.linkIsActive)
        published.set(text(professional.professionalId, true), { id: professional.professionalId, name: text(professional.publicName, true) });
    }
    data.professionals = [...published.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, value]) => value);
  }
  return data;
}

function content(sourceType: PublicBusinessSourceType, data: PublicData): string {
  if (sourceType === "company") {
    const address = data.address && typeof data.address === "object" && !Array.isArray(data.address) ? Object.values(data.address).join(", ") : "";
    const services = Array.isArray(data.serviceNames) ? data.serviceNames.join("; ") : "";
    return [["Empresa", data.name], ["Ramo", data.storeCategory], ["Sobre", data.description], ["Serviços oferecidos", services], ["Razão social", data.razaoSocial],
      ["CNPJ", data.cnpj], ["Inscrição estadual", data.inscricaoEstadual], ["E-mail comercial", data.email], ["Telefone comercial", data.phone], ["Endereço comercial", address]]
      .filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join("\n");
  }
  if (sourceType === "business_hours") return (data.hours as PublicData[]).map(hour => hour.closed
    ? `${hour.day}: fechado` : `${hour.day}: ${hour.startTime}–${hour.endTime}`).join("\n");
  if (sourceType === "professional") return [["Profissional", data.name], ["Apresentação", data.description],
    ["Áreas de atuação", Array.isArray(data.specialties) ? data.specialties.join(", ") : ""], ["Fuso", data.timeZone]]
    .filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join("\n");
  if (sourceType === "service") {
    const category = data.category && typeof data.category === "object" && !Array.isArray(data.category) ? data.category.name : "";
    const professionals = Array.isArray(data.professionals) ? (data.professionals as PublicData[]).map(value => value.name).join(", ") : "";
    return [["Serviço", data.name], ["Descrição", data.description], ["Modalidade", data.serviceType], ["Categoria", category],
      ["Profissionais publicados", professionals], ["Duração em minutos", data.durationMinutes]]
      .filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join("\n");
  }
  if (sourceType === "faq") return `P: ${data.question}\nR: ${data.answer}`;
  return `${data.title}: ${data.content}`;
}

/** Pure public projection; this function never grants operational authority,
 * embeds vectors, writes data or resolves live price/availability. */
export function projectPublicBusinessSource(merchantId: string, input: PublicBusinessSourceInput): PublicBusinessSourceProjection {
  if (!input || input.merchantId !== merchantId) throw new Error("public_source_foreign_tenant");
  if ([merchantId, input.sourceId, input.sourceVersion].some(value => typeof value !== "string" || !value.trim())
    || !(sourceTypes as readonly string[]).includes(input.sourceType)
    || !["draft", "published", "withdrawn"].includes(input.publicationState)) invalid();
  let publicationState = input.publicationState;
  if (publicationState === "published" && (input.sourceType === "professional" && (!input.row.isActive || !input.row.isPublished)
    || input.sourceType === "service" && (!input.row.isActive || input.row.deletedAt))) publicationState = "withdrawn";
  let publicData: PublicData = {};
  if (publicationState === "published") {
    switch (input.sourceType) {
      case "company": publicData = companyData(input.row); break;
      case "business_hours": publicData = hoursData(input.row); break;
      case "professional": publicData = professionalData(input.row); break;
      case "service": publicData = serviceData(merchantId, input.row); break;
      case "faq": publicData = { question: text(input.row.question, true), answer: text(input.row.answer, true) }; break;
      case "policy": publicData = { title: text(input.row.title, true), content: text(input.row.content, true) }; break;
    }
  }
  const identity = { merchantId, sourceType: input.sourceType, sourceId: input.sourceId, publicationState };
  const sourceHash = createHash("sha256").update(JSON.stringify(stable({ ...identity, publicData }))).digest("hex");
  return { ...identity, sourceVersion: input.sourceVersion, sourceHash, publicData,
    text: publicationState === "published" ? content(input.sourceType, publicData) : "" };
}
