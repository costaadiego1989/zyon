export function paymentMethodLabel(method: string | null | undefined): string {
  const normalized = (method ?? "").trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (["", "unknown", "nao informado"].includes(normalized)) return "Não informado";
  if (["card", "credit_card", "cartao"].includes(normalized)) return "Cartão";
  if (normalized === "pix") return "PIX";
  if (["boleto", "bank_slip"].includes(normalized)) return "Boleto";
  return method!.trim();
}
