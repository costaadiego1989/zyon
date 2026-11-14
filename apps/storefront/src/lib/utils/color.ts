export const COLOR_KEYWORDS = [
  "preto",
  "azul",
  "verde",
  "branco",
  "vermelho",
  "cinza",
  "bege",
  "marinho",
  "amarelo",
  "rosa",
  "lilas",
  "laranja",
  "marrom",
  "vinho",
];

export const COLOR_HEX: Record<string, string> = {
  preto: "#111111",
  azul: "#2563eb",
  verde: "#16a34a",
  branco: "#f5f5f5",
  vermelho: "#dc2626",
  cinza: "#6b7280",
  bege: "#d6c5a3",
  marinho: "#1e3a8a",
  amarelo: "#facc15",
  rosa: "#ec4899",
  lilas: "#a855f7",
  laranja: "#f97316",
  marrom: "#92400e",
  vinho: "#7f1d1d",
};

export function isColorToken(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (/^(#([0-9a-f]{3,8})|rgb\(|hsl\()/i.test(value.trim())) return true;
  return COLOR_KEYWORDS.some((k) => v.includes(k));
}

export function colorFromToken(value: string): string {
  const v = value.trim().toLowerCase();
  if (/^#([0-9a-f]{3,8})$/i.test(v)) return v;
  for (const key of COLOR_KEYWORDS) {
    if (v.includes(key)) return COLOR_HEX[key];
  }
  return "#9ca3af";
}

export function isLightHex(hex: string): boolean {
  const m = hex.replace("#", "");
  if (m.length !== 6 && m.length !== 3) return false;
  const full =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.65;
}
