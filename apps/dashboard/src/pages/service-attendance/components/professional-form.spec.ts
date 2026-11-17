import { describe, expect, it } from "vitest";
import { createProfessionalDraft, professionalFormPayload, professionalFormError } from "./professional-form.js";
import type { ServiceProfessionalDTO } from "../../../api/endpoints/service-attendance.js";

const original: ServiceProfessionalDTO = { id: "professional-a", merchantId: "merchant-a", publicName: "Ana", publicProfile: { description: "Perfil original", specialties: ["Coluna", "A\nB"] }, timeZone: "America/Sao_Paulo", isActive: true, isPublished: true, version: 7, services: [{ id: "link-a", productId: "service-a", version: 2 }, { id: "link-hidden", productId: "service-outside-page", version: 9 }], createdAt: "2026-11-16T12:00:00Z", updatedAt: "2026-11-16T12:00:00Z" };

describe("T76 public professional form contracts", () => {
  it("requires an explicit public name and timezone without introducing login or publication defaults", () => {
    const draft = createProfessionalDraft();
    expect(draft).toMatchObject({ publicName: "", timeZone: "", isActive: true, isPublished: false, productIds: [] });
    expect(professionalFormError(draft)).toBe("Informe o nome público do profissional.");
    expect(professionalFormError({ ...draft, publicName: "Ana" })).toBe("Informe um fuso horário IANA válido.");
    const payload = professionalFormPayload({ ...draft, publicName: "  Ana  ", timeZone: "America/Sao_Paulo" });
    expect(payload).toEqual({ publicName: "Ana", publicProfile: { description: "", specialties: [] }, timeZone: "America/Sao_Paulo", isActive: true, isPublished: false, productIds: [] });
    expect(Object.keys(payload)).not.toEqual(expect.arrayContaining(["email", "password", "userId", "merchantId"]));
  });
  it("keeps off-page links and omits unchanged link/profile fields on an ordinary edit", () => {
    const draft = createProfessionalDraft(original);
    expect(draft.productIds).toEqual(["service-a", "service-outside-page"]);
    expect(professionalFormPayload({ ...draft, publicName: "Ana Silva" })).toEqual({ expectedVersion: 7, publicName: "Ana Silva", timeZone: "America/Sao_Paulo", isActive: true, isPublished: true });
  });
  it("sends the complete changed link set with CAS and preserves other real IDs", () => {
    const draft = createProfessionalDraft(original);
    expect(professionalFormPayload({ ...draft, productIds: [...draft.productIds, "service-b"] })).toMatchObject({ expectedVersion: 7, productIds: ["service-a", "service-outside-page", "service-b"] });
    expect(professionalFormPayload({ ...draft, productIds: [] })).toMatchObject({ expectedVersion: 7, productIds: [] });
    expect(professionalFormPayload({ ...draft, productIds: [...draft.productIds].reverse() })).not.toHaveProperty("productIds");
  });
  it("makes explicit public-profile clearing and reactivation choices without rewriting unchanged legacy formatting", () => {
    const draft = createProfessionalDraft(original);
    expect(professionalFormPayload({ ...draft, description: "", specialtiesText: "" })).toMatchObject({ publicProfile: { description: "", specialties: [] } });
    const inactive = createProfessionalDraft({ ...original, isActive: false, isPublished: false });
    expect(professionalFormPayload({ ...inactive, isActive: true })).toMatchObject({ expectedVersion: 7, isActive: true, isPublished: false });
  });
  it("rejects oversized public fields and invalid/duplicate association choices", () => {
    const draft = { ...createProfessionalDraft(), publicName: "Ana", timeZone: "America/Sao_Paulo" };
    expect(professionalFormError({ ...draft, publicName: "x".repeat(121) })).toBe("O nome público deve ter até 120 caracteres.");
    expect(professionalFormError({ ...draft, description: "x".repeat(1201) })).toBe("A apresentação deve ter até 1.200 caracteres.");
    expect(professionalFormError({ ...draft, specialtiesText: Array.from({ length: 21 }, (_, i) => "Item " + i).join("\n") })).toBe("Informe até 20 especialidades, com até 100 caracteres cada.");
    expect(professionalFormError({ ...draft, productIds: ["same", "same"] })).toBe("Confira os serviços vinculados ao profissional.");
    expect(professionalFormError({ ...draft, productIds: Array.from({ length: 101 }, (_, i) => "service-" + i) })).toBe("Confira os serviços vinculados ao profissional.");
  });
  it("rejects an invalid original public profile rather than silently replacing it with empty JSON", () => {
    expect(() => createProfessionalDraft({ ...original, publicProfile: "private-or-invalid" })).toThrow("invalid_professional_public_profile");
    expect(() => createProfessionalDraft({ ...original, publicProfile: { description: 7 } })).toThrow("invalid_professional_public_profile");
  });
});
