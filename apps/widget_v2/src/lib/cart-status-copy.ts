export function cartStatusCopy(status: string, hasShipping: boolean): string {
  if (status === "shipping_calculated") return hasShipping ? "Frete confirmado" : "Pedido revisado";
  return ({ awaiting: "Aguardando", ready_to_pay: "Pronto para pagar", paid: "Pago ✓" } as Record<string, string>)[status] ?? "Aguardando";
}
