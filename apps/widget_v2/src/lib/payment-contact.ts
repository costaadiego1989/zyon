export function paymentRequiresCpf(method: string | undefined, providers: Partial<Record<"pix" | "card" | "boleto", string>> | undefined): boolean {
  const key = method === "credito" || method === "debito" || method === "card" ? "card" : method === "pix" ? "pix" : method === "boleto" ? "boleto" : undefined;
  return !!key && providers?.[key] === "asaas";
}

export function externalPaymentMethod(value: unknown, channel: unknown): "card" | "crypto" | undefined {
  return channel === "chat" && (value === "card" || value === "crypto") ? value : undefined;
}
