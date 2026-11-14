export function formatPhone(value: string): string {
  const numbers = value.replace(/\D/g, "").slice(0, 11);
  if (numbers.length > 7)
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
  if (numbers.length > 2)
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  return numbers;
}

export function formatCEP(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length > 5) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return digits;
}

export function maskCPF(cpf?: string | null): string {
  if (!cpf) return "—";
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return cpf;
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
}
