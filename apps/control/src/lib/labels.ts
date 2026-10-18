const statuses: Record<string, string> = {
  approved: "Aprovado", paid: "Pago", pending: "Pendente", processing: "Em processamento",
  completed: "Concluído", fulfilled: "Concluído", cancelled: "Cancelado", canceled: "Cancelado",
  refunded: "Reembolsado", partially_refunded: "Reembolso parcial", failed: "Falhou",
  rejected: "Recusado", expired: "Expirado", authorized: "Autorizado", unpaid: "Não pago",
  active: "Ativo", inactive: "Inativo", connected: "Conectado", disconnected: "Desconectado",
  not_configured: "Não configurado", reauth_required: "Reconexão necessária", error: "Erro",
  shipped: "Enviado", in_transit: "Em trânsito", delivered: "Entregue", awaiting_shipment: "Aguardando envio",
  awaiting_payment: "Aguardando pagamento", ready: "Pronto", queued: "Na fila", succeeded: "Concluído",
};
const methods: Record<string, string> = {
  pix: "Pix", boleto: "Boleto", credit_card: "Cartão de crédito", debit_card: "Cartão de débito",
  card: "Cartão", bank_transfer: "Transferência", crypto: "Criptomoeda", cash: "Dinheiro",
};
const providers: Record<string, string> = { stripe: "Stripe", asaas: "Asaas", mercadopago: "Mercado Pago", mercado_pago: "Mercado Pago" };

export function statusLabel(value: string): string { return statuses[value.toLowerCase()] ?? value; }
export function paymentMethodLabel(value: string): string { return methods[value.toLowerCase()] ?? value; }
export function providerLabel(value: string): string { return providers[value.toLowerCase()] ?? value; }
