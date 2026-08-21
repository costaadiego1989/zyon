import React, { useState } from "react";
import { Activity } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState.js";
import { SectionHeader } from "../../../components/SectionHeader.js";
import type { FunnelSession } from "../useFunnelPage.js";

interface ActiveSessionsListProps {
  sessions: FunnelSession[];
  loading: boolean;
}

const PAGE_SIZE = 10;

const STAGE_LABELS: Record<string, string> = {
  data_collection: "Cadastro",
  shipping: "Frete",
  payment: "Pagamento",
  completed: "Concluído",
};

export function ActiveSessionsList({ sessions, loading }: ActiveSessionsListProps): React.ReactElement {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE));
  const pageItems = sessions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const riskClass = (score: number) =>
    score >= 0.7 ? "high" : score >= 0.3 ? "med" : "low";

  return (
    <div className="fnl-sessions-card">
      <SectionHeader
        variant="secondary"
        title="Sessões Ativas"
        trailing={<span className="fnl-sessions-badge">{sessions.length}</span>}
      />

      {sessions.length === 0 ? (
        loading ? (
          <div className="fnl-sessions-empty">Carregando sessões...</div>
        ) : (
          <EmptyState icon={Activity} title="Nenhuma sessão ativa no momento" description="Sessões aparecerão aqui quando compradores estiverem no checkout." />
        )
      ) : (
        <>
          <table className="fnl-sessions-table">
            <thead>
              <tr>
                <th>Comprador</th>
                <th>Etapa</th>
                <th>Última atividade</th>
                <th>Risco</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((s) => (
                <tr key={s.sessionId}>
                  <td style={{ fontFamily: "var(--font-data)", fontSize: 12 }}>
                    {s.buyerEmail || s.buyerPhone || s.sessionId.slice(0, 16)}
                  </td>
                  <td>
                    <span className="fnl-session-stage">
                      {STAGE_LABELS[s.stage] ?? s.stage}
                    </span>
                  </td>
                  <td style={{ fontFamily: "var(--font-data)", fontSize: 12, color: "var(--color-text-muted)" }}>
                    {new Date(s.lastActivityAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td>
                    <span className={`fnl-session-risk ${riskClass(s.abandonmentScore)}`}>
                      <span className="fnl-session-risk-dot" />
                      {(s.abandonmentScore * 100).toFixed(0)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="fnl-sessions-pagination">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
              >
                ← Anterior
              </button>
              <span>{page + 1} / {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
              >
                Próxima →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
