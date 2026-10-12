import React, { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { DataPanel } from "../../components/DataPanel.js";
import { FilterToolbar, FilterSelect } from "../../components/FilterToolbar.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { WhatsAppBrandIcon } from "../../components/WhatsAppBrandIcon.js";
import { usePostSaleTemplates } from "../post-sale/usePostSaleTemplates.js";
import { TemplateEditor } from "../post-sale/TemplateEditor.js";
import { MESSAGE_STATUS_LABELS, messageStatusLabel } from "../post-sale/template-status.js";
import "../post-sale/post-sale.css";

const PAGE_SIZE = 6;
const normalizeSearch = (value: string) => value.trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export const WHATSAPP_TEMPLATE_CATALOG = [
  { type: "order_confirmation", label: "Confirmação do pedido", category: "Utilidade", body: "Olá, {{buyerName}}!\n\nRecebemos o pedido {{orderId}} e já iniciamos a preparação. Você receberá uma nova atualização assim que houver mudança no status.\n\nAtenciosamente,\n{{storeName}}" },
  { type: "order_shipped", label: "Pedido enviado", category: "Utilidade", body: "Olá, {{buyerName}}!\n\nSeu pedido {{orderId}} foi enviado e já está a caminho. Código de rastreio: {{trackingCode}}.\n\nSe precisar de apoio durante a entrega, responda a esta mensagem.\n\nAtenciosamente,\n{{storeName}}" },
  { type: "order_delivered", label: "Pedido entregue", category: "Utilidade", body: "Olá, {{buyerName}}!\n\nConfirmamos a entrega do pedido {{orderId}}. Esperamos que {{productName}} atenda às suas expectativas. Se precisar de suporte, estamos à disposição.\n\nAtenciosamente,\n{{storeName}}" },
  { type: "follow_up", label: "Acompanhamento da entrega", category: "Utilidade", body: "Olá, {{buyerName}}!\n\nQueremos confirmar se o seu {{productName}} chegou bem e se está tudo certo com o pedido. Se precisar de qualquer apoio, responda a esta mensagem.\n\nAtenciosamente,\n{{storeName}}" },
  { type: "review_request", label: "Pedido de avaliação", category: "Utilidade", body: "Olá, {{buyerName}}!\n\nSua experiência com {{productName}} é muito importante para nós. De 1 a 5 estrelas, qual nota você daria para sua compra? Se quiser, conte também o que podemos melhorar.\n\nAtenciosamente,\n{{storeName}}" },
  { type: "nps", label: "Pesquisa de satisfação", category: "Utilidade", body: "Olá, {{buyerName}}!\n\nEm uma escala de 1 a 5 estrelas, o quanto você recomendaria a sua experiência com {{storeName}} após a compra de {{productName}}? Sua resposta nos ajuda a evoluir.\n\nAtenciosamente,\n{{storeName}}" },
  { type: "cart_recovery", label: "Recuperação de carrinho", category: "Marketing", body: "Olá, {{buyerName}}!\n\nVimos que há itens aguardando no seu carrinho da {{storeName}}. Se ainda quiser concluir a compra, você pode retomar pelo checkout.\n\n{{couponBlock}}\n\nAtenciosamente,\n{{storeName}}" },
  { type: "cross_sell", label: "Produtos complementares", category: "Marketing", body: "Olá, {{buyerName}}!\n\nSelecionamos opções que combinam com {{productName}} e podem complementar sua compra.\n\n{{couponBlock}}\n\nConfira as condições e escolha quando fizer sentido para você.\n\nAtenciosamente,\n{{storeName}}" },
  { type: "win_back", label: "Retorno de clientes", category: "Marketing", body: "Olá, {{buyerName}}!\n\nSentimos sua falta. A {{storeName}} separou uma condição especial para uma próxima compra, conforme as regras da oferta.\n\n{{couponBlock}}\n\nAtenciosamente,\n{{storeName}}" },
  { type: "loyalty", label: "Fidelidade", category: "Marketing", body: "Olá, {{buyerName}}!\n\nAgradecemos por escolher a {{storeName}} novamente. Como reconhecimento pela sua fidelidade, liberamos a condição abaixo.\n\n{{couponBlock}}\n\nAtenciosamente,\n{{storeName}}" },
  { type: "reorder", label: "Recompra", category: "Marketing", body: "Olá, {{buyerName}}!\n\nPode estar chegando o momento de repor {{productName}}. Se for útil para você, veja a condição disponível e as opções da loja.\n\n{{couponBlock}}\n\nAtenciosamente,\n{{storeName}}" },
] as const;

type CatalogTemplate = (typeof WHATSAPP_TEMPLATE_CATALOG)[number];

export function WhatsAppTemplatesTab(props: { me: MerchantProfile | null }) {
  const tpl = usePostSaleTemplates(props);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState<CatalogTemplate | null>(null);
  const filtered = useMemo(() => WHATSAPP_TEMPLATE_CATALOG.filter(t => normalizeSearch(`${t.label} ${t.category} ${t.body}`).includes(normalizeSearch(search))
    && (status === "all" || (tpl.templates[`${t.type}:whatsapp`]?.metaStatus ?? "missing") === status)), [search, status, tpl.templates]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return <div className="whatsapp-template-catalog">
    <SectionHeader title="Modelos de mensagem" subtitle="Estes são os textos padrão cadastrados pela Zyon para o WhatsApp da loja. O estado abaixo vem da Meta e determina se cada modelo pode ser enviado." />
    <div className="whatsapp-template-notice" role="note">
      <WhatsAppBrandIcon size={20} />
      <div><strong>Editar cria uma nova análise da Meta</strong><p>Você pode personalizar um texto. Ao salvar, a nova versão precisa ser aprovada pela Meta e pode ser recusada. Enquanto estiver em análise ou recusada, ela não será enviada pelo WhatsApp.</p></div>
    </div>
    {tpl.loading ? <div className="panel whatsapp-template-loading" role="status"><span /><span />Carregando modelos…</div> : tpl.loadError ?
      <EmptyState title="Modelos indisponíveis" description={tpl.loadError} action={<Button variant="outline" onClick={tpl.reload}>Tentar novamente</Button>} /> : <>
      <FilterToolbar tabs={[]} activeTab="" onTabChange={() => {}} search={search} searchPlaceholder="Buscar por modelo ou conteúdo" onSearchChange={value => { setSearch(value); setPage(1); }}
        extra={<FilterSelect ariaLabel="Estado dos modelos" value={status} onChange={value => { setStatus(value); setPage(1); }} width={250}
          options={[{ value: "all", label: "Todos os estados" }, ...Object.entries(MESSAGE_STATUS_LABELS).map(([value, label]) => ({ value, label })), { value: "missing", label: "Aguardando sincronização" }]} />} />
      <DataPanel title={`${filtered.length} ${filtered.length === 1 ? "modelo" : "modelos"} de mensagem`} page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage}
        isEmpty={!filtered.length} empty={{ icon: WhatsAppBrandIcon, title: "Nenhum modelo com estes filtros", description: "Altere a busca ou o estado para encontrar a mensagem.", action: <Button variant="outline" onClick={() => { setSearch(""); setStatus("all"); setPage(1); }}>Limpar filtros</Button> }}>
        <div className="whatsapp-template-list">
          {rows.map(t => {
            const stored = tpl.get(t.type, "whatsapp");
            return <button type="button" key={t.type} className="whatsapp-template-row" onClick={() => setEditing(t)} aria-label={`Ver ou editar ${t.label}`}>
              <span className="whatsapp-template-row__copy"><span className="whatsapp-template-row__heading"><strong>{t.label}</strong><em>{t.category}</em></span><small>{stored ? `WhatsApp · Versão ${stored.metaRevision ?? 1}` : "Texto padrão aguardando sincronização com a Meta."}</small><p>{stored?.body || t.body}</p><span className="whatsapp-template-row__signature">Assinatura: {"{{storeName}}"}</span></span>
              <span className="whatsapp-template-row__action"><span className="message-status-badge" data-status={stored?.metaStatus}>{stored ? messageStatusLabel(stored.metaStatus) : "Aguardando sincronização"}</span><Pencil size={16} aria-hidden="true" /></span>
            </button>;
          })}
        </div>
      </DataPanel>
    </>}
    {editing && <TemplateEditor key={editing.type} me={props.me} initialType={editing.type} definition={editing} onClose={() => { setEditing(null); void tpl.reload(); }} />}
  </div>;
}
