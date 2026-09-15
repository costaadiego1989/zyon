import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { Button } from "../../components/Button.js";

export function WhatsAppDeliveryIssues() {
  const api = useApi();
  const [issues, setIssues] = useState<Array<{ id: string; state: string; updatedAt: string }>>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getWhatsAppDeliveryIssues().then(rows => { if (active) { setIssues(rows); setError(false); } })
      .catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, attempt]);
  if (loading) return <p role="status">Consultando entregas do WhatsApp…</p>;
  if (!error && !issues.length) return null;
  return <section className="panel whatsapp-seller__panel" aria-labelledby="whatsapp-delivery-heading">
    <h2 id="whatsapp-delivery-heading">Mensagens que precisam de conferência</h2>
    {error ? <p role="alert">Não foi possível consultar as entregas.</p> : <>
      <p>A conversa fica aguardando conferência para evitar respostas ou operações repetidas. A confirmação de entrega da Meta atualiza o estado automaticamente quando estiver disponível.</p>
      <p>Se a pendência continuar, informe a referência abaixo ao suporte da Zyon.</p>
      <ul>{issues.map(issue => <li key={issue.id} style={{ overflowWrap: "anywhere", marginBottom: 12 }}>
        <strong>{issue.state === "submission_unknown" ? "Aguardando confirmação de envio" : "Processamento interrompido"}</strong>
        <div>Referência: <code>{issue.id}</code></div>
        <time dateTime={issue.updatedAt}>{new Date(issue.updatedAt).toLocaleString("pt-BR")}</time>
      </li>)}</ul>
    </>}
    <Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Atualizar entregas</Button>
  </section>;
}
