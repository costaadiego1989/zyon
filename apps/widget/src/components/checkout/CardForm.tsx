export type CardBrand = "visa" | "mastercard" | "elo" | "amex" | "unknown";

export function detectBrand(digits: string): CardBrand {
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(digits)) return "elo";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^5[1-5]|^2[2-7]/.test(digits)) return "mastercard";
  if (/^4/.test(digits)) return "visa";
  return "unknown";
}

export function luhnCheck(rawInput: string): boolean {
  const digits = rawInput.replace(/\D/g, "");
  if (digits.length < 13) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i]!, 10);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function validateExpiry(value: string): boolean {
  const match = value.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return false;
  const month = parseInt(match[1]!, 10);
  const year = 2000 + parseInt(match[2]!, 10);
  if (month < 1 || month > 12) return false;
  const now = new Date();
  return new Date(year, month - 1, 1) >= new Date(now.getFullYear(), now.getMonth(), 1);
}
