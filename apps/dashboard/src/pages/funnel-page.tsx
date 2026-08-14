import React, { useEffect, useState } from "react";
import type { MerchantProfile } from "../api-client.js";

interface FunnelStage {
  stage: "data_collection" | "shipping" | "payment" | "completed";
  count: number;
  percentage: number;
  label: string;
}

interface FunnelSession {
  sessionId: string;
  buyerPhone: string;
  buyerEmail: string;
  buyerName: string;
  stage: "data_collection" | "shipping" | "payment" | "completed";
  lastActivityAt: string;
  abandonmentScore: number;
}

const STAGE_LABELS: Record<string, string> = {
  data_collection: "Coleta",
  shipping: "Frete",
  payment: "Pagamento",
  completed: "Confirmado",
};

function formatTime(isoString: string): string {
  if (!isoString) return "-";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function FunnelPage(_props: { apiBaseUrl: string; me: MerchantProfile }): React.ReactElement {
  const [stages] = useState<FunnelStage[]>([
    { stage: "data_collection", count: 0, percentage: 0, label: "Celular / Cadastro" },
    { stage: "shipping", count: 0, percentage: 0, label: "Frete" },
    { stage: "payment", count: 0, percentage: 0, label: "Pagamento" },
    { stage: "completed", count: 0, percentage: 0, label: "Pedido confirmado" },
  ]);
  const [sessions] = useState<FunnelSession[]>([]);

  return (
    <div style={{ padding: "28px 32px", background: "var(--bg)", minHeight: "100vh", fontFamily: "var(--sans)" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: "22px", fontWeight: 600, color: "var(--ink)", marginBottom: 8 }}>
            Funil de Conversao
          </h1>
          <p style={{ fontSize: "13px", color: "var(--muted)" }}>
            Acompanhe o progresso dos visitantes em cada etapa do checkout
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
          {stages.map((s) => (
            <div
              key={s.stage}
              style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px" }}
            >
              <div style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600, marginBottom: 8 }}>
                {s.label}
              </div>
              <div style={{ fontSize: "28px", fontWeight: 600, color: "var(--accent)", marginBottom: 4 }}>
                {s.count}
              </div>
              <div style={{ height: 6, background: "var(--faint)", borderRadius: 3, overflow: "hidden", marginTop: 8 }}>
                <div style={{ height: "100%", background: "var(--accent)", width: `${s.percentage}%` }} />
              </div>
              <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: 6 }}>
                {s.percentage.toFixed(0)}% da etapa
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
            <h2 style={{ fontSize: "14px", fontWeight: 600, color: "var(--ink)", margin: 0 }}>
              Sessoes ativas ({sessions.length})
            </h2>
          </div>

          {sessions.length === 0 ? (
            <div style={{ padding: "32px", textAlign: "center", color: "var(--muted)", fontSize: "13px" }}>
              Nenhuma sessao ativa no ultimo horario.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600, color: "var(--muted)", fontSize: "11px" }}>CELULAR</th>
                    <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600, color: "var(--muted)", fontSize: "11px" }}>E-MAIL</th>
                    <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600, color: "var(--muted)", fontSize: "11px" }}>NOME</th>
                    <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600, color: "var(--muted)", fontSize: "11px" }}>ETAPA</th>
                    <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600, color: "var(--muted)", fontSize: "11px" }}>ULTIMA ATIVIDADE</th>
                    <th style={{ textAlign: "center", padding: "12px 16px", fontWeight: 600, color: "var(--muted)", fontSize: "11px" }}>RISCO</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.slice(0, 20).map((session) => (
                    <tr key={session.sessionId} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "12px 16px", color: "var(--ink)" }}>{session.buyerPhone || "-"}</td>
                      <td style={{ padding: "12px 16px", color: "var(--ink)", fontSize: "12px" }}>{session.buyerEmail || "-"}</td>
                      <td style={{ padding: "12px 16px", color: "var(--ink)" }}>{session.buyerName || "-"}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <span style={{ display: "inline-block", padding: "4px 8px", borderRadius: 6, background: "var(--accent-soft)", color: "var(--accent)", fontSize: "11px", fontWeight: 600 }}>
                          {STAGE_LABELS[session.stage] || session.stage}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", color: "var(--muted)", fontSize: "12px" }}>{formatTime(session.lastActivityAt)}</td>
                      <td style={{ padding: "12px 16px", textAlign: "center" }}>
                        <span style={{ fontSize: "11px", fontWeight: 600, color: session.abandonmentScore > 0.7 ? "var(--danger)" : session.abandonmentScore > 0.4 ? "var(--warn)" : "var(--good)" }}>
                          {(session.abandonmentScore * 100).toFixed(0)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
