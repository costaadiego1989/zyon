export interface ServiceScheduleDraft {
  timeZone: string;
  durationMinutes: number;
  slots: Array<{ id: string; date: string; startTime: string }>;
}
export function serviceScheduleFormError(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "Revise a configuração de horários do serviço.";
  const value = raw as ServiceScheduleDraft;
  try { if (typeof value.timeZone !== "string" || !value.timeZone || value.timeZone.length > 80) throw Error(); new Intl.DateTimeFormat("pt-BR", { timeZone: value.timeZone }).format(); }
  catch { return "Escolha um fuso horário válido para o atendimento."; }
  if (!Number.isSafeInteger(value.durationMinutes) || value.durationMinutes < 5 || value.durationMinutes > 480) return "A duração deve ser um número inteiro entre 5 e 480 minutos.";
  if (!Array.isArray(value.slots) || value.slots.length > 200) return "Configure até 200 horários nesta oferta.";
  const ids = new Set<string>(), starts: number[] = [];
  for (const [index, slot] of value.slots.entries()) {
    if (!slot || typeof slot.id !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(slot.id) || ids.has(slot.id)) return "Revise os identificadores dos horários.";
    const start = Date.parse(`${slot.date}T${slot.startTime}:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.startTime) || !Number.isFinite(start)
      || new Date(start).toISOString().slice(0, 10) !== slot.date) return `Preencha uma data e uma hora válidas no horário ${index + 1}.`;
    ids.add(slot.id); starts.push(start);
  }
  starts.sort((a, b) => a - b);
  if (starts.some((start, index) => index > 0 && start < starts[index - 1]! + value.durationMinutes * 60_000)) return "Os horários se sobrepõem. Respeite a duração de cada atendimento.";
  return undefined;
}
