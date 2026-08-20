import { Plus, Trash2, Copy, RefreshCw, Tag, X, Search, Pause, Play, TrendingUp, Percent, Truck } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { Modal } from "../../components/Modal.js";
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
              <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: "var(--accent-soft)", color: "var(--accent)", font: "600 11px var(--sans)" }}>
                {item?.name || id.slice(0, 12)}
                <button type="button" onClick={() => onChange(selected.filter((s) => s !== id))} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, display: "flex" }}>
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
        <Search size={14} style={{ color: "var(--faint)", flex: "none" }} />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (!open) { setOpen(true); void loadItems(); } }}
          onFocus={() => { setOpen(true); void loadItems(); }}
          placeholder={placeholder}
          style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--ink)", font: "12px var(--sans)", padding: 0 }}
        />
      </div>

      {/* Dropdown list */}
      {open && (
        <div
          style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 4, zIndex: 20, boxShadow: "0 12px 32px rgba(0,0,0,0.4)", maxHeight: 200, overflowY: "auto" }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {loading ? (
            <div style={{ padding: "12px", textAlign: "center", color: "var(--faint)", font: "11px var(--sans)" }}>Carregando...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "12px", textAlign: "center", color: "var(--faint)", font: "11px var(--sans)" }}>
              {query ? "Nenhum resultado" : "Nenhum item disponível"}
            </div>
          ) : (
            filtered.slice(0, 15).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { onChange([...selected, item.id]); setQuery(""); setOpen(false); }}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "none", background: "transparent", color: "var(--ink)", font: "12px var(--sans)", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 8, transition: "background 0.1s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flex: "none" }} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
                <span style={{ font: "10px var(--mono)", color: "var(--faint)" }}>{item.id.slice(0, 8)}</span>
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
.field-label { font: 600 11px var(--sans); color: var(--ink); display: block; margin-bottom: 6px; }
.field-hint { font: 11px var(--sans); color: var(--faint); margin-top: 4px; display: block; }
.field-input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--ink); font: 13px var(--sans); outline: none; transition: border-color 0.15s; box-sizing: border-box; }
.field-input:focus { border-color: var(--accent); }
.field-btn-icon { padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--accent); cursor: pointer; display: flex; align-items: center; gap: 5px; font: 500 11px var(--sans); white-space: nowrap; transition: border-color 0.15s; box-sizing: border-box; }
.field-btn-icon:hover { border-color: var(--accent); }
`;

export function CouponsPage(_props: CouponsPageProps) {
  const vm = useCouponsPage();
  const merchantId = _props.me?.id ?? "";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <span className="eyebrow">MARKETING</span>
          <h1>Cupons de desconto</h1>
          <p className="page-lead">Crie e gerencie cupons para suas campanhas</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => vm.setShowForm(true)}>
          <Plus size={14} /> Novo cupom
        </Button>
      </div>

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
                  <input value={vm.form.code} onChange={(e) => vm.patch({ code: e.target.value.toUpperCase() })} placeholder="EX: SAVE10" className="field-input" style={{ fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.04em" }} />
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
                    <span className="field-label">{vm.form.discountType === "percent" ? "Percentual *" : "Valor (centavos) *"}</span>
                    <input type="number" value={vm.form.discountValue} onChange={(e) => vm.patch({ discountValue: e.target.value })} placeholder={vm.form.discountType === "percent" ? "10" : "1000"} min={1} className="field-input" />
                  </label>
                )}
              </div>

              {/* Carrinho mínimo */}
              <label>
                <span className="field-label">Valor mínimo do carrinho (centavos)</span>
                <input type="number" value={vm.form.minCartValue} onChange={(e) => vm.patch({ minCartValue: e.target.value })} placeholder="Ex: 10000 (= R$ 100,00)" className="field-input" />
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
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 18 }}>
                <span style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 14 }}>Restrições (opcional)</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <MultiSearchSelect label="Vincular a produtos" placeholder="Buscar produto..." selected={vm.form.productIds} onChange={(ids) => vm.patch({ productIds: ids })} type="products" merchantId={merchantId} />
                  <MultiSearchSelect label="Vincular a categorias" placeholder="Buscar categoria..." selected={vm.form.categoryIds} onChange={(ids) => vm.patch({ categoryIds: ids })} type="categories" merchantId={merchantId} />
                </div>
                <span className="field-hint" style={{ marginTop: 8 }}>Se preenchido, cupom só vale para itens vinculados.</span>
              </div>
        </div>
      </Modal>

      {/* KPIs */}
      {!vm.loading && vm.coupons.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
          <StatCard label="Total de cupons" value={vm.coupons.length} icon={<Tag size={16} />} />
          <StatCard label="Ativos" value={vm.coupons.filter(c => c.isActive).length} icon={<Play size={16} />} accent="var(--good)" />
          <StatCard label="Total resgates" value={vm.coupons.reduce((sum, c) => sum + (c.usedCount || 0), 0)} icon={<TrendingUp size={16} />} />
          <StatCard label="Taxa de uso" value={`${vm.coupons.length > 0 ? Math.round((vm.coupons.filter(c => c.usedCount > 0).length / vm.coupons.length) * 100) : 0}%`} icon={<Percent size={16} />} accent="var(--warn)" />
        </div>
      )}

      <style>{FIELD_STYLES}</style>

      {/* Coupons List */}
      <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
      {vm.loading ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>Carregando cupons...</div>
      ) : vm.coupons.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="Nenhum cupom criado ainda"
          description="Crie cupons para usar em triggers de abandono, campanhas de email ou compartilhar com clientes nas redes sociais."
          action={
            <Button variant="primary" size="sm" onClick={() => vm.setShowForm(true)}>
              <Plus size={14} /> Criar primeiro cupom
            </Button>
          }
        />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {vm.coupons.map((coupon) => (
            <div key={coupon.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 16, padding: "16px 20px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12 }}>
              {/* Left: icon + badge */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: coupon.isActive ? "var(--accent-soft)" : "var(--danger-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {coupon.discountType === "free_shipping"
                    ? <Truck size={18} color={coupon.isActive ? "var(--accent)" : "var(--danger)"} />
                    : <Tag size={18} color={coupon.isActive ? "var(--accent)" : "var(--danger)"} />}
                </div>
              </div>

              {/* Center: info */}
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ font: "700 16px var(--mono)", color: "var(--ink)", letterSpacing: "0.04em" }}>{coupon.code}</span>
                  <span style={{ font: "600 10px var(--sans)", padding: "3px 8px", borderRadius: 6, background: coupon.isActive ? "var(--accent-soft)" : "var(--danger-soft)", color: coupon.isActive ? "var(--accent)" : "var(--danger)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {coupon.isActive ? "Ativo" : "Pausado"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 16, font: "12px var(--sans)", color: "var(--muted)", flexWrap: "wrap" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <strong style={{ color: "var(--ink)", fontWeight: 600 }}>{formatDiscount(coupon.discountType, coupon.discountValue)}</strong> desconto
                  </span>
                  <span style={{ width: 1, height: 12, background: "var(--border)" }} />
                  <span>{coupon.usedCount}/{coupon.maxUses ?? "∞"} usos</span>
                  <span style={{ width: 1, height: 12, background: "var(--border)" }} />
                  <span>Válido: {formatDate(coupon.startsAt)} → {formatDate(coupon.expiresAt)}</span>
                </div>
              </div>

              {/* Right: actions */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button type="button" onClick={() => void vm.handleToggleActive(coupon.id, coupon.isActive)} title={coupon.isActive ? "Pausar" : "Ativar"} style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: coupon.isActive ? "var(--warn)" : "var(--accent)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {coupon.isActive ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button type="button" onClick={() => { navigator.clipboard.writeText(coupon.code); }} title="Copiar" style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Copy size={14} />
                </button>
                <button type="button" onClick={() => void vm.handleDelete(coupon.id)} title="Excluir" style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--danger)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      </section>
    </div>
  );
}
