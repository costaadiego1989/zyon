import { BadRequestException } from "@nestjs/common";

export interface ServiceProfessionalInput {
  publicName: string;
  publicProfile?: { description?: string; specialties?: string[] };
  timeZone: string;
  isPublished?: boolean;
  isActive?: boolean;
  productIds?: string[];
}

export function assertServiceTimeZone(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length > 80 || !value.trim()) throw new BadRequestException("invalid_service_timezone");
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); }
  catch { throw new BadRequestException("invalid_service_timezone"); }
}

export function validateProfessionalInput(raw: unknown): ServiceProfessionalInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException("invalid_professional");
  const input = raw as ServiceProfessionalInput;
  const allowed = ["publicName", "publicProfile", "timeZone", "isPublished", "isActive", "productIds"];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new BadRequestException("invalid_professional_field");
  if (typeof input.publicName !== "string" || !input.publicName.trim() || input.publicName.trim().length > 120) throw new BadRequestException("professional_name_required");
  assertServiceTimeZone(input.timeZone);
  for (const field of ["isPublished", "isActive"] as const) if (input[field] !== undefined && typeof input[field] !== "boolean") throw new BadRequestException("invalid_professional_flag");
  const profile = input.publicProfile ?? {};
  if (!profile || typeof profile !== "object" || Array.isArray(profile) || Object.keys(profile).some(key => !["description", "specialties"].includes(key))
    || (profile.description !== undefined && (typeof profile.description !== "string" || profile.description.length > 1200))
    || (profile.specialties !== undefined && (!Array.isArray(profile.specialties) || profile.specialties.length > 20 || profile.specialties.some(value => typeof value !== "string" || !value.trim() || value.length > 100))))
    throw new BadRequestException("invalid_professional_profile");
  if (input.productIds !== undefined && (!Array.isArray(input.productIds) || input.productIds.length > 100 || input.productIds.some(id => typeof id !== "string" || !id.trim() || id.length > 191) || new Set(input.productIds).size !== input.productIds.length))
    throw new BadRequestException("invalid_professional_services");
  return { ...input, publicName: input.publicName.trim(), publicProfile: { ...profile }, productIds: input.productIds ? [...input.productIds] : undefined };
}

export function assertExpectedVersion(version: unknown): asserts version is number {
  if (!Number.isSafeInteger(version) || (version as number) < 1 || (version as number) >= 2_147_483_647) throw new BadRequestException("expected_version_required");
}
