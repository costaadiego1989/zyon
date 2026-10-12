import { useEffect, useState } from "react";
import { useApi } from "../../../hooks/useApi.js";
import { Button } from "../../../components/Button.js";
import type { DigitalOrderAccess } from "../../../api/endpoints/order.js";

const STATUS: Record<string, string> = {
  pending: "Aguardando envio", sending: "Envio em andamento", sent: "Aceito pelo provedor",
  blocked: "Envio bloqueado", uncertain: "Confirmação pendente", revoked: "Acesso indisponível",
};
const REASONS: Record<string, string> = {
  sandbox_fixture_transport_disabled: "Os envios deste pedido de demonstração estão desativados.",
  email_not_configured: "Configure o envio de email e tente novamente.",
  email_provider_rejected: "O provedor recusou o email. Confira o destinatário e a configuração antes de tentar novamente.",
  whatsapp_template_unavailable: "Conecte o WhatsApp e confira a aprovação do modelo de entrega digital antes de tentar novamente.",
  provider_acceptance_unknown: "Confira o envio no provedor antes de reenviar para evitar duplicidade.",
  digital_access_unavailable: "O acesso expirou ou o pedido não permite mais o download.",
};

export function DigitalOrderDelivery({ merchantId, orderId }: { merchantId: string; orderId: string }) {
  const api = useApi();
  const [data, setData] = useState<DigitalOrderAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void api.getDigitalOrderAccess(merchantId, orderId).then(result => { if (active) setData(result); })
      .catch(() => { if (active) setError("Não foi possível consultar a entrega digital deste pedido."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, merchantId, orderId, reload]);
  async function retry(id: string) {
    if (retrying) return;
    setRetrying(id); setError(null);
    try { await api.retryDigitalDelivery(merchantId, id); setReload(value => value + 1); }
    catch { setError("Não foi possível solicitar o envio. Atualize o status antes de tentar novamente."); }
    finally { setRetrying(null); }
  }
  if (!loading && !error && !data?.products.length) return null;
  return <section className="order-detail__digital" aria-label="Entrega digital" aria-busy={loading} style={{ padding: "16px 0", borderBottom: "1px solid var(--color-border)" }}>
    <h3 className="order-detail__section-title">Entrega digital</h3>
    {loading && <p role="status">Consultando os envios…</p>}
    {error && <p className="panel-error" role="alert">{error}</p>}
    {data?.products.map(product => <div key={product.id} style={{ marginTop: 12 }}>
      <strong>{product.name}</strong>
      <p>{product.status === "active" ? "Acesso disponível" : product.status === "expired" ? "Acesso expirado" : "Acesso indisponível"} · {product.downloadCount} acessos</p>
      <p>Válido até {new Date(product.expiresAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
      {product.deliveries.length === 0 && <p>O pedido não tem email ou telefone para enviar o acesso.</p>}
      {product.deliveries.map(delivery => <div key={delivery.id} style={{ marginTop: 8 }}>
        <p>{delivery.channel === "email" ? "Email" : "WhatsApp"}: {STATUS[delivery.status] ?? "Status indisponível"}</p>
        {delivery.reason && REASONS[delivery.reason] && <p>{REASONS[delivery.reason]}</p>}
        {delivery.status === "blocked" && product.status === "active" && <Button variant="outline" size="sm" disabled={loading || !!retrying} onClick={() => void retry(delivery.id)}>{retrying === delivery.id ? "Solicitando…" : "Tentar envio novamente"}</Button>}
      </div>)}
    </div>)}
    <p style={{ color: "var(--color-text-muted)", marginTop: 12 }}>O aceite do provedor não confirma que o comprador recebeu ou abriu a mensagem.</p>
    <Button variant="outline" size="sm" disabled={loading || !!retrying} onClick={() => setReload(value => value + 1)}>Atualizar status</Button>
  </section>;
}
