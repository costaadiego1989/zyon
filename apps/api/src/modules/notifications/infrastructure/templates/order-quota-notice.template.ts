import type { OrderQuotaNotice } from "../../domain/ports/order-quota-notice.port.js";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!);

/** Absolute dates in persisted copy remain accurate when an external delivery is delayed. */
export function renderOrderQuotaNoticeEmail(notice: OrderQuotaNotice, merchantName: string): { subject: string; html: string } {
  return {
    subject: (merchantName + " — " + notice.title).replace(/[\r\n]+/g, " "),
    html: '<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#1f2937">'
      + '<main style="max-width:600px;margin:0 auto;padding:24px">'
      + '<p style="font-size:14px">' + escapeHtml(merchantName) + '</p>'
      + '<h1 style="font-size:24px">' + escapeHtml(notice.title) + '</h1>'
      + '<p style="line-height:1.6;white-space:pre-line">' + escapeHtml(notice.body ?? "") + '</p>'
      + '<p>Consulte o uso de pedidos, o prazo vigente e as opções de plano na área de planos do painel Zyon.</p>'
      + '</main></body></html>',
  };
}

export function quotaNoticeTemplateVariables(notice: OrderQuotaNotice, merchantName: string): Record<string, string> {
  return {
    "1": merchantName,
    "2": notice.title,
    "3": notice.body ?? "",
  };
}
