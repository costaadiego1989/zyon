import React from "react";
import type { FunnelSession } from "../useFunnelPage.js";

interface ActiveSessionsListProps {
  sessions: FunnelSession[];
  loading: boolean;
}

const STAGE_LABELS: Record<string, string> = {
  data_collection: "Cadastro",
  shipping: "Frete",
  payment: "Pagamento",
  completed: "Concluído",
};

export function ActiveSessionsList({ sessions, loading }: ActiveSessionsListProps): React.ReactElement {
  const riskClass = (score: number) =>
    score >= 0.7 ? "high" : score >= 0.3 ? "med" : "low";

  return (
    <div className="fnl-sessions-card">
      <div className="fnl-sessions-head">
        <h3 className="fnl-sessions-title">Sessões Ativas</h3>
        <span className="fnl-sessions-badge">{sessions.length}</span>
      </div>

      {sessions.length === 0 ? (
        <div className="fnl-sessions-empty">
          {loading ? "Carregando sessões..." : "Nenhuma sessão ativa no momento"}
        </div>
      ) : (
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
            {sessions.slice(0, 20).map((s) => (
              <tr key={s.sessionId}>
                <td style={{ fontFamily: "var(--font-data)", fontSize: 12 }}>
                  {s.buyerEmail || s.buyerPhone || s.sessionId.slice(0, 12)}
                </td>
                <td>
                  <span className="fnl-session-stage">
                    {STAGE_LABELS[s.stage] ?? s.stage}
                  </span>
                </td>
                <td style={{ fontFamily: "var(--font-data)", fontSize: 12, color: "var(--muted)" }}>
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
      )}
    </div>
  );
}
