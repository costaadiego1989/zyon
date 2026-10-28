import { useEffect, useMemo, useState } from "react";
import { Bot, CircleAlert, CreditCard, LoaderCircle, X } from "lucide-react";
import { PlatformApi, PlatformApiError, type PlatformMerchant, type PlatformMerchantDetail } from "../lib/api.js";

export function MerchantDetailDrawer({ api, token, merchant, onClose, onSessionExpired }: { api: PlatformApi; token: string; merchant: PlatformMerchant | null; onClose: () => void; onSessionExpired: () => void }) {
  const [detail, setDetail] = useState<PlatformMerchantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!merchant) { setDetail(null); setError(null); return; }
    let active = true;
    setLoading(true); setError(null); setDetail(null);
    void api.getMerchantDetail(token, merchant.id).then(result => { if (active) setDetail(result); }).catch(caught => {
      if (!active) return;
      if (caught instanceof PlatformApiError && caught.status === 401) { onSessionExpired(); return; }
      setError(caught instanceof PlatformApiError && caught.status === 403 ? "Seu acesso não permite abrir os dados desta empresa." : "Não foi possível carregar os indicadores da empresa.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, merchant, onSessionExpired, token]);
  if (!merchant) return null;
  return <><button className="detail-drawer-backdrop" aria-label="Fechar detalhes da empresa" type="button" onClick={onClose} /><aside className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="merchant-detail-title">
    <header className="detail-drawer__header"><div><p className="eyebrow">Empresa</p><h2 id="merchant-detail-title">{merchant.name}</h2><span>{merchant.store_slug ? `/${merchant.store_slug}` : merchant.id}</span></div><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar detalhes"><X size={19} /></button></header>
    {loading ? <div className="detail-drawer__loading"><LoaderCircle className="spin" size={19} />Carregando indicadores…</div> : null}
    {error ? <div className="detail-drawer__error" role="alert"><CircleAlert size={18} /><p>{error}</p></div> : null}
    {detail ? <MerchantDetailContent detail={detail} /> : null}
  </aside></>;
}

function MerchantDetailContent({ detail }: { detail: PlatformMerchantDetail }) {
  const knownCost = formatMicros(detail.ai.knownCostMicros, "USD");
  const chatCost = formatMicros(detail.ai.chatKnownCostMicros, "USD");
  const voiceCost = formatMicros(detail.ai.voiceKnownCostMicros, "USD");
  const max = useMemo(() => Math.max(...detail.orders.series.map(point => point.totalMinor), 1), [detail.orders.series]);
  return <div className="detail-drawer__content">
    <dl className="detail-facts"><div><dt>Vendas no período</dt><dd>{formatMoney(detail.orders.periodTotalMinor, "BRL")}</dd><small>{detail.orders.periodCount} pedido(s)</small></div><div><dt>Vendas totais</dt><dd>{formatMoney(detail.orders.allTimeTotalMinor, "BRL")}</dd><small>{detail.orders.allTimeCount} pedido(s)</small></div><div><dt>Tokens de chat</dt><dd>{formatInteger(detail.ai.chatTokens)}</dd><small>capturados no período</small></div><div><dt>Tokens de voz</dt><dd>{formatInteger(detail.ai.voiceTokens)}</dd><small>Realtime Mini</small></div><div><dt>Custo estimado de chat</dt><dd>{chatCost}</dd><small>DeepSeek no periodo</small></div><div><dt>Custo estimado de voz</dt><dd>{voiceCost}</dd><small>GPT Realtime Mini</small></div><div><dt>Total estimado de IA</dt><dd>{knownCost}</dd><small>{detail.ai.unpricedEvents} evento(s) sem preço</small></div><div><dt>Cobrança</dt><dd>{billingLabel(detail)}</dd><small>{billingDetail(detail)}</small></div></dl>
    <section className="detail-section"><h3>Vendas por dia</h3>{detail.orders.series.length ? <ol className="mini-bars">{detail.orders.series.map(point => <li key={point.date}><time>{formatShortDate(point.date)}</time><meter min="0" max={max} value={point.totalMinor}>{formatMoney(point.totalMinor, "BRL")}</meter><strong>{formatMoney(point.totalMinor, "BRL")}</strong></li>)}</ol> : <p className="muted-copy">Nenhuma venda confirmada neste período.</p>}</section>
    <section className="detail-section"><h3>Pedidos recentes</h3>{detail.recentOrders.length ? <ol className="compact-record-list">{detail.recentOrders.map(order => <li key={order.id}><div><strong>{order.externalOrderId}</strong><small>{formatDate(order.completedAt)} · {order.status}</small></div><span>{formatMoney(order.totalMinor, order.currency)}</span></li>)}</ol> : <p className="muted-copy">Nenhum pedido registrado.</p>}</section>
    <section className="detail-section detail-section--billing"><h3><CreditCard size={16} />Situação de cobrança</h3><p>{detail.billing.overdueCount ? `${detail.billing.overdueCount} cobrança(s) vencida(s).` : "Sem cobrança vencida registrada."} {detail.billing.nextDueAt ? `Próximo vencimento: ${formatDate(detail.billing.nextDueAt)}.` : ""}</p></section>
    <section className="detail-section detail-section--ai"><h3><Bot size={16} />Leitura de custo</h3><p>DeepSeek usa tokens de entrada e saída; sem detalhes de cache, a entrada é estimada como não armazenada em cache. GPT Realtime Mini calcula texto e áudio separadamente. Valores permanecem estimados até a conciliação da fatura.</p></section>
  </div>;
}
function billingLabel(detail: PlatformMerchantDetail) { return detail.billing.status ?? "Sem assinatura"; }
function billingDetail(detail: PlatformMerchantDetail) { if (detail.billing.amountMinor === undefined) return detail.billing.openReceivableCount ? `${detail.billing.openReceivableCount} em aberto` : "Sem valor registrado"; return `${formatMoney(detail.billing.amountMinor, "BRL")}${detail.billing.cycle ? ` / ${detail.billing.cycle === "annual" ? "ano" : "mês"}` : ""}`; }
function formatMoney(value: number, currency: string) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 }).format(value / 100); }
function formatMicros(value: string, currency: string) { try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(BigInt(value) / 10_000n) / 100); } catch { return "Sem dados"; } }
function formatInteger(value: string) { try { return new Intl.NumberFormat("pt-BR").format(BigInt(value)); } catch { return "0"; } }
function formatDate(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function formatShortDate(value: string) { return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(`${value}T12:00:00-03:00`)); }
