export interface ServiceTimeChoice {
  slotId: string;
  date: string;
  startTime: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  durationMinutes: number;
  selectable: boolean;
}
export interface PublicServiceSchedule {
  timeZone: string;
  durationMinutes: number;
  slots: ServiceTimeChoice[];
}
export function isSelectableServiceTime(slot: ServiceTimeChoice, now = Date.now()) {
  return slot.selectable && Number.isFinite(Date.parse(slot.startsAt)) && Date.parse(slot.startsAt) > now;
}
export function serviceDateLabel(date: string) { return date.split("-").reverse().join("/"); }
export function serviceTimeEndLabel(slot: ServiceTimeChoice) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: slot.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(slot.endsAt));
}
