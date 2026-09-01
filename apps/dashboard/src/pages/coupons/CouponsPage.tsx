import { Plus, Trash2, Copy, RefreshCw, Tag, X, Search, Pause, Play, TrendingUp, Percent, Truck } from "lucide-react";
import { useState, useMemo } from "react";
import { Button } from "../../components/Button.js";
import { DataPanel } from "../../components/DataPanel.js";
import { Modal } from "../../components/Modal.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { FilterToolbar } from "../../components/FilterToolbar.js";
import { useApi } from "../../hooks/useApi.js";
import { StatCard } from "../overview/components/StatCard.js";
import { useCouponsPage } from "./useCouponsPage.js";
import type { MerchantProfile } from "../../api-client.js";

export interface CouponsPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

function formatDiscount(type: string, value: number): string {
  if (type === "free_shipping") return "Frete grátis";
  if (type === "percent") return `${value || 0}%`;
  if (!value || isNaN(value)) return "R$ 0,00";
  return `R$ ${(value / 100).toFixed(2)}`;
}

function formatDate(iso?: string): string {
  if (!iso) return "Sem limite";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Dropdown with searchbox — loads items from API, multi-select */
function MultiSearchSelect({ label, placeholder, selected, onChange, type, merchantId }: {
  label: string;
  placeholder: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  type: "products" | "categories";
  merchantId: string;
}) {
  const api = useApi();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);

  const loadItems = async () => {
    setLoading(true);
    try {
      if (type === "products") {
        const data = await api.listProducts(merchantId, { limit: 50 });
        setItems((data?.products ?? []).map((p: any) => ({ id: p.id, name: p.name })));
      } else {
        const data = await api.listCategories(merchantId);
        setItems((Array.isArray(data) ? data : []).map((c: any) => ({ id: c.id, name: c.name })));
      }
    } catch {
      setItems([]);
    }
    setLoading(false);
  };

  const filtered = items.filter((item) =>
    !selected.includes(item.id) &&
    item.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div style={{ position: "relative" }}>
      <span className="field-label">{label}</span>

      {/* Selected tags */}
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {selected.map((id) => {
            const item = items.find((i) => i.id === id);
            return (
              <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: "var(--color-brand-subtle)", color: "var(--color-brand)", font: "600 11px var(--font-sans)" }}>
                {item?.name || id.slice(0, 12)}
                <button type="button" onClick={() => onChange(selected.filter((s) => s !== id))} style={{ background: "none", border: "none", color: "var(--color-brand)", cursor: "pointer", padding: 0, display: "flex" }}>
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Dropdown trigger */}
      <div
        className="field-input"
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
        onClick={() => { setOpen(!open); if (!open) void loadItems(); }}
      >
        <Search size={14} style={{ color: "var(--color-text-faint)", flex: "none" }} />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (!open) { setOpen(true); void loadItems(); } }}
          onFocus={() => { setOpen(true); void loadItems(); }}
          placeholder={placeholder}
          style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--color-text)", font: "12px var(--font-sans)", padding: 0 }}
        />
      </div>

      {/* Dropdown list */}
      {open && (
        <div
          style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 10, padding: 4, zIndex: 20, boxShadow: "0 12px 32px rgba(0,0,0,0.4)", maxHeight: 200, overflowY: "auto" }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {loading ? (
            <div style={{ padding: "12px", textAlign: "center", color: "var(--color-text-faint)", font: "11px var(--font-sans)" }}>Carregando...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "12px", textAlign: "center", color: "var(--color-text-faint)", font: "11px var(--font-sans)" }}>
              {query ? "Nenhum resultado" : "Nenhum item disponível"}
            </div>
          ) : (
            filtered.slice(0, 15).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { onChange([...selected, item.id]); setQuery(""); setOpen(false); }}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "none", background: "transparent", color: "var(--color-text)", font: "12px var(--font-sans)", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 8, transition: "background 0.1s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-brand)", flex: "none" }} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
                <span style={{ font: "10px var(--font-mono)", color: "var(--color-text-faint)" }}>{item.id.slice(0, 8)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Click outside to close */}
      {open && <div style={{ position: "fixed", inset: 0, zIndex: 15 }} onClick={() => setOpen(false)} />}
    </div>
  );
}

const FIELD_STYLES = `
.field-label { font: 600 11px var(--font-sans); color: var(--color-text); display: block; margin-bottom: 6px; }
.field-hint { font: 11px var(--font-sans); color: var(--color-text-faint); margin-top: 4px; display: block; }
.field-input { width: 100%; height: 40px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--color-border); background: var(--surface-2); color: var(--color-text); font: 13px var(--font-sans); outline: none; transition: border-color 0.15s; box-sizing: border-box; }
.field-input:focus { border-color: var(--color-brand); box-shadow: 0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-brand-ring); }
.field-input:hover { border-color: var(--color-border-strong); }
select.field-input { appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px; }
input[type="date"].field-input { color-scheme: dark; }
.field-btn-icon { height: 40px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--color-border); background: var(--surface-2); color: var(--color-brand); cursor: pointer; display: flex; align-items: center; gap: 5px; font: 500 11px var(--font-sans); white-space: nowrap; transition: border-color 0.15s; box-sizing: border-box; }
.field-btn-icon:hover { border-color: var(--color-brand); }
`;

export function CouponsPage(_props: CouponsPageProps) {
  const vm = useCouponsPage();
  const merchantId = _props.me?.id ?? "";
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "expired" | "paused">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; code: string } | null>(null);
  const PAGE_SIZE = 10;

  const filteredCoupons = useMemo(() => {
    let list = vm.coupons;
    if (statusFilter === "active") list = list.filter((c) => c.isActive);
    else if (statusFilter === "expired") list = list.filter((c) => c.expiresAt && new Date(c.expiresAt) < new Date());
    else if (statusFilter === "paused") list = list.filter((c) => !c.isActive);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) => c.code.toLowerCase().includes(q));
    }
    return list;
  }, [vm.coupons, statusFilter, searchQuery]);

  const paginatedCoupons = filteredCoupons.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Checkout</span>
          <h1>Cupons</h1>
          <p className="page-lead">Crie e gerencie cupons para suas campanhas</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => vm.setShowForm(true)}>
          <Plus size={14} /> Novo cupom
        </Button>
      </header>

      {/* Side Panel — Create Coupon */}
      <Modal
        isOpen={vm.showForm}
        title="Criar cupom"
        eyebrow="MARKETING"
        onClose={() => vm.setShowForm(false)}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => vm.setShowForm(false)}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={() => void vm.handleCreate()} disabled={vm.creating} loading={vm.creating}>
              Criar cupom
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Código */}
              <label>
                <span className="field-label">Código do cupom *</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={vm.form.code} onChange={(e) => vm.patch({ code: e.target.value.toUpperCase() })} placeholder="EX: SAVE10" className="field-input" style={{ fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.04em" }} />
                  <button type="button" onClick={vm.generateCode} title="Gerar código" className="field-btn-icon"><RefreshCw size={13} /> Gerar</button>
                </div>
              </label>

              {/* Tipo + Valor */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  <span className="field-label">Tipo de desconto</span>
                  <select value={vm.form.discountType} onChange={(e) => vm.patch({ discountType: e.target.value as any })} className="field-input">
                    <option value="percent">Percentual (%)</option>
                    <option value="fixed">Valor fixo (R$)</option>
                    <option value="free_shipping">Frete grátis</option>
                  </select>
                </label>
                {vm.form.discountType !== "free_shipping" && (
                  <label>
                    <span className="field-label">{vm.form.discountType === "percent" ? "Percentual *" : "Valor (R$) *"}</span>
                    <input type="number" step={vm.form.discountType === "percent" ? "1" : "0.01"} value={vm.form.discountValue} onChange={(e) => vm.patch({ discountValue: e.target.value })} placeholder={vm.form.discountType === "percent" ? "10" : "50"} min={1} className="field-input" />
                  </label>
                )}
              </div>

              {/* Carrinho mínimo */}
              <label>
                <span className="field-label">Valor mínimo do carrinho (R$)</span>
                <input type="number" step="0.01" value={vm.form.minCartValue} onChange={(e) => vm.patch({ minCartValue: e.target.value })} placeholder="Ex: 100 (= R$ 100,00)" className="field-input" />
                <span className="field-hint">Deixe vazio para sem mínimo</span>
              </label>

              {/* Datas */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  <span className="field-label">Início da validade</span>
                  <input type="date" value={vm.form.startsAt} onChange={(e) => vm.patch({ startsAt: e.target.value })} className="field-input" />
                </label>
                <label>
                  <span className="field-label">Fim da validade</span>
                  <input type="date" value={vm.form.expiresAt} onChange={(e) => vm.patch({ expiresAt: e.target.value })} className="field-input" />
                </label>
              </div>

              {/* Max usos */}
              <label>
                <span className="field-label">Máximo de usos</span>
                <input type="number" value={vm.form.maxUses} onChange={(e) => vm.patch({ maxUses: e.target.value })} placeholder="Ilimitado" min={1} className="field-input" />
              </label>

              {/* Restrições */}
              <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 18 }}>
                <span style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.06em", color: "var(--color-text-muted)", textTransform: "uppercase", display: "block", marginBottom: 14 }}>Restrições (opcional)</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <MultiSearchSelect label="Vincular a produtos" placeholder="Buscar produto..." selected={vm.form.productIds} onChange={(ids) => vm.patch({ productIds: ids })} type="products" merchantId={merchantId} />
                  <MultiSearchSelect label="Vincular a categorias" placeholder="Buscar categoria..." selected={vm.form.categoryIds} onChange={(ids) => vm.patch({ categoryIds: ids })} type="categories" merchantId={merchantId} />
                </div>
                <span className="field-hint" style={{ marginTop: 8 }}>Em breve: vínculo por produto/categoria. Por enquanto o cupom vale para o carrinho todo.</span>
              </div>
        </div>
      </Modal>

      {/* KPIs */}
      {!vm.loading && vm.coupons.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
          <StatCard label="Total de cupons" value={vm.coupons.length} icon={<Tag size={16} />} />
          <StatCard label="Ativos" value={vm.coupons.filter(c => c.isActive).length} icon={<Play size={16} />} accent="var(--color-success)" />
          <StatCard label="Total resgates" value={vm.coupons.reduce((sum, c) => sum + (c.usedCount || 0), 0)} icon={<TrendingUp size={16} />} />
          <StatCard label="Taxa de uso" value={`${vm.coupons.length > 0 ? Math.round((vm.coupons.filter(c => c.usedCount > 0).length / vm.coupons.length) * 100) : 0}%`} icon={<Percent size={16} />} accent="var(--color-warning)" />
        </div>
      )}

      <style>{FIELD_STYLES}</style>

      {/* Coupons List */}
      <section style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
      <FilterToolbar
        tabs={[
          { key: "all", label: "Todos" },
          { key: "active", label: "Ativos" },
          { key: "paused", label: "Pausados" },
          { key: "expired", label: "Expirados" },
        ]}
        activeTab={statusFilter}
        onTabChange={(k) => { setStatusFilter(k as typeof statusFilter); setPage(1); }}
        search={searchQuery}
        onSearchChange={(v) => { setSearchQuery(v); setPage(1); }}
      />
      <DataPanel
        title="Cupons"
        page={page}
        pageSize={PAGE_SIZE}
        total={filteredCoupons.length}
        onPageChange={setPage}
        isEmpty={vm.coupons.length === 0 && !vm.loading}
        empty={{ icon: Tag, title: "Nenhum cupom criado ainda", description: "Crie cupons para usar em triggers de abandono, campanhas de email ou compartilhar com clientes nas redes sociais." }}
      >
      <div style={{ padding: "20px 22px" }}>
      {vm.loading ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>Carregando cupons...</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {paginatedCoupons.map((coupon) => (
            <div key={coupon.id} style={{ padding: "18px 20px", background: "var(--surface-1)", border: "1px solid var(--color-border)", borderRadius: 12 }}>
              {/* Top row: code + badge + actions */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: coupon.isActive ? "var(--color-brand-subtle)" : "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {coupon.discountType === "free_shipping"
                      ? <Truck size={18} color={coupon.isActive ? "var(--color-brand)" : "var(--color-text-faint)"} />
                      : <Tag size={18} color={coupon.isActive ? "var(--color-brand)" : "var(--color-text-faint)"} />}
                  </div>
                  <div>
                    <span style={{ font: "700 16px var(--font-mono)", color: "var(--color-text)", letterSpacing: "0.03em", display: "block" }}>{coupon.code}</span>
                    <span style={{ font: "600 9px var(--font-sans)", padding: "2px 7px", borderRadius: 5, background: coupon.isActive ? "var(--color-brand-subtle)" : "rgba(255,255,255,0.05)", color: coupon.isActive ? "var(--color-brand)" : "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {coupon.isActive ? "Ativo" : "Pausado"}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button type="button" onClick={() => void vm.handleToggleActive(coupon.id, coupon.isActive)} title={coupon.isActive ? "Pausar" : "Ativar"} style={{ width: 36, height: 36, borderRadius: 9, border: "1px solid var(--color-border)", background: "transparent", color: coupon.isActive ? "var(--color-warning)" : "var(--color-brand)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {coupon.isActive ? <Pause size={18} /> : <Play size={18} />}
                  </button>
                  <button type="button" onClick={() => { void navigator.clipboard.writeText(coupon.code); }} title="Copiar código" style={{ width: 36, height: 36, borderRadius: 9, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Copy size={18} />
                  </button>
                  <button type="button" onClick={() => setDeleteTarget({ id: coupon.id, code: coupon.code })} title="Excluir" style={{ width: 36, height: 36, borderRadius: 9, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-error)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              {/* Bottom: metrics grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, padding: "12px 0 0", borderTop: "1px solid var(--color-border)" }}>
                <div>
                  <div style={{ font: "10px var(--font-sans)", color: "var(--color-text-faint)", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}>Desconto</div>
                  <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>{formatDiscount(coupon.discountType, coupon.discountValue)}</div>
                </div>
                <div>
                  <div style={{ font: "10px var(--font-sans)", color: "var(--color-text-faint)", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}>Usos</div>
                  <div style={{ font: "600 13px var(--font-mono)", color: "var(--color-text)" }}>{coupon.usedCount ?? 0}<span style={{ color: "var(--color-text-faint)", fontWeight: 400 }}>/{coupon.maxUses ?? "∞"}</span></div>
                </div>
                <div>
                  <div style={{ font: "10px var(--font-sans)", color: "var(--color-text-faint)", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}>Validade</div>
                  <div style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)" }}>
                    {coupon.startsAt ? formatDate(coupon.startsAt) : "Hoje"} → {coupon.expiresAt ? formatDate(coupon.expiresAt) : "Sem fim"}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
      </DataPanel>
      </section>

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Excluir cupom "${deleteTarget?.code ?? ""}"?`}
        description="Esta ação não pode ser desfeita. O cupom será removido permanentemente."
        confirmLabel="Excluir cupom"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={() => { if (deleteTarget) { void vm.handleDelete(deleteTarget.id); setDeleteTarget(null); } }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
