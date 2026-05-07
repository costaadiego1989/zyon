import type { ChatStage, CheckoutSession, CustomerAddress } from "@aacp/shared-types";

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
  const m = text.match(/\(?\s*(\d{2})\s*\)?[\s-]?(\d{4,5})\s*-?\s*(\d{4})/);
  if (m) {
    const digits = `${m[1]}${m[2]}${m[3]}`;
    if (digits.length >= 10 && digits.length <= 11) return digits;
  }
  
  const clean = text.replace(/[\s-]/g, "");
  const isolated = clean.match(/\b(\d{10,11})\b/);
  if (isolated) return isolated[1];

  const digitsOnly = text.replace(/\D+/g, "");
  if (digitsOnly.length >= 10 && digitsOnly.length <= 11) {
    return digitsOnly;
  }

  return undefined;
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

export function extractAddressDetailLine(
  text: string
): Pick<CustomerAddress, "number" | "complement"> | null {
  const stripped = text
    .replace(/\b\d{5}-?\d{3}\b/g, " ")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, " ")
    .trim();
  if (/^s\/?n\.?$|^sem\s+n[uú]mero$/i.test(stripped.replace(/\./g, ""))) {
    return { number: "S/N", complement: undefined };
  }
  const m = stripped.match(/^(\d{1,6}[a-zA-Z]?)(?:\s*[,;\-\/]\s*|\s+)(.+)$/);
  if (m) {
    return { number: m[1]?.trim(), complement: (m[2] ?? "").trim().slice(0, 160) };
  }
  const single = stripped.match(/^(\d{1,6}[a-zA-Z]?)$/);
  if (single) return { number: single[1]!, complement: undefined };
  return null;
}

export function extractOtp(text: string): string | undefined {
  const m = text.match(/\b(\d{4,6})\b/);
  if (m) return m[1];
  return undefined;
}

export function deriveChatStage(session: CheckoutSession, completed = false): ChatStage {
  if (completed) return "completed";
  const c = session.customer ?? {};
  if (!c.fullName || !c.email || !c.email_verified || !c.cpf || !c.phone) return "data_collection";
  const addr = c.address ?? {};
  if (
    !addr.zip ||
    !addr.street ||
    !(addr.city && addr.state) ||
    !addr.number ||
    !session.shipping
  ) {
    return "shipping";
  }
  if (!session.paymentMethod) return "payment";
  return "completed";
}

const DATA_FIELD_ORDER: Array<{ label: string; has: (s: CheckoutSession) => boolean }> = [
  { label: "nome", has: (s) => Boolean(s.customer?.fullName) },
  { label: "email", has: (s) => Boolean(s.customer?.email && (s.customer?.otp_code || s.customer?.email_verified)) },
  { label: "código de verificação", has: (s) => Boolean(s.customer?.email_verified) },
  { label: "CPF", has: (s) => Boolean(s.customer?.cpf) },
  { label: "telefone", has: (s) => Boolean(s.customer?.phone) }
];

export function missingFieldsForStage(session: CheckoutSession, stage: ChatStage): string[] {
  if (stage === "data_collection") {
    return DATA_FIELD_ORDER.filter((f) => !f.has(session)).map((f) => f.label);
  }
  if (stage === "shipping") {
    const addr = session.customer?.address ?? {};
    if (!addr.zip) return ["CEP"];
    if (!(addr.street && addr.city && addr.state)) return ["confirmar CEP"];
    if (!addr.number) return ["número e complemento (apto/bloco)"];
    if (!session.shipping?.customerPrice) return ["frete"];
    return [];
  }
  if (stage === "payment") return ["forma de pagamento"];
  return [];
}
