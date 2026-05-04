import type { ChatStage, CheckoutSession } from "@aacp/shared-types";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
const NAME_QUESTION_RE = /\b(nome\s*completo|seu\s+nome|posso\s+te\s+chamar|como\s+(?:te\s+chamar|posso\s+te\s+chamar)|chamo|qual\s+(?:o\s+)?seu\s+nome)\b/i;

export function extractEmail(text: string): string | undefined {
  const match = text.match(EMAIL_RE);
  if (!match) return undefined;
  const value = match[0];
  if (!/\.[A-Za-z]{2,}$/.test(value)) return undefined;
  return value;
}

export function extractCpf(text: string): string | undefined {
  const digitsOnly = text.replace(/\D+/g, "");
  if (digitsOnly.length < 11) return undefined;
  for (let i = 0; i + 11 <= digitsOnly.length; i++) {
    const candidate = digitsOnly.slice(i, i + 11);
    if (/^\d{11}$/.test(candidate)) return candidate;
  }
  return undefined;
}

export function extractCep(text: string): string | undefined {
  const m = text.match(/\b(\d{5})-?(\d{3})\b/);
  if (m) return `${m[1]}${m[2]}`;
  const digitsOnly = text.replace(/\D+/g, "");
  if (/^\d{8}$/.test(digitsOnly)) return digitsOnly;
  return undefined;
}

export function extractPhone(text: string): string | undefined {
  const m = text.match(/\(?\s*(\d{2})\s*\)?[\s-](\d{4,5})\s*-?\s*(\d{4})/);
  if (!m) return undefined;
  const digits = `${m[1]}${m[2]}${m[3]}`;
  if (digits.length < 10 || digits.length > 11) return undefined;
  return digits;
}

const NAME_FILLERS = ["é", "e", "sou", "meu", "nome", "me", "chamo", "o", "a"];

export function extractName(text: string, lastAgentTurn?: string): string | undefined {
  if (!lastAgentTurn || !NAME_QUESTION_RE.test(lastAgentTurn)) return undefined;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return undefined;
  if (/[\d@/]/.test(trimmed)) return undefined;
  const tokens = trimmed
    .split(/\s+/)
    .filter((t) => !NAME_FILLERS.includes(t.toLowerCase()))
    .map((t) => t.replace(/[.,;:]/g, ""))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return undefined;
  if (tokens.some((t) => !/^[\p{L}'-]+$/u.test(t))) return undefined;
  return tokens
    .map((t) => t.charAt(0).toLocaleUpperCase("pt-BR") + t.slice(1).toLocaleLowerCase("pt-BR"))
    .join(" ");
}

export function deriveChatStage(session: CheckoutSession, completed = false): ChatStage {
  if (completed) return "completed";
  const c = session.customer ?? {};
  if (!c.fullName || !c.email || !c.cpf || !c.phone) return "data_collection";
  if (!session.shipping || !c.address?.zip) return "shipping";
  if (!session.paymentMethod) return "payment";
  return "completed";
}

const DATA_FIELD_ORDER: Array<{ label: string; has: (s: CheckoutSession) => boolean }> = [
  { label: "nome", has: (s) => Boolean(s.customer?.fullName) },
  { label: "email", has: (s) => Boolean(s.customer?.email) },
  { label: "CPF", has: (s) => Boolean(s.customer?.cpf) },
  { label: "telefone", has: (s) => Boolean(s.customer?.phone) }
];

export function missingFieldsForStage(session: CheckoutSession, stage: ChatStage): string[] {
  if (stage === "data_collection") {
    return DATA_FIELD_ORDER.filter((f) => !f.has(session)).map((f) => f.label);
  }
  if (stage === "shipping") {
    const labels: string[] = [];
    if (!session.customer?.address?.zip) labels.push("CEP");
    if (!session.shipping) labels.push("entrega");
    return labels.length === 0 ? ["CEP"] : labels;
  }
  if (stage === "payment") return ["forma de pagamento"];
  return [];
}
