import { useCallback, useEffect, useState } from "react";
import { useApi } from "../../../hooks/useApi.js";
import { Button } from "../../../components/Button.js";

type Request = {
  id: string; status: string; customerName: string; customerEmail: string;
  customerPhone: string; total: number; note?: string;
  items: Array<{ variantId: string; productName: string; quantity: number }>;
};
const statusLabels: Record<string, string> = { pending: "Pendente", approved: "Aprovado", rejected: "Recusado", responded: "Respondido" };

export function BudgetRequests() {
  const api = useApi();
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const merchant = await api.merchantProfile();
      setRequests(await api.getBudgetRequests(merchant.id) as unknown as Request[]);
    } catch { setError("Não foi possível carregar as solicitações. Tente novamente."); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  async function update(id: string, status: "approved" | "rejected") {
    setBusy(id);
    setError(null);
    try {
      await api.updateBudgetRequestStatus(id, status);
      setRequests((current) => current.map((request) => request.id === id ? { ...request, status } : request));
    } catch { setError("Não foi possível atualizar o orçamento. Tente novamente."); }
    finally { setBusy(null); }
  }
  return <section aria-label="Solicitações de orçamento" style={{ marginTop: 24, borderTop: "1px solid var(--color-border)", paddingTop: 20 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <h3 style={{ fontSize: 15 }}>Solicitações de orçamento</h3>
      <Button variant="ghost" onClick={() => void load()} disabled={loading}>Atualizar</Button>
    </div>
    {error && <p role="alert">{error}</p>}
    {loading ? <p role="status">Carregando solicitações…</p> : requests.length === 0 ? <p>Nenhuma solicitação recebida.</p> : requests.map((request) => <details key={request.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--color-border)" }}>
      <summary style={{ cursor: "pointer" }}>{request.customerName} · {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(request.total)} · {statusLabels[request.status] ?? request.status}</summary>
      <p>{request.customerEmail} · {request.customerPhone}</p>
      <ul>{request.items.map((item, index) => <li key={`${item.variantId}-${index}`}>{item.quantity} × {item.productName}</li>)}</ul>
      {request.note && <p>{request.note}</p>}
      {request.status === "pending" && <div className="button-row">
        <Button variant="primary" disabled={busy !== null} onClick={() => void update(request.id, "approved")}>Aprovar orçamento</Button>
        <Button variant="ghost" disabled={busy !== null} onClick={() => void update(request.id, "rejected")}>Recusar orçamento</Button>
      </div>}
    </details>)}
  </section>;
}
