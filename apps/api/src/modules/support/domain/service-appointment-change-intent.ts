export type ServiceAppointmentChangeIntent = "cancel" | "reschedule";

/** Current utterance routing only. A positive result grants no appointment,
 * identity, policy, cancellation, rescheduling or financial authority. */
export function serviceAppointmentChangeIntent(raw: unknown): ServiceAppointmentChangeIntent | undefined {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 4000) return;
  const text = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/["“”‘’]/.test(text) || /\b(?:se eu|se precisar|se eu precisar|hipoteticamente|por exemplo|um exemplo|a frase|o texto)\b/.test(text)
    || /^\s*(?:como|qual|quais|o que acontece|posso saber)\b/.test(text)
    || /^\s*(?:eu\s+)?(?:quero|queria|gostaria|preciso)\s+(?:de\s+)?(?:saber|entender|aprender)\s+como\b/.test(text)
    || /\b(?:nao|nunca|jamais)(?:\s+(?:me|mais|agora)){0,2}\s+(?:quero|queria|preciso|gostaria|solicito|cancelar|remarcar|reagendar)\b/.test(text)) return;
  if (!/\b(?:agendamento|consulta|atendimento|horario)\b/.test(text)) return;
  const cancel = /\b(?:cancelar|cancele|cancelamento)\b/.test(text);
  const reschedule = /\b(?:remarcar|remarque|reagendar|reagende|remarcacao|reagendamento)\b/.test(text);
  if (cancel === reschedule) return;
  if (!/\b(?:quero|queria|preciso|gostaria|solicito|pode|poderia|consegue|por favor)\b/.test(text)
    && !/^\s*(?:cancelar|cancele|remarcar|remarque|reagendar|reagende)\b/.test(text)) return;
  return cancel ? "cancel" : "reschedule";
}

/** An explicit displayed #reference is an untrusted hint, never a capability. */
export function serviceAppointmentReference(raw: string): string | null | undefined {
  if (!raw.includes("#")) return;
  const refs = [...raw.matchAll(/#([^\s]*)/g)].map(match => match[1]!.replace(/[.,!?;:]+$/, ""));
  return refs.length !== 1 || !/^[A-Za-z0-9_-]{3,191}$/.test(refs[0]!) ? null : refs[0];
}
