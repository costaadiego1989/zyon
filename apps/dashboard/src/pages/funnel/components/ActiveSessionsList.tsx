import React, { useState } from "react";
import { Activity } from "lucide-react";
import { DataPanel } from "../../../components/DataPanel.js";
import type { FunnelSession } from "../useFunnelPage.js";

interface ActiveSessionsListProps {
  sessions: FunnelSession[];
  loading: boolean;
}

const PAGE_SIZE = 10;

const STAGE_LABELS: Record<string, string> = {
  checkout_started: "Início",
  data_collection: "Cadastro",
  auth_completed: "Identificação",
  shipping: "Frete",
  payment: "Pagamento",
  completed: "Concluído",
};

export function ActiveSessionsList({ sessions, loading }: ActiveSessionsListProps): React.ReactElement {
  const [page, setPage] = useState(1);
  const pageItems = sessions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <DataPanel
      title="Sessões Ativas"
      trailing={<span style={{ font: "600 11px var(--font-mono)", color: "var(--color-brand)", background: "var(--color-brand-subtle)", padding: "2px 8px", borderRadius: "var(--radius-full)" }}>{sessions.length}</span>}
      page={page}
      pageSize={PAGE_SIZE}
      total={sessions.length}
      onPageChange={setPage}
      isEmpty={!loading && sessions.length === 0}
      empty={{ icon: Activity, title: "Nenhuma sessão ativa no momento", description: "Sessões aparecerão aqui quando compradores estiverem no checkout." }}
    >
      {loading && sessions.length === 0 ? (
        <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>Carregando sessões...</div>
      ) : sessions.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Comprador</th>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Etapa</th>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Última atividade</th>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Risco</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((s, i) => {
                const lastActivityDate = s.lastActivityAt ? new Date(s.lastActivityAt) : null;
                const dateStr = lastActivityDate && !isNaN(lastActivityDate.getTime())
                  ? lastActivityDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
                  : "—";

                const riskPct = typeof s.abandonmentScore === "number" && !isNaN(s.abandonmentScore)
                  ? `${Math.round(s.abandonmentScore * 100)}%`
                  : "—";

                const riskScore = typeof s.abandonmentScore === "number" ? s.abandonmentScore : 0;

                return (
                  <tr key={s.sessionId} style={{ borderBottom: i < pageItems.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined }}>
                    <td style={{ padding: "12px 20px", font: "12px var(--font-data)", color: "var(--color-text)" }}>
                      {s.buyerEmail || s.buyerPhone || (s as any).buyerHint || s.sessionId.slice(0, 16)}
                    </td>
                    <td style={{ padding: "12px 20px" }}>
                      <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", font: "600 10px var(--font-mono)", background: "var(--surface-2)", color: "var(--color-text-muted)" }}>
                        {STAGE_LABELS[s.stage] ?? s.stage}
                      </span>
                    </td>
                    <td style={{ padding: "12px 20px", font: "12px var(--font-data)", color: "var(--color-text-muted)" }}>
                      {dateStr}
                    </td>
                    <td style={{ padding: "12px 20px" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        font: "600 11px var(--font-data)",
                        color: riskScore >= 0.7 ? "var(--color-error)" : riskScore >= 0.3 ? "var(--color-warning)" : "var(--color-success)",
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
                        {riskPct}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </DataPanel>
  );
}
