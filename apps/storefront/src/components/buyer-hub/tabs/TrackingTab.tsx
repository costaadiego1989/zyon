"use client";

import { useState } from "react";
import { FiTruck, FiCheckCircle, FiPackage, FiCopy, FiCheck, FiExternalLink } from "react-icons/fi";
import type { BuyerPurchase, TrackingEvent } from "@/lib/viewmodels/useBuyerHub";
import styles from "./TrackingTab.module.css";

export interface TrackingTabProps {
  purchases: BuyerPurchase[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const labels: Record<string, string> = {
  pending: "Aguardando postagem", pendente: "Aguardando postagem", created: "Aguardando postagem",
  label_generated: "Etiqueta emitida", etiqueta_gerada: "Etiqueta emitida", processing: "Em preparação",
  dispatched: "Enviado", shipped: "Enviado", enviado: "Enviado", posted: "Postado",
  in_transit: "Em transporte", em_transito: "Em transporte", "in transit": "Em transporte",
  out_for_delivery: "Saiu para entrega", saiu_para_entrega: "Saiu para entrega",
  delivered: "Entregue", entregue: "Entregue", returned: "Devolvido", devolvido: "Devolvido",
  failed_attempt: "Tentativa de entrega", tentativa_falhou: "Tentativa de entrega",
  delivery_failed: "Entrega não concluída", exception: "Entrega com ocorrência",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cancelled = (status?: string | null) => /^(cancelled|canceled|cancelado)$/i.test(status?.trim() ?? "");
const delivered = (status?: string | null) => /^(delivered|entregue)$/i.test(status?.trim() ?? "");
const returned = (status?: string | null) => /^(returned|devolvido)$/i.test(status?.trim() ?? "");
const statusLabel = (status?: string | null, fallback = "Rastreamento disponível") => labels[status?.trim().toLowerCase() ?? ""] ?? fallback;
const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const validDate = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

function hasRealCode(value?: string | null): value is string {
  if (typeof value !== "string") return false;
  const code = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9 -]{3,99}$/.test(code) && !uuid.test(code) && !/^pending\b/i.test(code);
}

function carrierName(value?: string | null): string | null {
  const carrier = value?.trim();
  if (!carrier || uuid.test(carrier) || /^(flat[-_ ]rate|free[-_ ]shipping|frete[-_ ]fixo|entrega[-_ ]gr[aá]tis|internal|pending|manual|pickup|retirada)(\b|:)/i.test(carrier)) return null;
  const known: Record<string, string> = { correios: "Correios", "melhor-envio": "Melhor Envio", melhor_envio: "Melhor Envio", jadlog: "Jadlog", loggi: "Loggi", dhl: "DHL", fedex: "FedEx", ups: "UPS" };
  return known[carrier.toLowerCase()] ?? (/^[\p{L}\p{N} .&+-]{2,80}$/u.test(carrier) ? carrier : null);
}

function trackingLink(value?: string | null): URL | null {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value.trim())) return null;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.username || url.password || !host.includes(".") || host.includes(":") ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || /(?:^|\.)(localhost|local|internal)$/.test(host)) return null;
    return url;
  } catch { return null; }
}

function Timeline({ events }: { events: TrackingEvent[] }) {
  return <ol className={styles.timeline} aria-label="Histórico da entrega">{events.map((event, index) => <li className={styles.event} key={`${event.occurred_at}-${index}`}>
    <h5>{statusLabel(event.status, "Atualização registrada")}</h5>
    <time dateTime={event.occurred_at}>{dateTime.format(new Date(event.occurred_at))}</time>
    {event.location && <p>{event.location}</p>}
    {event.description && event.description !== statusLabel(event.status) && <p>{event.description}</p>}
  </li>)}</ol>;
}

function Shipment({ purchase }: { purchase: BuyerPurchase }) {
  const [copied, setCopied] = useState<"success" | "failed" | null>(null);
  const code = purchase.tracking_code!.trim();
  const merchant = purchase.merchant_name?.trim() && !uuid.test(purchase.merchant_name.trim()) ? purchase.merchant_name.trim() : "Loja";
  const carrier = carrierName(purchase.carrier);
  const link = trackingLink(purchase.tracking_url);
  const events = (purchase.tracking_events ?? []).filter((event) => event && validDate(event.occurred_at))
    .slice().sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  const isDelivered = delivered(purchase.tracking_status);
  async function copyCode() {
    try { await navigator.clipboard.writeText(code); setCopied("success"); }
    catch { setCopied("failed"); }
  }
  return <article className={styles.shipment} aria-label={`Entrega de ${merchant}`}>
    <div className={styles.topline}>
      <span className={styles.merchant}>{merchant}</span>
      {validDate(purchase.created_at) && <span className={styles.date}>Compra em <time dateTime={purchase.created_at}>{date.format(new Date(purchase.created_at))}</time></span>}
    </div>
    <h4 className={`${styles.status} ${isDelivered ? styles.delivered : ""}`}>
      {isDelivered ? <FiCheckCircle size={19} aria-hidden="true" /> : <FiTruck size={19} aria-hidden="true" />}
      {statusLabel(purchase.tracking_status)}
    </h4>
    <ul className={styles.items} aria-label="Itens desta entrega">{purchase.tracking_items!.map((item, index) => <li key={index}>
      {item.quantity} × {item.name}
    </li>)}</ul>
    <div className={styles.codeRow}>
      <div className={styles.codeLabel}><span>Código de rastreio</span><code className={styles.code}>{code}</code></div>
      <button type="button" className={styles.button} data-neu="control" onClick={copyCode} aria-label={`Copiar código de rastreio ${code}`}>
        {copied === "success" ? <FiCheck size={14} aria-hidden="true" /> : <FiCopy size={14} aria-hidden="true" />}
        {copied === "success" ? "Copiado" : "Copiar"}
      </button>
    </div>
    <p className={styles.copyStatus} role="status">{copied === "success" ? "Código copiado." : copied === "failed" ? "Não foi possível copiar. Selecione o código para copiá-lo." : null}</p>
    {carrier && <p className={styles.carrier}>Transportadora: {carrier}</p>}
    {events.length > 0 ? events.length <= 3 ? <Timeline events={events} /> : <>
      <Timeline events={events.slice(0, 1)} />
      <details className={styles.details}><summary>Ver histórico completo</summary><Timeline events={events.slice(1)} /></details>
    </> : <p className={styles.note} style={{ marginTop: 16 }}>Ainda não há atualizações de transporte para este código.</p>}
    {link && <>
      <a className={styles.link} href={link.href} target="_blank" rel="noopener noreferrer">
        Acompanhar entrega <FiExternalLink size={14} aria-hidden="true" />
      </a>
      <span className={styles.externalHost}>Abre em {link.hostname}</span>
    </>}
  </article>;
}

export function TrackingTab({ purchases, loading = false, error, onRetry }: TrackingTabProps) {
  // Presence of a code is not proof of physical fulfillment. The authenticated
  // API must explicitly confirm this delivery and its physical item projection.
  const eligible = purchases.filter((purchase) => purchase.has_tracking === true && !cancelled(purchase.tracking_status) &&
    hasRealCode(purchase.tracking_code) && Array.isArray(purchase.tracking_items) && purchase.tracking_items.length > 0 &&
    purchase.tracking_items.every((item) => typeof item.name === "string" && item.name.trim() && Number.isSafeInteger(item.quantity) && item.quantity > 0));
  const sections = [
    { title: "Em andamento", items: eligible.filter((purchase) => !delivered(purchase.tracking_status) && !returned(purchase.tracking_status)) },
    { title: "Entregues", items: eligible.filter((purchase) => delivered(purchase.tracking_status)) },
    { title: "Devolvidas", items: eligible.filter((purchase) => returned(purchase.tracking_status)) },
  ];
  return <div className={styles.root}>
    <header className={styles.header}><h2>Suas entregas</h2><p className={styles.note}>Acompanhe o envio e as atualizações da transportadora.</p></header>
    {loading ? <div className={styles.loading} role="status" aria-busy="true">
      <p className={styles.note}>Carregando suas entregas…</p>
      {[0, 1, 2].map((value) => <div className={styles.skeleton} key={value} aria-hidden="true" />)}
    </div> : error ? <div className={styles.error} role="alert">
      <h3>Não foi possível carregar suas entregas.</h3>
      <p className={styles.note}>Tente atualizar para consultar o rastreamento.</p>
      {onRetry && <button type="button" className={styles.button} data-neu="control" onClick={onRetry}>Tentar novamente</button>}
    </div> : eligible.length === 0 ? <div className={styles.empty} role="status">
      <FiPackage size={25} aria-hidden="true" />
      <h3>Nenhuma entrega com rastreio</h3>
      <p className={styles.note}>Envios físicos aparecem aqui quando há um código de rastreio válido. Consulte os demais pedidos na aba Pedidos.</p>
    </div> : sections.filter((section) => section.items.length > 0).map((section) => <section className={styles.section} key={section.title} aria-label={section.title}>
      <h3>{section.title}</h3>
      {section.items.map((purchase) => <Shipment key={`${purchase.id}-${purchase.tracking_code}`} purchase={purchase} />)}
    </section>)}
  </div>;
}
