import { Plus, Trash2, Copy, RefreshCw, Tag, X } from "lucide-react";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { useCouponsPage } from "./useCouponsPage.js";
import type { MerchantProfile } from "../../api-client.js";

export interface CouponsPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

function formatDiscount(type: string, value: number): string {
  if (type === "percent") return `${value}%`;
  return `R$ ${(value / 100).toFixed(2)}`;
}

function formatDate(iso?: string): string {
  if (!iso) return "Sem expiração";
  return new Date(iso).toLocaleDateString("pt-BR");
}

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
            <div style={{ flex: 1, padding: "24px", display: "flex", flexDirection: "column", gap: 18 }}>
              <label>
                <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Código do cupom *</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={vm.form.code}
                    onChange={(e) => vm.patch({ code: e.target.value.toUpperCase() })}
                    placeholder="EX: SAVE10"
                    style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "13px var(--mono)", textTransform: "uppercase", letterSpacing: "0.04em" }}
                  />
                  <button type="button" onClick={vm.generateCode} title="Gerar código aleatório" style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--accent)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, font: "11px var(--sans)" }}>
                    <RefreshCw size={13} /> Gerar
                  </button>
                </div>
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Tipo de desconto</span>
                  <select value={vm.form.discountType} onChange={(e) => vm.patch({ discountType: e.target.value as "percent" | "fixed" })} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "13px var(--sans)" }}>
                    <option value="percent">Percentual (%)</option>
                    <option value="fixed">Valor fixo (R$)</option>
                  </select>
                </label>

                <label>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Valor *</span>
                  <input
                    type="number"
                    value={vm.form.discountValue}
                    onChange={(e) => vm.patch({ discountValue: e.target.value })}
                    placeholder={vm.form.discountType === "percent" ? "10" : "1000"}
                    min={1}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "13px var(--sans)" }}
                  />
                </label>
              </div>

              <label>
                <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Valor mínimo do carrinho (centavos)</span>
                <input
                  type="number"
                  value={vm.form.minCartValue}
                  onChange={(e) => vm.patch({ minCartValue: e.target.value })}
                  placeholder="Ex: 10000 (= R$ 100,00)"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "13px var(--sans)" }}
                />
                <span style={{ font: "11px var(--sans)", color: "var(--faint)", marginTop: 4, display: "block" }}>Deixe vazio para sem mínimo</span>
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Máximo de usos</span>
                  <input
                    type="number"
                    value={vm.form.maxUses}
                    onChange={(e) => vm.patch({ maxUses: e.target.value })}
                    placeholder="Ilimitado"
                    min={1}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "13px var(--sans)" }}
                  />
                </label>

                <label>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Expira em</span>
                  <input
                    type="date"
                    value={vm.form.expiresAt}
                    onChange={(e) => vm.patch({ expiresAt: e.target.value })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "13px var(--sans)" }}
                  />
                </label>
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
