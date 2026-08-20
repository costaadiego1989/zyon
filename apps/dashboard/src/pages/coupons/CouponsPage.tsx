import { Plus, Trash2, Copy, RefreshCw, Tag } from "lucide-react";
import { Button } from "../../components/Button.js";
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

      {/* Create Form */}
      {vm.showForm && (
        <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <h3 style={{ margin: 0, font: "600 14px var(--sans)", color: "var(--ink)" }}>Criar cupom</h3>
            <button type="button" onClick={() => vm.setShowForm(false)} style={{ background: "none", border: "none", color: "var(--faint)", cursor: "pointer", font: "12px var(--sans)" }}>Cancelar</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <label>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Código *</span>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={vm.form.code}
                  onChange={(e) => vm.patch({ code: e.target.value.toUpperCase() })}
                  placeholder="EX: SAVE10"
                  style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--mono)", textTransform: "uppercase" }}
                />
                <button type="button" onClick={vm.generateCode} title="Gerar código" style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--accent)", cursor: "pointer", display: "flex", alignItems: "center" }}>
                  <RefreshCw size={12} />
                </button>
              </div>
            </label>

            <label>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Tipo</span>
              <select value={vm.form.discountType} onChange={(e) => vm.patch({ discountType: e.target.value as "percent" | "fixed" })} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}>
                <option value="percent">Percentual (%)</option>
                <option value="fixed">Valor fixo (R$)</option>
              </select>
            </label>

            <label>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Valor *</span>
              <input
                type="number"
                value={vm.form.discountValue}
                onChange={(e) => vm.patch({ discountValue: e.target.value })}
                placeholder={vm.form.discountType === "percent" ? "10" : "1000"}
                min={1}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}
              />
            </label>

            <label>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Carrinho mínimo (centavos)</span>
              <input
                type="number"
                value={vm.form.minCartValue}
                onChange={(e) => vm.patch({ minCartValue: e.target.value })}
                placeholder="Ex: 10000 (R$100)"
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}
              />
            </label>

            <label>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Máx. usos</span>
              <input
                type="number"
                value={vm.form.maxUses}
                onChange={(e) => vm.patch({ maxUses: e.target.value })}
                placeholder="Ilimitado"
                min={1}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}
              />
            </label>

            <label>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Expira em</span>
              <input
                type="date"
                value={vm.form.expiresAt}
                onChange={(e) => vm.patch({ expiresAt: e.target.value })}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}
              />
            </label>
          </div>

          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <Button variant="primary" size="sm" onClick={() => void vm.handleCreate()} disabled={vm.creating} loading={vm.creating}>
              Criar cupom
            </Button>
          </div>
        </section>
      )}

      {/* Coupons List */}
      {vm.loading ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>Carregando cupons...</div>
      ) : vm.coupons.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center" }}>
          <Tag size={32} color="var(--faint)" style={{ marginBottom: 12 }} />
          <p style={{ color: "var(--muted)", font: "13px var(--sans)" }}>Nenhum cupom criado ainda.</p>
          <p style={{ color: "var(--faint)", font: "12px var(--sans)" }}>Crie cupons para usar em triggers, campanhas ou compartilhar com clientes.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {vm.coupons.map((coupon) => (
            <div key={coupon.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10 }}>
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
    </div>
  );
}
