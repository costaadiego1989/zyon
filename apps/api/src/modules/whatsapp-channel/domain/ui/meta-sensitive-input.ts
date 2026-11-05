/** An unsolicited fiscal document must not be forwarded to the shopping
 * model or reflected in the UI. Bare phone/order numbers are not documents. */
export function containsSharedCpf(text: string): boolean {
  if (/\bCPF\b[^\n]{0,25}\d{3}/i.test(text) || /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(text)) return true;
  const number = text.trim();
  if (!/^\d{11}$/.test(number) || /^(\d)\1+$/.test(number)) return false;
  const digit = (size: number) => {
    const remainder = Array.from(number.slice(0, size)).reduce((sum, n, index) => sum + Number(n) * (size + 1 - index), 0) * 10 % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(number[9]) && digit(10) === Number(number[10]);
}
