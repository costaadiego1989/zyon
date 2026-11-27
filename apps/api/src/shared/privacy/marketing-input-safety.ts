/** Shared defenses. Pattern checks supplement authorization; they are not a sandbox. */
export function normalizeSecurityText(value: string): string {
  return value.normalize("NFKC").normalize("NFD")
    .replace(/\p{Diacritic}|[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, "")
    .replace(/\s+/g, " ").trim().toLowerCase();
}

export const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore (?:all |any |the )?(?:previous|prior|system|developer) (?:instructions|rules|messages)/,
  /you are now|forget (?:everything|all|your)|new instructions/,
  /disregard (?:all|your|the|previous)|override (?:system|safety|instructions)/,
  /(?:bypass|disable) (?:safety|guard|filter|instructions)/,
  /act as (?:if you are|a different)|pretend (?:you (?:are|have|were)|that you (?:are|have|were|had))/,
  /from now on (?:you|ignore|forget)|do not follow (?:any|your|previous|the)/,
  /system\s*prompt|\[system\]|\[inst\]|<<sys>>|<\|(?:im_start|system|endoftext)\|>/,
  /(?:ignore|ignora|ignorar|desconsidere|desconsiderar|esqueca|olvida) (?:todas? (?:as |las )?|as |las |os |los |suas? )?(?:instrucoes|instruciones|regras|reglas)(?: anteriores| previas| do sistema| del sistema)?/,
  /(?:instrucoes|instruciones) (?:anteriores|previas).{0,30}(?:ignore|ignora|desconsidere)/,
  /(?:desative|desativa|desabilite|desactivar|desactiva|contorne|burlar) (?:os |as |a |o |los |las )?(?:filtros|guardrails|seguranca|seguridad|restricoes)/,
  /(?:revele|divulgue|mostre|exiba|revela|reveal|print|expose|show) .{0,40}(?:prompt (?:do sistema|de sistema)|instrucoes internas|internal instructions|api key|chave (?:da api|secreta)|secret key)/,
  /(?:envie|mande|exfiltre|send|upload|exfiltrate) .{0,60}(?:dados privados|dados (?:dos|de outros) clientes|private data|customer data|secrets)/,
  /(?:decode|decodifique|decodifica) .{0,30}base64.{0,60}(?:instru|execut|follow)/,
];

export function findPromptInjection(value: string): string | undefined {
  const normalized = normalizeSecurityText(value);
  return PROMPT_INJECTION_PATTERNS.find(pattern => pattern.test(normalized))?.source;
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE = /(?<!\d)(?:\+?55[ .-]?)?(?:\(\d{2}\)|\d{2})[ .-]?9?\d{4}[ .-]?\d{4}(?!\d)/g;
const CPF = /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g;
const SECRET = /\b(?:sk-(?:proj-)?[a-z0-9_-]{12,}|Bearer\s+[a-z0-9._~+/-]{8,}|eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+)\b/gi;

export function redactSensitiveReference(value:string):string {
  return value.normalize("NFKC").replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu,"")
    .replace(EMAIL,"[email removido]").replace(CPF,"[documento removido]")
    .replace(PHONE,"[telefone removido]").replace(SECRET,"[credencial removida]");
}

export { conversationHistoryText } from "./conversation-history-text.js";
