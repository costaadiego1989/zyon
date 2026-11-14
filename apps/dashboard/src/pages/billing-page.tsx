import React, { useEffect, useState } from "react";
import { Receipt, ExternalLink } from "lucide-react";
import type { BillingSubscription, MerchantProfile } from "../api-client.js";
import type { BillingInvoice } from "../api/endpoints/billing.js";
import { useApi } from "../hooks/useApi.js";
import { PageHeader } from "../components/PageHeader.js";
import { Button } from "../components/Button.js";
import { DataPanel } from "../components/DataPanel.js";
import { EmptyState } from "../components/EmptyState.js";
import { FormSelect } from "../components/FormField.js";
import "./billing-history.css";

const STATUS: Record<string, string> = { paid: "Paga", pending: "Pendente", open: "Em aberto", overdue: "Em atraso", void: "Cancelada", uncollectible: "Não cobrada", draft: "Rascunho" };
const SUB_STATUS: Record<string, string> = { active: "Ativa", trialing: "Em teste", past_due: "Em atraso", canceled: "Cancelada", cancelled: "Cancelada", unpaid: "Pagamento pendente", incomplete: "Pendente" };
function date(value: string) { const d = new Date(value); return Number.isNaN(d.getTime()) ? "Não informada" : d.toLocaleDateString("pt-BR"); }
function invoiceLink(value?: string) { try { const url = new URL(value ?? ""); return ["https:", "http:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } }

export function BillingPage({ me }: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useApi();
  const [subscription, setSubscription] = useState<BillingSubscription | null>(null);
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [invoiceError, setInvoiceError] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    if (!me) return;
    let alive = true;
    setLoading(true);
    setInvoiceError(false);
    setSubscriptionError(false);
    setSubscription(null);
    setInvoices([]);
    setPage(1);
    void Promise.allSettled([api.getBillingSubscription(), api.listBillingInvoices()]).then(([sub, bills]) => {
      if (!alive) return;
      if (sub.status === "fulfilled") setSubscription(sub.value); else setSubscriptionError(true);
      if (bills.status === "fulfilled" && Array.isArray(bills.value)) setInvoices(bills.value); else setInvoiceError(true);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [api, me?.id, attempt]);
  const filtered = invoices.filter(invoice => !filter || invoice.status === filter);
  const provider = subscription?.billing_provider?.toLowerCase();
  const unsupported = provider && provider !== "stripe" && invoices.length === 0;
  return <div className="billing-history">
    <PageHeader title="Histórico de cobranças" description="Consulte as faturas da assinatura. Para trocar de plano ou atualizar o pagamento, acesse Planos e assinatura." actions={<a href="#billing-plans" className="btn btn-outline">Gerenciar plano</a>} />
    {!me ? <EmptyState icon={Receipt} title="Entre para consultar as cobranças" description="Use a conta responsável pela assinatura da loja." /> : <>
      {subscription && <div className="billing-history__summary"><div><span className="billing-history__label">Assinatura atual</span><strong>{subscription.plan_name ?? subscription.plan}</strong></div><span className="badge muted">{SUB_STATUS[subscription.status] ?? "Status em consulta"}</span><p>Limites, consumo e alterações de plano ficam em Planos e assinatura.</p></div>}
      {subscriptionError && <div className="billing-history__notice" role="alert">Não foi possível consultar a assinatura. <Button variant="outline" size="sm" onClick={() => setAttempt(a => a + 1)}>Tentar novamente</Button></div>}
      {!loading && !invoiceError && !unsupported && invoices.length > 0 && <div className="billing-history__filters"><FormSelect label="Status da fatura" value={filter} onChange={value => { setFilter(value); setPage(1); }} options={[{ value: "", label: "Todos os status" }, ...[...new Set(invoices.map(i => i.status))].map(status => ({ value: status, label: STATUS[status] ?? "Outro status" }))]} /><p>{filtered.length} {filtered.length === 1 ? "fatura disponível" : "faturas disponíveis"} nesta consulta</p></div>}
      <DataPanel title="Faturas da assinatura" page={!loading && !invoiceError && !unsupported ? page : undefined} pageSize={10} total={filtered.length} onPageChange={setPage}>
        {loading ? <p className="billing-history__notice" role="status">Consultando cobranças…</p> : invoiceError ? <div className="billing-history__notice" role="alert"><p>Não foi possível carregar as faturas. Tente novamente para consultar o histórico.</p><Button variant="outline" onClick={() => setAttempt(a => a + 1)}>Tentar novamente</Button></div> : unsupported ? <EmptyState icon={Receipt} title="Histórico deste provedor indisponível aqui" description="Esta consulta exibe faturas do Stripe. Consulte a assinatura em Planos e assinatura para gerenciar seu pagamento." /> : filtered.length === 0 ? <EmptyState icon={Receipt} title={filter ? "Nenhuma fatura neste status" : "Nenhuma fatura disponível"} description={filter ? "Escolha outro status para consultar as cobranças retornadas." : "Não há faturas retornadas pelo provedor nesta consulta."} action={filter ? <Button variant="outline" onClick={() => setFilter("")}>Limpar filtro</Button> : undefined} /> : <div className="billing-history__table"><table><caption className="sr-only">Faturas retornadas pelo provedor de cobrança</caption><thead><tr><th>Período</th><th>Emissão</th><th>Valor</th><th>Status</th><th>Documento</th></tr></thead><tbody>{filtered.slice((page - 1) * 10, page * 10).map(invoice => {
          const url = invoiceLink(invoice.invoice_url);
          return <tr key={invoice.invoice_id}><td>{date(invoice.period_start)} a {date(invoice.period_end)}</td><td>{date(invoice.created_at)}</td><td className="billing-history__amount">{Number.isFinite(invoice.amount_brl) ? invoice.amount_brl.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "Não informado"}</td><td><span className={`badge ${invoice.status === "paid" ? "ok" : ["overdue", "pending", "open"].includes(invoice.status) ? "warn" : "muted"}`}>{STATUS[invoice.status] ?? "Status indisponível"}</span></td><td>{url ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir fatura de ${date(invoice.created_at)} em nova aba`}>Abrir fatura <ExternalLink size={13} aria-hidden="true" /></a> : <span>Sem documento</span>}</td></tr>;
        })}</tbody></table></div>}
      </DataPanel>
    </>}
  </div>;
}
