import type { ServiceProfessionalDTO, ServiceProfessionalInput, ServiceProfessionalProfile } from "../../../api/endpoints/service-attendance.js";

export interface ProfessionalDraft {
  original: ServiceProfessionalDTO | null;
  publicName: string;
  description: string;
  specialtiesText: string;
  timeZone: string;
  isActive: boolean;
  isPublished: boolean;
  productIds: string[];
}
function originalProfile(original: ServiceProfessionalDTO | null): ServiceProfessionalProfile {
  if (!original) return {};
  const value = original.publicProfile;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("invalid_professional_public_profile");
  const profile = value as Record<string, unknown>;
  if (Object.keys(profile).some(key => !["description", "specialties"].includes(key))
    || profile.description !== undefined && (typeof profile.description !== "string" || profile.description.length > 1200)
    || profile.specialties !== undefined && (!Array.isArray(profile.specialties) || profile.specialties.length > 20 || profile.specialties.some(item => typeof item !== "string" || !item.trim() || item.length > 100)))
    throw new TypeError("invalid_professional_public_profile");
  return profile as ServiceProfessionalProfile;
}
export function createProfessionalDraft(original: ServiceProfessionalDTO | null = null): ProfessionalDraft {
  const profile = originalProfile(original);
  return { original, publicName: original?.publicName ?? "", description: profile.description ?? "", specialtiesText: profile.specialties?.join("\n") ?? "",
    timeZone: original?.timeZone ?? "", isActive: original?.isActive ?? true, isPublished: original?.isPublished ?? false,
    productIds: original?.services.map(link => link.productId) ?? [] };
}
function draftProfile(draft: ProfessionalDraft): Required<ServiceProfessionalProfile> {
  const before = originalProfile(draft.original);
  const specialties = draft.specialtiesText === (before.specialties?.join("\n") ?? "") ? before.specialties ?? []
    : draft.specialtiesText.split("\n").map(item => item.trim()).filter(Boolean);
  return { description: draft.description, specialties };
}
export function professionalFormError(draft: ProfessionalDraft): string | null {
  if (!draft.publicName.trim()) return "Informe o nome público do profissional.";
  if (draft.publicName.trim().length > 120) return "O nome público deve ter até 120 caracteres.";
  if (!draft.timeZone.trim() || draft.timeZone.length > 80) return "Informe um fuso horário IANA válido.";
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: draft.timeZone }).format(); }
  catch { return "Informe um fuso horário IANA válido."; }
  if (draft.description.length > 1200) return "A apresentação deve ter até 1.200 caracteres.";
  const profile = draftProfile(draft);
  if (profile.specialties.length > 20 || profile.specialties.some(item => item.length > 100)) return "Informe até 20 especialidades, com até 100 caracteres cada.";
  if (draft.productIds.length > 100 || new Set(draft.productIds).size !== draft.productIds.length || draft.productIds.some(id => typeof id !== "string" || !id.trim() || id.length > 191))
    return "Confira os serviços vinculados ao profissional.";
  if (draft.original && (!Number.isSafeInteger(draft.original.version) || draft.original.version < 1 || draft.original.version >= 2_147_483_647)) return "Atualize o profissional antes de salvar.";
  return null;
}
export function professionalFormPayload(draft: ProfessionalDraft): ServiceProfessionalInput & { expectedVersion?: number } {
  const error = professionalFormError(draft); if (error) throw new TypeError(error);
  const result: ServiceProfessionalInput & { expectedVersion?: number } = { publicName: draft.publicName.trim(), timeZone: draft.timeZone, isActive: draft.isActive, isPublished: draft.isActive && draft.isPublished };
  const before = draft.original;
  if (!before) return { ...result, publicProfile: draftProfile(draft), productIds: [...draft.productIds] };
  result.expectedVersion = before.version;
  const profile = originalProfile(before);
  if (draft.description !== (profile.description ?? "") || draft.specialtiesText !== (profile.specialties?.join("\n") ?? "")) result.publicProfile = draftProfile(draft);
  const previousIds = new Set(before.services.map(link => link.productId));
  if (previousIds.size !== draft.productIds.length || draft.productIds.some(id => !previousIds.has(id))) result.productIds = [...draft.productIds];
  return result;
}
