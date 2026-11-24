import type { ServiceBusinessPolicyDTO, ServiceBusinessPolicyUpdate } from "../../../api/endpoints/service-attendance.js";

export interface AppointmentPolicyDraft {
  expectedVersion: number;
  online: boolean;
  hold: "" | "on" | "off";
  holdMinutes: string;
  admissionsEnabled: boolean;
}

export function appointmentPolicyDraft(value: ServiceBusinessPolicyDTO): AppointmentPolicyDraft {
  if (value.status !== "configured") {
    if (value.status === "invalid") throw new Error("service_policy_invalid");
    return { expectedVersion: value.version, online: false, hold: "", holdMinutes: "", admissionsEnabled: false };
  }
  return { expectedVersion: value.version, online: value.policy.paymentMode === "online", hold: value.policy.holdEnabled ? "on" : "off",
    holdMinutes: value.policy.holdEnabled ? String(value.policy.holdMinutes) : "", admissionsEnabled: value.policy.admissionsEnabled };
}

export function appointmentPolicyUpdate(draft: AppointmentPolicyDraft): ServiceBusinessPolicyUpdate {
  if (draft.hold !== "on" && draft.hold !== "off") throw new Error("Escolha como funciona a reserva temporária.");
  const minutes = Number(draft.holdMinutes);
  if (draft.hold === "on" && (!/^\d+$/.test(draft.holdMinutes.trim()) || !Number.isSafeInteger(minutes) || minutes < 1 || minutes > 2_147_483_647))
    throw new Error("Informe a duração da reserva em minutos inteiros, maior que zero.");
  return { expectedVersion: draft.expectedVersion, paymentMode: draft.online ? "online" : "at_attendance", holdEnabled: draft.hold === "on",
    holdMinutes: draft.hold === "on" ? minutes : null, admissionsEnabled: draft.admissionsEnabled };
}
