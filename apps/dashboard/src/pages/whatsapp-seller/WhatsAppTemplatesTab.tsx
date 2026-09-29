import React, { useMemo, useState } from "react";
import { MessageCircle, Pencil } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { DataPanel } from "../../components/DataPanel.js";
import { FilterToolbar, FilterSelect } from "../../components/FilterToolbar.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { usePostSaleTemplates, TEMPLATE_TYPES } from "../post-sale/usePostSaleTemplates.js";
import { TemplateEditor } from "../post-sale/TemplateEditor.js";
import { MESSAGE_STATUS_LABELS, messageStatusLabel } from "../post-sale/template-status.js";
import "../post-sale/post-sale.css";

const PAGE_SIZE = 6;
const normalizeSearch = (value: string) => value.trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export function WhatsAppTemplatesTab(props: { me: MerchantProfile | null }) {
  const tpl = usePostSaleTemplates(props);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState<string | null>(null);
  const filtered = useMemo(() => TEMPLATE_TYPES.filter(t => normalizeSearch(t.label).includes(normalizeSearch(search))
    && (status === "all" || (tpl.templates[`${t.type}:whatsapp`]?.metaStatus ?? "missing") === status)), [search, status, tpl.templates]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return <div className="whatsapp-template-catalog">
    <SectionHeader title="Modelos de mensagem" subtitle="Revise os textos de cada cenário e acompanhe a análise da Meta. Um modelo aprovado ainda depende de conexão ativa e autorização do comprador para ser enviado." />
    {tpl.loading ? <div className="panel whatsapp-template-loading" role="status"><span /><span />Carregando modelos…</div> : tpl.loadError ?
      <EmptyState title="Modelos indisponíveis" description={tpl.loadError} action={<Button variant="outline" onClick={tpl.reload}>Tentar novamente</Button>} /> : <>
      <FilterToolbar tabs={[]} activeTab="" onTabChange={() => {}} search={search} searchPlaceholder="Buscar modelos de mensagem" onSearchChange={value => { setSearch(value); setPage(1); }}
        extra={<FilterSelect ariaLabel="Estado dos modelos" value={status} onChange={value => { setStatus(value); setPage(1); }} width={250}
          options={[{ value: "all", label: "Todos os estados" }, ...Object.entries(MESSAGE_STATUS_LABELS).map(([value, label]) => ({ value, label })), { value: "missing", label: "Sem modelo configurado" }]} />} />
      <DataPanel title={`${filtered.length} ${filtered.length === 1 ? "modelo encontrado" : "modelos encontrados"}`} page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage}
        isEmpty={!filtered.length} empty={{ icon: MessageCircle, title: "Nenhum modelo com estes filtros", description: "Altere a busca ou o estado para encontrar a mensagem.", action: <Button variant="outline" onClick={() => { setSearch(""); setStatus("all"); setPage(1); }}>Limpar filtros</Button> }}>
        <div className="whatsapp-template-list">
          {rows.map(t => {
            const stored = tpl.get(t.type, "whatsapp");
            return <button type="button" key={t.type} className="whatsapp-template-row" onClick={() => setEditing(t.type)} aria-label={`Editar ${t.label}`}>
              <span className="whatsapp-template-row__copy"><strong>{t.label}</strong><small>{stored ? `WhatsApp · Versão ${stored.metaRevision ?? 1}` : "Atualize os modelos para carregar a mensagem deste cenário."}</small></span>
              <span className="whatsapp-template-row__action"><span className="message-status-badge" data-status={stored?.metaStatus}>{messageStatusLabel(stored?.metaStatus)}</span><Pencil size={16} aria-hidden="true" /></span>
            </button>;
          })}
        </div>
      </DataPanel>
    </>}
    {editing && <TemplateEditor key={editing} me={props.me} initialType={editing} onClose={() => { setEditing(null); void tpl.reload(); }} />}
  </div>;
}
