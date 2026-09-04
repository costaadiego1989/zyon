import React, { useEffect, useState, useCallback } from "react";
import { Shield } from "lucide-react";
import { DataPanel } from "../../../components/DataPanel.js";
import { useApi } from "../../../hooks/useApi.js";
import type { M2MAuditEntry } from "../../../api/endpoints/m2m-management.js";

const OUTCOME_STYLE: Record<string, { bg: string; color: string }> = {
  success: { bg: "var(--color-success-bg)", color: "var(--color-success)" },
  failed: { bg: "var(--color-error-bg)", color: "var(--color-error)" },
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const PAGE_SIZE = 10;

export function AuditTab() {
  const api = useApi();
  const [entries, setEntries] = useState<M2MAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getM2MAuditLog({ limit: 50, resourceType: "m2m" });
      setEntries(res.data);
    } catch {
      // non-blocking
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const slice = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <DataPanel
      title="Log de Auditoria M2M"
      page={page}
      pageSize={PAGE_SIZE}
      total={entries.length}
      onPageChange={setPage}
      isEmpty={!loading && entries.length === 0}
      empty={{ icon: Shield, title: "Nenhuma ação registrada", description: "Ações dos agentes M2M aparecerão aqui conforme interagirem com a API" }}
    >
      {loading ? (
        <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>Carregando...</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Data</th>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Agente</th>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Ação</th>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Recurso</th>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((e, i) => {
                const oc = OUTCOME_STYLE[e.outcome] ?? OUTCOME_STYLE.success;
                return (
                  <tr key={e.id} style={{ borderBottom: i < slice.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined }}>
                    <td style={{ padding: "12px 20px", font: "12px var(--font-data)", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                      {formatTime(e.occurredAt)}
                    </td>
                    <td style={{ padding: "12px 20px", font: "12px var(--font-mono)", color: "var(--color-text-faint)" }}>
                      {e.actorType === "service" ? `🤖 ${e.actorId.slice(0, 12)}` : e.actorId.slice(0, 12)}
                    </td>
                    <td style={{ padding: "12px 20px" }}>
                      <code style={{ font: "11px var(--font-mono)", color: "var(--color-brand)", background: "color-mix(in srgb, var(--color-brand) 8%, transparent)", padding: "2px 6px", borderRadius: 4 }}>
                        {e.action}
                      </code>
                    </td>
                    <td style={{ padding: "12px 20px", font: "12px var(--font-mono)", color: "var(--color-text-muted)" }}>
                      {e.resourceId ? e.resourceId.slice(0, 16) : "—"}
                    </td>
                    <td style={{ padding: "12px 20px" }}>
                      <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", font: "600 10px var(--font-mono)", background: oc.bg, color: oc.color }}>
                        {e.outcome === "success" ? "OK" : "FALHA"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </DataPanel>
  );
}
