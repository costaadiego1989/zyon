import { SetupGuide } from "../../components/SetupGuide.js";
import { PageHeader } from "../../components/PageHeader.js";
import { Plus, Trash2, Copy, Tag, Pause, Play, TrendingUp, Percent } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { Button } from "../../components/Button.js";
import { DataPanel } from "../../components/DataPanel.js";
import { EmptyState } from "../../components/EmptyState.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { FilterToolbar } from "../../components/FilterToolbar.js";
import { showToast } from "../../components/Toast.js";
import { StatCard } from "../overview/components/StatCard.js";
import { CouponForm } from "./CouponForm.js";
import { useCouponsPage } from "./useCouponsPage.js";
import { couponMatchesStatusFilter, couponStatus, couponStatusLabels, type CouponStatusFilter } from "./coupon-status.js";
import type { MerchantProfile } from "../../api-client.js";
import "./coupons.css";
export interface CouponsPageProps { apiBaseUrl: string; me: MerchantProfile | null; }
function formatDiscount(type: string, value: number): string {
  if (type === "free_shipping") return "Frete grátis";
  if (type === "percent") return String(value || 0) + "%";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

function formatDate(iso?: string): string {
  if (!iso) return "Sem limite";
  // Coupon validity is a calendar date. Parsing a date-only value as UTC shifts
  // it one day backwards for merchants in timezones west of Greenwich.
  const calendarDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (calendarDate) return `${calendarDate[3]}/${calendarDate[2]}/${calendarDate[1]}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Data inválida" : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function CouponsPage(_props: CouponsPageProps) {
  const vm = useCouponsPage();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<CouponStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; code: string } | null>(null);
  const PAGE_SIZE = 10;
  const filteredCoupons = useMemo(() => {
    let list = vm.coupons.filter(coupon => couponMatchesStatusFilter(coupon, statusFilter));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) => c.code.toLowerCase().includes(q));
    }
    return list;
  }, [vm.coupons, statusFilter, searchQuery]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filteredCoupons.length / PAGE_SIZE)));
  useEffect(() => { if (page !== currentPage) setPage(currentPage); }, [page, currentPage]);
  const paginatedCoupons = filteredCoupons.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasFilters = statusFilter !== "all" || !!searchQuery.trim();
  function clearFilters() { setStatusFilter("all"); setSearchQuery(""); setPage(1); }
  async function copyCode(code: string) {
    try { await navigator.clipboard.writeText(code); showToast("success", "Código copiado"); }
    catch { showToast("error", "Não foi possível copiar. Selecione o código e copie manualmente."); }
  }
  return <div className="page-container coupons-page">
    <PageHeader title="Cupons" description="Crie benefícios para suas campanhas e acompanhe os resgates." actions={<Button onClick={vm.openForm}><Plus size={16} /> Novo cupom</Button>} />
    <SetupGuide title="Como criar um cupom" steps={[
      { title: "Escolha o benefício", description: "Defina um código fácil de compartilhar e escolha desconto em reais, percentual ou frete grátis." },
      { title: "Defina as condições", description: "Revise as datas de validade. Se precisar, defina um valor mínimo e um limite total de usos." },
      { title: "Compartilhe e acompanhe", description: "Copie o código para suas campanhas. Consulte os resgates e pause o cupom quando necessário." },
    ]} />
    <CouponForm vm={vm} />
      {/* KPIs */}
      {!vm.loading && vm.coupons.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
          <StatCard label="Total de cupons" value={vm.coupons.length} icon={<Tag size={16} />} />
          <StatCard label="Ativos" value={vm.coupons.filter(c => couponStatus(c) === "active").length} icon={<Play size={16} />} accent="var(--color-success)" />
          <StatCard label="Total resgates" value={vm.coupons.reduce((sum, c) => sum + (c.usedCount || 0), 0)} icon={<TrendingUp size={16} />} />
          <StatCard label="Taxa de uso" value={`${vm.coupons.length > 0 ? Math.round((vm.coupons.filter(c => c.usedCount > 0).length / vm.coupons.length) * 100) : 0}%`} icon={<Percent size={16} />} accent="var(--color-warning)" />
        </div>
      )}

    <DataPanel title="Lista de cupons" page={currentPage} pageSize={PAGE_SIZE} total={vm.loading || vm.loadError ? 0 : filteredCoupons.length} onPageChange={setPage}>
      <FilterToolbar tabs={[{ key: "all", label: "Todos" }, { key: "active", label: "Ativos" }, { key: "paused", label: "Sem novas ofertas" }, { key: "expired", label: "Encerrados" }]} activeTab={statusFilter} onTabChange={key => { setStatusFilter(key as typeof statusFilter); setPage(1); }} search={searchQuery} onSearchChange={value => { setSearchQuery(value); setPage(1); }} searchPlaceholder="Buscar código do cupom" />
      {vm.loading ? <p className="coupons-state" role="status">Carregando cupons…</p> : vm.loadError ? <EmptyState icon={Tag} title="Não foi possível carregar os cupons" description={vm.loadError} action={<Button variant="outline" onClick={() => void vm.reload()}>Tentar novamente</Button>} /> : filteredCoupons.length === 0 ? <EmptyState icon={Tag} title={hasFilters ? "Nenhum cupom encontrado" : "Crie seu primeiro cupom"} description={hasFilters ? "Tente outro código ou limpe os filtros para ver os cupons da loja." : "Ofereça um benefício aos clientes e compartilhe o código nas suas campanhas."} action={<Button variant={hasFilters ? "outline" : "primary"} onClick={hasFilters ? clearFilters : vm.openForm}>{hasFilters ? "Limpar filtros" : "Criar cupom"}</Button>} /> : <div className="coupons-list">
        {paginatedCoupons.map(coupon => <article key={coupon.id} className="coupon-row" aria-label={"Cupom " + coupon.code}>
          <div className="coupon-row__heading"><div className="coupon-row__identity"><h2>{coupon.code}</h2><span className="coupon-row__status" data-active={couponStatus(coupon) === "active"}>{couponStatusLabels[couponStatus(coupon)]}</span></div>
            <div className="coupon-row__actions">
              {coupon.strategyIncentiveExecutionId ? <a className="zyn-btn zyn-btn--outline zyn-btn--sm" href="#revenue-manager">Ver estratégias da IA</a>
                : <Button variant="outline" size="sm" disabled={!!vm.mutatingId} loading={vm.mutatingId === coupon.id} onClick={() => void vm.handleToggleActive(coupon.id, coupon.isActive)} aria-label={(coupon.isActive ? "Pausar cupom " : "Ativar cupom ") + coupon.code}>{coupon.isActive ? <Pause size={14} /> : <Play size={14} />}{coupon.isActive ? "Pausar" : "Ativar"}</Button>}
              <Button variant="ghost" size="sm" onClick={() => void copyCode(coupon.code)} aria-label={"Copiar código " + coupon.code}><Copy size={14} /> Copiar</Button>
              {!coupon.strategyIncentiveExecutionId && <Button variant="ghost" size="sm" disabled={!!vm.mutatingId} onClick={() => { vm.clearDeleteError(); setDeleteTarget({ id: coupon.id, code: coupon.code }); }} aria-label={"Arquivar cupom " + coupon.code}><Trash2 size={14} /> Arquivar</Button>}
            </div>
          </div>
          {coupon.strategyIncentiveExecutionId && <p className="coupon-row__management">Gerenciado pela estratégia de IA. Aplicado automaticamente apenas aos compradores elegíveis do teste.
            O código não libera o benefício para outros compradores. Consulte os limites, os resultados ou interrompa o teste em Otimização com IA.</p>}
          <dl className="coupon-row__details"><div><dt>Benefício</dt><dd>{formatDiscount(coupon.discountType, coupon.discountValue)}</dd></div><div><dt>Resgates</dt><dd>{coupon.strategyIncentiveExecutionId ? "Consulte os resultados da estratégia" : <>{coupon.usedCount ?? 0}{coupon.maxUses ? " de " + coupon.maxUses : " · sem limite"}</>}</dd></div><div><dt>Validade</dt><dd>{coupon.startsAt ? "De " + formatDate(coupon.startsAt) : "Sem início definido"}<br />{coupon.expiresAt ? "Até " + formatDate(coupon.expiresAt) : "Sem data final"}</dd></div>
            <div><dt>Compra mínima</dt><dd>{coupon.minCartValue ? formatDiscount("fixed", coupon.minCartValue) : "Sem mínimo"}</dd></div>
            <div><dt>Usos por comprador</dt><dd>{coupon.maxPerBuyer ?? "Sem limite"}</dd></div>
            {!!coupon.allowedSkus?.length && <div><dt>SKUs elegíveis</dt><dd>{coupon.allowedSkus.join(", ")}</dd></div>}
            {!!coupon.blockedSkus?.length && <div><dt>SKUs excluídos</dt><dd>{coupon.blockedSkus.join(", ")}</dd></div>}
            {!!coupon.allowedRegions?.length && <div><dt>Regiões elegíveis</dt><dd>{coupon.allowedRegions.join(", ")}</dd></div>}
            {!!coupon.blockedRegions?.length && <div><dt>Regiões excluídas</dt><dd>{coupon.blockedRegions.join(", ")}</dd></div>}
          </dl>
        </article>)}
      </div>}
    </DataPanel>
    <ConfirmDialog open={!!deleteTarget} title={"Arquivar cupom " + (deleteTarget?.code ?? "") + "?"} description="O cupom deixará de ser aceito. O histórico de usos será preservado." confirmLabel="Arquivar cupom" variant="danger" busy={!!vm.mutatingId} error={vm.deleteError}
      onConfirm={() => { if (deleteTarget) void vm.handleDelete(deleteTarget.id).then(success => { if (success) setDeleteTarget(null); }); }} onCancel={() => { if (!vm.mutatingId) setDeleteTarget(null); }} />
  </div>;
}
