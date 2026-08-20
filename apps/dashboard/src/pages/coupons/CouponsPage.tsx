import { Plus, Trash2, Copy, RefreshCw, Tag, X, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { useCouponsPage } from "./useCouponsPage.js";
import type { MerchantProfile } from "../../api-client.js";

export interface CouponsPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

function formatDiscount(type: string, value: number): string {
  if (type === "free_shipping") return "Frete grátis";
  if (type === "percent") return `${value}%`;
  return `R$ ${(value / 100).toFixed(2)}`;
}

function formatDate(iso?: string): string {
  if (!iso) return "Sem limite";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Searchable multi-select dropdown */
function MultiSearchSelect({ label, placeholder, selected, onChange }: {
  label: string;
  placeholder: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  function addItem() {
    const trimmed = query.trim();
    if (!trimmed || selected.includes(trimmed)) return;
    onChange([...selected, trimmed]);
    setQuery("");
  }

  function removeItem(id: string) {
    onChange(selected.filter((s) => s !== id));
  }

  return (
    <div>
      <span className="field-label">{label}</span>
      <div style={{ position: "relative" }}>
        <div className="field-input" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", minHeight: 40, padding: "6px 10px", cursor: "text" }} onClick={() => setOpen(true)}>
          {selected.map((id) => (
            <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 5, background: "var(--accent-soft)", color: "var(--accent)", font: "600 11px var(--mono)", whiteSpace: "nowrap" }}>
              {id.length > 20 ? id.slice(0, 20) + "…" : id}
              <button type="button" onClick={(e) => { e.stopPropagation(); removeItem(id); }} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, display: "flex" }}>
                <X size={11} />
              </button>
            </span>
          ))}
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder={selected.length === 0 ? placeholder : ""}
            style={{ flex: 1, minWidth: 80, border: "none", outline: "none", background: "transparent", color: "var(--ink)", font: "12px var(--sans)", padding: "4px 0" }}
          />
          <Search size={13} style={{ color: "var(--faint)", flex: "none" }} />
        </div>
        {open && query.trim() && (
          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: 6, zIndex: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
            <button type="button" onClick={addItem} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "none", background: "var(--bg)", color: "var(--ink)", font: "12px var(--sans)", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 6 }}>
              <Plus size={12} color="var(--accent)" /> Adicionar "<strong>{query.trim()}</strong>"
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const FIELD_STYLES = `
.field-label { font: 600 11px var(--sans); color: var(--ink); display: block; margin-bottom: 6px; }
.field-hint { font: 11px var(--sans); color: var(--faint); margin-top: 4px; display: block; }
.field-input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--ink); font: 13px var(--sans); outline: none; transition: border-color 0.15s; }
.field-input:focus { border-color: var(--accent); }
.field-btn-icon { padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--accent); cursor: pointer; display: flex; align-items: center; gap: 5px; font: 500 11px var(--sans); white-space: nowrap; transition: border-color 0.15s; }
.field-btn-icon:hover { border-color: var(--accent); }
`;

export function CouponsPage(_props: CouponsPageProps) {
  const vm = useCouponsPage();

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
      {vm.showForm && (
        <div
          onClick={() => vm.setShowForm(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(2px)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 440,
              height: "100%",
              background: "var(--card)",
              borderLeft: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              animation: "slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
              overflowY: "auto",
            }}
          >
            {/* Panel Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px", borderBottom: "1px solid var(--border)", flex: "none" }}>
              <div>
                <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>MARKETING</div>
                <h2 style={{ font: "600 18px var(--serif)", color: "var(--ink)", margin: 0, letterSpacing: "-0.01em" }}>Criar cupom</h2>
              </div>
              <button type="button" onClick={() => vm.setShowForm(false)} aria-label="Fechar" style={{ width: 36, height: 36, borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }} onMouseEnter={(e) => { e.currentTarget.style.background = "var(--card)"; e.currentTarget.style.color = "var(--ink)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg)"; e.currentTarget.style.color = "var(--muted)"; }}>
                <X size={20} />
              </button>
            </div>

            {/* Panel Body */}
            <div style={{ flex: 1, padding: "24px", display: "flex", flexDirection: "column", gap: 20, overflowY: "auto" }}>
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
                  <input type="datetime-local" value={vm.form.startsAt} onChange={(e) => vm.patch({ startsAt: e.target.value })} className="field-input" />
                </label>
                <label>
                  <span className="field-label">Fim da validade</span>
                  <input type="datetime-local" value={vm.form.expiresAt} onChange={(e) => vm.patch({ expiresAt: e.target.value })} className="field-input" />
                </label>
              </div>

              {/* Max usos */}
              <label>
                <span className="field-label">Máximo de usos</span>
                <input type="number" value={vm.form.maxUses} onChange={(e) => vm.patch({ maxUses: e.target.value })} placeholder="Ilimitado" min={1} className="field-input" />
              </label>

              {/* Restrições — Produto e Categoria multi-select */}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 18 }}>
                <span style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--muted)", textTransform: "uppercase", display: "block", marginBottom: 14 }}>Restrições (opcional)</span>

                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <MultiSearchSelect
                    label="Vincular a produtos"
                    placeholder="Buscar produto..."
                    selected={vm.form.productIds}
                    onChange={(ids) => vm.patch({ productIds: ids })}
                  />
                  <MultiSearchSelect
                    label="Vincular a categorias"
                    placeholder="Buscar categoria..."
                    selected={vm.form.categoryIds}
                    onChange={(ids) => vm.patch({ categoryIds: ids })}
                  />
                </div>
                <span className="field-hint" style={{ marginTop: 8 }}>Se preenchido, cupom só vale para itens vinculados.</span>
              </div>
            </div>

            {/* Panel Footer */}
            <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 10, justifyContent: "flex-end", flex: "none" }}>
              <Button variant="secondary" size="sm" onClick={() => vm.setShowForm(false)}>Cancelar</Button>
              <Button variant="primary" size="sm" onClick={() => void vm.handleCreate()} disabled={vm.creating} loading={vm.creating}>
                Criar cupom
              </Button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        ${FIELD_STYLES}
      `}</style>

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
        <div style={{ display: "grid", gap: 8 }}>
          {vm.coupons.map((coupon) => (
            <div key={coupon.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: coupon.isActive ? "var(--accent-soft)" : "var(--danger-soft)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <Tag size={16} color={coupon.isActive ? "var(--accent)" : "var(--danger)"} />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ font: "700 14px var(--mono)", color: "var(--ink)", letterSpacing: "0.04em" }}>{coupon.code}</span>
                  <span style={{ font: "600 11px var(--sans)", padding: "2px 7px", borderRadius: 5, background: coupon.isActive ? "var(--accent-soft)" : "var(--danger-soft)", color: coupon.isActive ? "var(--accent)" : "var(--danger)" }}>
                    {coupon.isActive ? "Ativo" : "Inativo"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 12, marginTop: 4, font: "11.5px var(--sans)", color: "var(--muted)" }}>
                  <span>{formatDiscount(coupon.discountType, coupon.discountValue)} off</span>
                  <span>•</span>
                  <span>{coupon.usedCount}/{coupon.maxUses ?? "∞"} usos</span>
                  <span>•</span>
                  <span>Expira: {formatDate(coupon.expiresAt)}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => { navigator.clipboard.writeText(coupon.code); }}
                title="Copiar código"
                style={{ padding: 6, borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}
              >
                <Copy size={14} />
              </button>

              <button
                type="button"
                onClick={() => void vm.handleDelete(coupon.id)}
                title="Desativar cupom"
                style={{ padding: 6, borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--danger)", cursor: "pointer" }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      </section>
    </div>
  );
}
