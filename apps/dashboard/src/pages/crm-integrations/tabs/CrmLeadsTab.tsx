import React, { useMemo, useState } from "react";
import { Users, UserPlus, ShoppingBag } from "lucide-react";
import type { CrmSyncLogDTO } from "../useIntegrationsPage.js";

interface CrmLeadsTabProps {
  syncLog: CrmSyncLogDTO[];
}

type StageFilter = "all" | "lead" | "customer";
type StatusFilter = "all" | "success" | "failed";

const PAGE_SIZE = 20;

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="panel" style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ color: "var(--color-brand)", display: "flex" }}>{icon}</span>
      <div>
        <div style={{ font: "700 20px var(--font-sans)", color: "var(--color-text)" }}>{value}</div>
        <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>{label}</div>
      </div>
    </div>
  );
}

export function CrmLeadsTab({ syncLog }: CrmLeadsTabProps) {
  const [stage, setStage] = useState<StageFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const totals = useMemo(() => ({
    total: syncLog.length,
    leads: syncLog.filter((r) => r.stage === "lead").length,
    customers: syncLog.filter((r) => r.stage === "customer").length,
  }), [syncLog]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return syncLog.filter((r) => {
      if (stage !== "all" && r.stage !== stage) return false;
      if (status !== "all" && r.status !== status) return false;
      if (q && !r.email.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [syncLog, stage, status, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Reset to page 1 whenever a filter narrows the set below the current page.
  React.useEffect(() => { setPage(1); }, [stage, status, search]);

  const selectStyle: React.CSSProperties = {
    padding: "7px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--color-border)",
    background: "var(--surface-1)",
    color: "var(--color-text)",
    font: "13px var(--font-sans)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Stats */}
      <div className="grid-3" style={{ gap: 12 }}>
        <StatCard label="Total sincronizado" value={totals.total} icon={<Users size={18} />} />
        <StatCard label="Leads (só cadastro)" value={totals.leads} icon={<UserPlus size={18} />} />
        <StatCard label="Clientes (compraram)" value={totals.customers} icon={<ShoppingBag size={18} />} />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          placeholder="Buscar por e-mail..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...selectStyle, flex: "1 1 220px", fontFamily: "var(--font-mono)", fontSize: 12 }}
        />
        <select value={stage} onChange={(e) => setStage(e.target.value as StageFilter)} style={selectStyle} aria-label="Filtrar por tipo">
          <option value="all">Todos os tipos</option>
          <option value="lead">Apenas leads</option>
          <option value="customer">Apenas clientes</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} style={selectStyle} aria-label="Filtrar por status">
          <option value="all">Todos os status</option>
          <option value="success">Enviados (OK)</option>
          <option value="failed">Com falha</option>
        </select>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="panel" style={{ padding: "28px 20px", textAlign: "center", color: "var(--color-text-muted)", font: "13px var(--font-sans)" }}>
          {syncLog.length === 0
            ? "Nenhum lead sincronizado ainda. Conecte um CRM — os contatos aparecem aqui conforme os compradores se identificam e compram."
            : "Nenhum registro corresponde aos filtros."}
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Contato</th>
                  <th>Tipo</th>
                  <th>CRM</th>
                  <th>Status</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{row.email}</td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 999,
                          font: "600 11px var(--font-sans)",
                          background: row.stage === "customer" ? "var(--accent-soft)" : "var(--surface-2)",
                          color: row.stage === "customer" ? "var(--color-brand)" : "var(--color-text-muted)",
                          border: "1px solid var(--color-border)",
                        }}
                      >
                        {row.stage === "customer" ? "Cliente" : "Lead"}
                      </span>
                    </td>
                    <td style={{ textTransform: "capitalize" }}>{row.provider}</td>
                    <td>
                      <span style={{ color: row.status === "success" ? "var(--color-brand)" : "var(--color-danger, #dc2626)" }}>
                        {row.status === "success" ? "OK" : "Falhou"}
                      </span>
                    </td>
                    <td style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                      {new Date(row.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pageCount > 1 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
                {filtered.length} registro{filtered.length !== 1 ? "s" : ""} · página {safePage} de {pageCount}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  style={{ ...selectStyle, cursor: safePage <= 1 ? "not-allowed" : "pointer", opacity: safePage <= 1 ? 0.4 : 1 }}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={safePage >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  style={{ ...selectStyle, cursor: safePage >= pageCount ? "not-allowed" : "pointer", opacity: safePage >= pageCount ? 0.4 : 1 }}
                >
                  Próxima
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
