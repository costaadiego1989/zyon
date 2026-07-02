import React, { useEffect, useState } from "react";
import { BarChart3, TrendingUp, DollarSign, Percent } from "lucide-react";
import type { NegotiationSession, NegotiationStats, CursorPage } from "../../api-client.js";

export type NegotiationApi = {
  getNegotiationStats(period?: string): Promise<NegotiationStats>;
  getNegotiationSessions(params?: { limit?: number; cursor?: string }): Promise<CursorPage<NegotiationSession>>;
};

type Period = "7d" | "30d" | "90d" | "all";

export function NegotiationOverviewTab({ api }: { api: NegotiationApi }) {
  const [stats, setStats] = useState<NegotiationStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("30d");

  const [sessions, setSessions] = useState<NegotiationSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsCursor, setSessionsCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    void loadStats();
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadSessions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadStats() {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const result = await api.getNegotiationStats(period);
      setStats(result && typeof result === "object" && !Array.isArray(result) ? result : null);
    } catch (e: any) {
      if (e?.status === 404 || e?.message?.includes("404")) {
        setStats(null);
      } else {
        setStatsError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setStatsLoading(false);
    }
  }

  async function loadSessions(cursor?: string) {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const result = await api.getNegotiationSessions({ limit: 20, cursor });
      const items = Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result as unknown as NegotiationSession[] : [];
      if (cursor) {
        setSessions((prev) => [...prev, ...items]);
      } else {
        setSessions(items);
      }
      setSessionsCursor(result?.next_cursor ?? undefined);
      setHasMore(result?.has_more ?? false);
    } catch (e: any) {
      if (e?.status === 404 || e?.message?.includes("404")) {
        setSessions([]);
      } else {
        setSessionsError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSessionsLoading(false);
    }
  }

  function handleLoadMore() {
    if (sessionsCursor) {
      void loadSessions(sessionsCursor);
    }
  }

  function formatCurrency(cents: number): string {
    return `R$ ${(cents / 100).toFixed(2)}`;
  }

  function formatPercent(value: number): string {
    return `${(value * 100).toFixed(0)}%`;
  }

  return (
    <div>
      {/* Period selector */}
      <div className="button-row" style={{ marginBottom: "var(--space-4)" }}>
        {(["7d", "30d", "90d", "all"] as Period[]).map((p) => (
          <button
            key={p}
            type="button"
            className={period === p ? "btn-primary" : ""}
            onClick={() => setPeriod(p)}
            aria-pressed={period === p}
          >
            {p === "all" ? "Tudo" : p}
          </button>
        ))}
      </div>

      {/* KPI Metrics */}
      {statsError && <p className="panel-warn">{statsError}</p>}
      <div className="metrics">
        <div className="metric">
          <div className="metric-icon"><BarChart3 size={18} /></div>
          <div className="metric-value">
            {statsLoading ? "—" : stats?.total_sessions ?? 0}
          </div>
          <div className="metric-label">Total de Sessões</div>
        </div>
        <div className="metric">
          <div className="metric-icon"><DollarSign size={18} /></div>
          <div className="metric-value">
            {statsLoading ? "—" : formatCurrency(stats?.total_ai_cost_cents ?? 0)}
          </div>
          <div className="metric-label">Custo IA Acumulado</div>
        </div>
        <div className="metric">
          <div className="metric-icon"><TrendingUp size={18} /></div>
          <div className="metric-value">
            {statsLoading ? "—" : formatPercent(stats?.agreement_rate ?? 0)}
          </div>
          <div className="metric-label">Taxa de Acordo</div>
        </div>
        <div className="metric">
          <div className="metric-icon"><Percent size={18} /></div>
          <div className="metric-value">
            {statsLoading ? "—" : `${(stats?.avg_discount_percent ?? 0).toFixed(1)}%`}
          </div>
          <div className="metric-label">Desconto Médio</div>
        </div>
      </div>

      {/* Sessions Table */}
      <section className="panel stacked" style={{ marginTop: "var(--space-6)" }}>
        <div className="panel-title">
          <h2>Sessões recentes</h2>
          {sessionsLoading && <span className="badge muted">carregando…</span>}
        </div>

        {sessionsError && <p className="panel-warn">{sessionsError}</p>}

        {!sessionsLoading && sessions.length === 0 && !sessionsError && (
          <div className="empty-state">
            <h3>Nenhuma sessão registrada</h3>
            <p>As sessões de negociação aparecerão aqui quando compradores interagirem com o motor.</p>
          </div>
        )}

        {sessions.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table" aria-label="Sessões de negociação">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Comprador</th>
                  <th>Acordo</th>
                  <th>Desconto</th>
                  <th>Custo IA</th>
                  <th>Criada em</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                      {s.id.slice(0, 12)}…
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                      {s.global_user_id?.slice(0, 12) ?? "—"}
                    </td>
                    <td>
                      <span className={`badge ${s.agreement ? "ok" : "muted"}`}>
                        {s.agreement ? "Sim" : "Não"}
                      </span>
                    </td>
                    <td>{s.selected_discount_percent.toFixed(1)}%</td>
                    <td>{formatCurrency(s.estimated_ai_cost_cents)}</td>
                    <td>{new Date(s.created_at).toLocaleDateString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasMore && (
          <div className="button-row" style={{ marginTop: "var(--space-4)" }}>
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={sessionsLoading}
            >
              {sessionsLoading ? "Carregando…" : "Carregar mais"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
