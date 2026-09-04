export function returnRequestedWhatsAppMessage(data: { buyerName: string; orderId: string; reason: string; merchantName: string }): string {
  return `⚠️ *Nova solicitação de devolução*

Comprador: ${data.buyerName}
Pedido: #${data.orderId}
Motivo: ${data.reason}

Acesse o painel para analisar e aprovar ou rejeitar.`;
}

export function refundProcessedWhatsAppMessage(data: { buyerName: string; orderId: string; amountBRL: string }): string {
  return `💸 *Reembolso processado*

Comprador: ${data.buyerName}
Pedido: #${data.orderId}
Valor: ${data.amountBRL}

O valor será creditado ao comprador em até 5 dias úteis.`;
}

export function chargebackOpenedWhatsAppMessage(data: { orderId: string; amountBRL: string; reason: string }): string {
  return `🚨 *Disputa de cartão aberta*

Pedido: #${data.orderId}
Valor: ${data.amountBRL}
Motivo: ${data.reason}

Acesse o painel para enviar evidências e contestar a disputa. Prazo: 7 dias.`;
}

export function holdReleasedWhatsAppMessage(data: { amountBRL: string; merchantName: string }): string {
  return `💰 *Pagamento liberado*

Valor: ${data.amountBRL}
Prazo CDC (14 dias) concluído sem contestação.

O valor já está disponível na sua conta.`;
}

export function returnApprovedBuyerWhatsAppMessage(data: { orderId: string; merchantName: string }): string {
  return `✅ *Devolução aprovada*

Pedido: #${data.orderId}
Loja: ${data.merchantName}

Sua devolução foi aprovada. Use a etiqueta de envio para devolver o produto.`;
}

export function returnReceivedBuyerWhatsAppMessage(data: { orderId: string }): string {
  return `📦 *Produto recebido*

Pedido: #${data.orderId}

Recebemos seu produto. Estamos analisando para processar o reembolso.`;
}
