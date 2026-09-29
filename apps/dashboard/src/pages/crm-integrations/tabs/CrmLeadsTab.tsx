import React, { useMemo, useState } from "react";
import { Users, UserPlus, ShoppingBag } from "lucide-react";
import type { CrmSyncLogDTO } from "../useIntegrationsPage.js";
import { StatCard, StatCardGroup } from "../../overview/components/StatCard.js";
import { FilterToolbar, FilterSelect } from "../../../components/FilterToolbar.js";
import { DataPanel } from "../../../components/DataPanel.js";
import { Button } from "../../../components/Button.js";

interface CrmLeadsTabProps {
  syncLog: CrmSyncLogDTO[];
}

type StageFilter = "all" | "lead" | "customer";
type StatusFilter = "all" | "success" | "failed";

const PAGE_SIZE = 20;

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

  return (
    <div className="crm-history">
      {/* Stats */}
      <StatCardGroup columns={3}>
        <StatCard label="Total sincronizado" value={totals.total} icon={<Users size={18} />} />
        <StatCard label="Leads (só cadastro)" value={totals.leads} icon={<UserPlus size={18} />} />
        <StatCard label="Clientes (compraram)" value={totals.customers} icon={<ShoppingBag size={18} />} />
      </StatCardGroup>

      <p className="crm-history__note">Até 50 tentativas recentes. O resultado de cada envio aparece abaixo; uma falha não significa que o contato foi recebido pelo CRM.</p>
      <FilterToolbar tabs={[{ key: "all", label: "Todos os contatos" }, { key: "lead", label: "Leads" }, { key: "customer", label: "Clientes" }]} activeTab={stage} onTabChange={v => setStage(v as StageFilter)} search={search} onSearchChange={setSearch} searchPlaceholder="Buscar contato por e-mail" extra={<FilterSelect ariaLabel="Resultado da sincronização" value={status} onChange={v => setStatus(v as StatusFilter)} options={[{ value: "all", label: "Todos os resultados" }, { value: "success", label: "Enviado ao CRM" }, { value: "failed", label: "Com falha" }]} />} />
      <DataPanel title="Histórico de sincronização" page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} isEmpty={filtered.length === 0} empty={{ icon: Users, title: syncLog.length ? "Nenhum contato com estes filtros" : "Nenhuma sincronização registrada", description: syncLog.length ? "Ajuste a busca ou limpe os filtros para ver os contatos." : "Conecte um CRM para acompanhar as tentativas de envio dos contatos da loja.", action: syncLog.length ? <Button variant="outline" onClick={() => { setSearch(""); setStage("all"); setStatus("all"); }}>Limpar filtros</Button> : undefined }}>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Contato</th><th>Tipo</th><th>CRM</th><th>Resultado</th><th>Quando</th></tr></thead>
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
                      <span style={{ color: row.status === "success" ? "var(--color-brand)" : "var(--color-error)" }}>
                        {row.status === "success" ? "Enviado ao CRM" : "Falha no envio"}
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

      </DataPanel>
    </div>
  );
}
