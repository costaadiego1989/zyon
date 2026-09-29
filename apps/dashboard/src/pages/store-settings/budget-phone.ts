import { maskPhone } from "../../utils/masks.js";

function nationalPhone(digits: string): string {
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return maskPhone(digits);
}

/** Keep every digit so validation can reject overlong values without changing the recipient. */
export function formatBudgetPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return value.trim().startsWith("+") ? "+" : "";
  const international = value.trim().startsWith("+") || digits.length > 11;
  if (!international) return nationalPhone(digits);
  if (digits.startsWith("55") && digits.length <= 13) return `+55${digits.length > 2 ? " " + nationalPhone(digits.slice(2)) : ""}`;
  if (digits.startsWith("1") && digits.length === 11) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return "+" + (digits.match(/.{1,3}/g) ?? []).join(" ");
}
