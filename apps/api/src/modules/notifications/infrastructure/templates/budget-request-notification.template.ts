export interface MerchantBudgetNotification {
  id: string;
  merchantName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  items: unknown;
  total: number;
  note?: string | null;
}

type Item = { productName: string; quantity: number; price: number };

export function renderMerchantBudgetEmail(input: MerchantBudgetNotification): { subject: string; html: string } {
  const buyer = escape(input.customerName || input.customerEmail || input.customerPhone || "Cliente");
  const items = normalizeItems(input.items);
  const itemRows = items.map((item) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb"><strong>${escape(item.productName)}</strong></td><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center">x${item.quantity}</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right">${formatCurrency(item.price)}</td></tr>`).join("");
  const note = input.note?.trim() ? `<p style="margin:20px 0 0;color:#374151"><strong>Mensagem do cliente:</strong><br>${escape(input.note)}</p>` : "";
  return {
    subject: `${input.merchantName} | nova solicitação de orçamento`.replace(/[\r\n]/g, " "),
    html: `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><body style="margin:0;background:#f4f7f5;font-family:Arial,sans-serif;color:#111827"><main style="max-width:620px;margin:24px auto;padding:30px;background:#fff;border:1px solid #dbe5de;border-radius:14px"><p style="margin:0 0 10px;color:#2f6a50;font-size:12px;font-weight:700;letter-spacing:.06em">${escape(input.merchantName)}</p><h1 style="margin:0;font-size:24px">Nova solicitação de orçamento</h1><p style="line-height:1.6">${buyer} enviou uma solicitação de orçamento.</p><p style="line-height:1.65"><strong>Contato:</strong> ${escape(input.customerEmail)} · ${escape(input.customerPhone)}</p><table role="presentation" style="width:100%;border-collapse:collapse;margin-top:18px">${itemRows}</table><p style="margin:20px 0 0;text-align:right;font-size:18px"><strong>Total estimado: ${formatCurrency(input.total)}</strong></p>${note}<p style="margin:26px 0 0;color:#6b7280;font-size:13px">A solicitação e os dados completos também estão disponíveis no painel da Zyon, em Configurações da loja → Orçamento.</p></main></body></html>`,
  };
}

export function renderMerchantBudgetWhatsApp(input: MerchantBudgetNotification): string {
  const items = normalizeItems(input.items).map((item) => `- ${item.productName} x${item.quantity} — ${formatCurrency(item.price)}`).join("\n") || "- Itens disponíveis no painel";
  const note = input.note?.trim() ? `\n\nMensagem: ${input.note.trim()}` : "";
  return [
    `Nova solicitação de orçamento na *${input.merchantName}*`,
    "",
    `Cliente: ${input.customerName}`,
    `Contato: ${input.customerEmail} · ${input.customerPhone}`,
    "",
    "*Itens*",
    items,
    "",
    `Total estimado: *${formatCurrency(input.total)}*${note}`,
    "",
    "Confira os detalhes no painel da Zyon em Configurações da loja → Orçamento.",
  ].join("\n");
}

function normalizeItems(value: unknown): Item[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): Item[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const productName = typeof item.productName === "string" ? item.productName.trim() : "Item";
    const quantity = typeof item.quantity === "number" && Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 1;
    const price = typeof item.price === "number" && Number.isFinite(item.price) && item.price >= 0 ? item.price : 0;
    return [{ productName, quantity, price }];
  });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(value) ? value : 0);
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}
