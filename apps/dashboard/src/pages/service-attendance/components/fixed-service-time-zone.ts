import type { ServiceProfessionalAvailabilityDTO, ServiceAvailabilityExceptionDTO, ServiceProfessionalDTO } from "../../../api/endpoints/service-attendance.js";
import { createProfessionalDraft, professionalFormPayload, type ProfessionalDraft } from "./professional-form.js";
import { createRecurringAvailabilityDraft } from "./availability-form.js";

export const FIXED_SERVICE_UI_TIME_ZONE = "America/Sao_Paulo";

/** New editor defaults only; the generic historical IANA helpers stay intact. */
export function professionalEditorDraft(original: ServiceProfessionalDTO | null) {
  const draft = createProfessionalDraft(original);
  return original ? draft : { ...draft, timeZone: FIXED_SERVICE_UI_TIME_ZONE };
}
export function professionalEditorPayload(draft: ProfessionalDraft) {
  return professionalFormPayload({ ...draft, timeZone: draft.original?.timeZone ?? FIXED_SERVICE_UI_TIME_ZONE });
}
const minuteInstant = (value: string | null | undefined) => value == null || Number.isFinite(Date.parse(value)) && Date.parse(value) % 60_000 === 0;
export function requiresNewBrasiliaGrade(grade: ServiceProfessionalAvailabilityDTO) {
  return grade.timeZone !== FIXED_SERVICE_UI_TIME_ZONE || grade.rows.some(row => row.timeZone !== FIXED_SERVICE_UI_TIME_ZONE
    || !minuteInstant(row.validFrom) || !minuteInstant(row.validUntil));
}
/** Explicit user gesture starts a new draft; no historical wall minutes copy. */
export function newBrasiliaRecurringDraft() { return createRecurringAvailabilityDraft(FIXED_SERVICE_UI_TIME_ZONE, []); }
export function canEditBrasiliaException(row: ServiceAvailabilityExceptionDTO) {
  return row.timeZone === FIXED_SERVICE_UI_TIME_ZONE && typeof row.startsAt === "string" && typeof row.endsAt === "string"
    && minuteInstant(row.startsAt) && minuteInstant(row.endsAt);
}
