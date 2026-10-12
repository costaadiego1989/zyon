export interface ServiceScheduleConfig {
  timeZone: string;
  durationMinutes: number;
  slots: Array<{ id: string; date: string; startTime: string }>;
}
export interface SelectedServiceSlot {
  slotId: string;
  date: string;
  startTime: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  durationMinutes: number;
}
export interface PublicServiceSchedule {
  timeZone: string;
  durationMinutes: number;
  slots: Array<SelectedServiceSlot & { selectable: boolean }>;
}

function wallTime(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(date);
  const part = (name: string) => Number(parts.find(item => item.type === name)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
}
/** Resolve civil time in its zone; ambiguous/nonexistent DST times need another choice. */
export function serviceStartInstant(date: string, time: string, timeZone: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return undefined;
  const target = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== date) return undefined;
  try {
    let candidate = target;
    for (let index = 0; index < 4; index++) {
      const difference = target - wallTime(new Date(candidate), timeZone);
      if (!difference) {
        if ([-120, -60, -30, 30, 60, 120].some(minutes => wallTime(new Date(candidate + minutes * 60_000), timeZone) === target)) return undefined;
        return new Date(candidate);
      }
      candidate += difference;
    }
    return undefined;
  } catch { return undefined; }
}
export function serviceScheduleError(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "invalid_service_schedule";
  const value = raw as ServiceScheduleConfig;
  if (typeof value.timeZone !== "string" || value.timeZone.length > 80
    || !Number.isSafeInteger(value.durationMinutes) || value.durationMinutes < 5 || value.durationMinutes > 480
    || !Array.isArray(value.slots) || value.slots.length > 200) return "invalid_service_schedule";
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: value.timeZone }).format(); } catch { return "invalid_service_timezone"; }
  const ids = new Set<string>(), starts: number[] = [];
  for (const slot of value.slots) {
    if (!slot || typeof slot.id !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(slot.id) || ids.has(slot.id)
      || typeof slot.date !== "string" || typeof slot.startTime !== "string") return "invalid_service_schedule";
    const start = serviceStartInstant(slot.date, slot.startTime, value.timeZone);
    if (!start) return "invalid_service_slot_time";
    ids.add(slot.id); starts.push(start.getTime());
  }
  starts.sort((a, b) => a - b);
  if (starts.some((start, index) => index > 0 && start < starts[index - 1]! + value.durationMinutes * 60_000)) return "overlapping_service_slots";
  return undefined;
}
export function serviceScheduleFromMetadata(metadata: unknown): unknown {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>).serviceSchedule : undefined;
}
export function publicServiceSchedule(metadata: unknown, now = new Date()): PublicServiceSchedule | undefined {
  const raw = serviceScheduleFromMetadata(metadata);
  if (raw === undefined || serviceScheduleError(raw)) return undefined;
  const value = raw as ServiceScheduleConfig;
  return { timeZone: value.timeZone, durationMinutes: value.durationMinutes, slots: value.slots.map(slot => {
    const start = serviceStartInstant(slot.date, slot.startTime, value.timeZone)!;
    return { slotId: slot.id, date: slot.date, startTime: slot.startTime, startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + value.durationMinutes * 60_000).toISOString(), timeZone: value.timeZone,
      durationMinutes: value.durationMinutes, selectable: start > now };
  }).sort((a, b) => a.startsAt.localeCompare(b.startsAt)) };
}
export function isServiceOfferAvailable(metadata: unknown, now = new Date()) {
  if (serviceScheduleFromMetadata(metadata) === undefined) return true;
  return Boolean(publicServiceSchedule(metadata, now)?.slots.some(slot => slot.selectable));
}
export class ServiceSlotError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function resolveSelectedServiceSlot(metadata: unknown, slotId?: string, now = new Date()): SelectedServiceSlot | undefined {
  const raw = serviceScheduleFromMetadata(metadata);
  if (raw === undefined) {
    if (slotId !== undefined) throw new ServiceSlotError("service_slot_unknown");
    return undefined;
  }
  if (serviceScheduleError(raw)) throw new ServiceSlotError("service_schedule_invalid");
  if (!slotId) throw new ServiceSlotError("service_slot_required");
  const slot = publicServiceSchedule(metadata, now)!.slots.find(item => item.slotId === slotId);
  if (!slot) throw new ServiceSlotError("service_slot_unknown");
  if (!slot.selectable) throw new ServiceSlotError("service_slot_expired");
  const { selectable: _, ...selected } = slot;
  return selected;
}
export function serviceSlotSnapshotMatches(a: SelectedServiceSlot, b: SelectedServiceSlot) {
  return a.slotId === b.slotId && a.date === b.date && a.startTime === b.startTime && a.startsAt === b.startsAt
    && a.endsAt === b.endsAt && a.timeZone === b.timeZone && a.durationMinutes === b.durationMinutes;
}
export function serviceSlotLabel(slot: SelectedServiceSlot) {
  return `${slot.date.split("-").reverse().join("/")} às ${slot.startTime} · ${slot.durationMinutes} min · ${slot.timeZone}`;
}
