import React from "react";
import type { FunnelSession } from "../useFunnelPage.js";

interface ActiveSessionsListProps {
  sessions: FunnelSession[];
  loading?: boolean;
}

const STAGE_LABELS: Record<string, string> = {
  data_collection: "Coleta",
  shipping: "Frete",
  payment: "Pagamento",
  completed: "Confirmado",
};

function formatTime(isoString: string): string {
  if (!isoString) return "—";
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
  } catch {
    return "—";
  }
}

function maskEmail(email: string): string {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const masked = local.substring(0, 2) + "*".repeat(Math.max(local.length - 4, 1)) + local.substring(local.length - 2);
  return `${masked}@${domain}`;
}

export function ActiveSessionsList({ sessions, loading }: ActiveSessionsListProps): React.ReactElement {
  const riskClass = (score: number): string => {
    if (score < 0.3) return "risk-low";
    if (score < 0.7) return "risk-med";
    return "risk-high";
  };

  const riskLabel = (score: number): string => {
    if (score < 0.3) return "Baixo";
    if (score < 0.7) return "Médio";
    return "Alto";
  };

  return (
    <div className="funnel-sessions">
      <div className="funnel-sessions-header">
        <h2 className="funnel-sessions-title">Sessões ativas ({sessions.length})</h2>
      </div>

      {sessions.length === 0 && !loading ? (
        <div className="funnel-sessions-empty">Nenhuma sessão ativa no momento</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="funnel-sessions-table">
            <thead>
              <tr>
                <th>CELULAR</th>
                <th>E-MAIL</th>
                <th>NOME</th>
                <th>ETAPA</th>
                <th>ÚLTIMA ATIVIDADE</th>
                <th style={{ textAlign: "center" }}>RISCO</th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 20).map((s) => (
                <tr key={s.sessionId}>
                  <td>{s.buyerPhone || "—"}</td>
                  <td style={{ fontSize: "12px" }}>{maskEmail(s.buyerEmail)}</td>
                  <td>{s.buyerName || "—"}</td>
                  <td>
                    <span className="funnel-sessions-stage">{STAGE_LABELS[s.stage] ?? s.stage}</span>
                  </td>
                  <td style={{ color: "var(--muted)", fontSize: "12px" }}>{formatTime(s.lastActivityAt)}</td>
                  <td style={{ textAlign: "center" }}>
                    <span className={`funnel-sessions-risk ${riskClass(s.abandonmentScore)}`}>
                      {riskLabel(s.abandonmentScore)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
