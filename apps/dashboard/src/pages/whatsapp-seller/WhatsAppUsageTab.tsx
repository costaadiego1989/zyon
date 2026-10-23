import React from "react";
import "./whatsapp-usage.css";
import { AlertCircle, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "../../components/Button.js";
import type { WhatsAppUsage, WhatsAppUsagePeriod } from "../../api/endpoints/whatsapp-usage.js";
import type { useWhatsAppUsage } from "./useWhatsAppUsage.js";
const categories: Record<string, string> = { SERVICE: "Atendimento", UTILITY: "Utilidade", MARKETING: "Marketing", MARKETING_LITE: "Marketing", AUTHENTICATION: "Autenticação", AUTHENTICATION_INTERNATIONAL: "Autenticação internacional" };
const pricingTypes: Record<string, string> = { FREE_CUSTOMER_SERVICE: "Atendimento gratuito", FREE_ENTRY_POINT: "Entrada gratuita", REGULAR: "Tarifa da Meta" };
const count = (value: number | null) => value === null ? "Indisponível" : value.toLocaleString("pt-BR");
export function whatsappUsageMoney(value: number | null, currency: string | null): string {
  if (value === null) return "Indisponível";
  if (currency) return new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 4 }).format(value);
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} (moeda não informada)`;
}
export function WhatsAppProcessingNotice({ data, onView }: { data: WhatsAppUsage | null; onView: () => void }) {
  if (!data || !(data.processing.recentFailed || data.processing.recentPending)) return null;
  return <div className="whatsapp-usage__notice" role="status"><AlertCircle size={20} aria-hidden="true" /><div>
    <strong>{data.processing.recentFailed ? "Há mensagens com falha no atendimento" : "Há mensagens em processamento"}</strong>
    <p>Nas últimas 24 horas: {data.processing.recentPending} pendentes e {data.processing.recentFailed} com falha. A conexão com a Meta e o atendimento têm estados próprios.</p>
    <Button variant="ghost" size="sm" onClick={onView}>Ver consumo e atendimento</Button></div></div>;
}
export function WhatsAppUsageTab({ vm }: { vm: ReturnType<typeof useWhatsAppUsage> }) {
  const data = vm.data;
  const date = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
  return <section id="whatsapp-usage" role="tabpanel" aria-labelledby="whatsapp-usage-tab" className="whatsapp-seller__content">
    <section className="panel whatsapp-seller__panel whatsapp-usage"><div className="whatsapp-usage__heading">
      <div><h2>Consumo e cobrança</h2><p>Mensagens e custos informados pela Meta para o WhatsApp desta loja.</p></div>
      <div className="whatsapp-usage__controls"><label htmlFor="whatsapp-usage-period">Período</label>
        <select id="whatsapp-usage-period" value={vm.period} onChange={event => vm.setPeriod(event.target.value as WhatsAppUsagePeriod)}><option value="month">Este mês</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option></select>
        <Button variant="outline" size="sm" disabled={vm.loading} onClick={() => void vm.refresh()}><RefreshCw size={15} aria-hidden="true" /> Atualizar</Button></div></div>
      {vm.error && <p role="alert" className="whatsapp-usage__error">{vm.error}</p>}
      {vm.loading && !data && <div className="whatsapp-usage__loading" role="status" aria-label="Consultando o consumo na Meta"><span /><span /><span /><p>Consultando o consumo na Meta…</p></div>}
      {data && <><p className="whatsapp-usage__period">{date(data.period.from)} a {date(data.period.to)} · Horário de São Paulo</p>
        {data.connection === "unavailable" && <p role="status">Conecte o WhatsApp Business desta loja para consultar os dados da Meta.</p>}
        <dl className="whatsapp-usage__totals"><div><dt>Mensagens enviadas</dt><dd>{count(data.messages.sent)}</dd></div><div><dt>Mensagens entregues</dt><dd>{count(data.messages.delivered)}</dd></div><div><dt>Custo informado pela Meta</dt><dd>{whatsappUsageMoney(data.pricing.cost, data.currency)}</dd></div></dl>
        {(!data.messages.available || !data.pricing.available) && <p role="status">A Meta não disponibilizou todos os dados deste período. Os campos indisponíveis serão atualizados em uma nova consulta.</p>}
        <div className="whatsapp-usage__table-wrap"><table className="whatsapp-usage__table"><caption>Consumo por categoria</caption><thead><tr><th scope="col">Categoria</th><th scope="col">Cobrança</th><th scope="col">Mensagens</th><th scope="col">Custo</th></tr></thead><tbody>
          {data.pricing.categories.map(item => <tr key={`${item.category}:${item.pricingType}`}><th scope="row">{categories[item.category] ?? item.category}</th><td>{pricingTypes[item.pricingType] ?? item.pricingType}</td><td>{count(item.volume)}</td><td>{whatsappUsageMoney(item.cost, data.currency)}</td></tr>)}
          {!data.pricing.categories.length && <tr><td colSpan={4}>{data.pricing.available ? "A Meta ainda não registrou consumo neste período." : "Detalhamento indisponível na Meta."}</td></tr>}</tbody></table></div>
        <p className="whatsapp-seller__hint">Os dados da Meta podem levar algum tempo para atualizar e representam custos estimados de mensagens. A fatura final, impostos e o método de pagamento ficam no faturamento da Meta.</p>
        <div className="whatsapp-usage__processing"><h3>Atendimento na Zyon</h3><dl><div><dt>Mensagens recebidas</dt><dd>{data.processing.received}</dd></div><div><dt>Processadas</dt><dd>{data.processing.processed}</dd></div><div><dt>Pendentes</dt><dd>{data.processing.pending}</dd></div><div><dt>Com falha</dt><dd>{data.processing.failed}</dd></div></dl><p>Contagem das mensagens recebidas e processadas pela Zyon no período. Ela não representa mensagens cobradas pela Meta.</p></div>
        <p className="whatsapp-seller__hint">Consulta realizada em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(data.fetchedAt))}. Atualização automática a cada minuto.</p>
      </>}
    </section>
    <section className="panel whatsapp-seller__panel"><h2>Cartão e faturamento da empresa</h2><p>Na cobrança direta, cada empresa cadastra o próprio cartão ou método de pagamento na sua conta WhatsApp Business, dentro da Meta. A assinatura da Zyon é cobrada separadamente.</p><p>Se a conta utiliza uma linha de crédito de parceiro, as condições de pagamento são as acordadas com esse parceiro. Confira a configuração da sua empresa no faturamento da Meta.</p>
      <div className="whatsapp-seller__actions"><a className="whatsapp-usage__link" href={data?.billingUrl ?? "https://business.facebook.com/billing_hub/"} target="_blank" rel="noopener noreferrer">Abrir faturamento da Meta <ExternalLink size={15} aria-hidden="true" /></a>{data && <a className="whatsapp-usage__link" href={data.managerUrl} target="_blank" rel="noopener noreferrer">Gerenciar WhatsApp Business <ExternalLink size={15} aria-hidden="true" /></a>}</div>
    </section>
  </section>;
}
