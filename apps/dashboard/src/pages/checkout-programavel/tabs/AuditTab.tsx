import React, { useEffect, useState, useCallback } from "react";
import { Shield } from "lucide-react";
import { SectionHeader } from "../../../components/SectionHeader.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { useApi } from "../../../hooks/useApi.js";
import type { M2MAuditEntry } from "../../../api/endpoints/m2m-management.js";

const OUTCOME_STYLE: Record<string, { bg: string; color: string }> = {
  success: { bg: "var(--color-success-bg)", color: "var(--color-success)" },
  failed: { bg: "var(--color-error-bg)", color: "var(--color-error)" },
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function AuditTab() {
  const api = useApi();
  const [entries, setEntries] = useState<M2MAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="panel">
      <SectionHeader variant="secondary" title="Log de Auditoria M2M" />

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>Carregando...</div>
      ) : entries.length === 0 ? (
        <EmptyState icon={Shield} title="Nenhuma ação registrada" description="Ações dos agentes M2M aparecerão aqui conforme interagirem com a API" />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="fnl-sessions-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Agente</th>
                <th>Ação</th>
                <th>Recurso</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const oc = OUTCOME_STYLE[e.outcome] ?? OUTCOME_STYLE.success;
                return (
                  <tr key={e.id}>
                    <td style={{ font: "12px var(--font-data)", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                      {formatTime(e.occurredAt)}
                    </td>
                    <td style={{ font: "12px var(--font-mono)", color: "var(--color-text-faint)" }}>
                      {e.actorType === "service" ? `🤖 ${e.actorId.slice(0, 12)}` : e.actorId.slice(0, 12)}
                    </td>
                    <td>
                      <code style={{ font: "11px var(--font-mono)", color: "var(--color-brand)", background: "color-mix(in srgb, var(--color-brand) 8%, transparent)", padding: "2px 6px", borderRadius: 4 }}>
                        {e.action}
                      </code>
                    </td>
                    <td style={{ font: "12px var(--font-mono)", color: "var(--color-text-muted)" }}>
                      {e.resourceId ? e.resourceId.slice(0, 16) : "—"}
                    </td>
                    <td>
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
    </div>
  );
}
