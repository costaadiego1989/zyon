import React from "react";
import { Save } from "lucide-react";
import { Button } from "../../components/Button.js";
import { useCrossSellPage, type CrossSellContext } from "./useCrossSellPage.js";
import type { CrossSellTouchpoint, CrossSellStrategy, CrossSellDisplayMode } from "@zyon/shared-types";

const TOUCHPOINT_LABELS: Record<CrossSellTouchpoint, { title: string; desc: string }> = {
  browsing: { title: "Durante navegação", desc: "IA sugere complementos enquanto buyer navega a loja" },
  pre_cart: { title: "Antes do carrinho", desc: "Intercepta add-to-cart com sugestão de complemento" },
  pre_payment: { title: "Antes do pagamento", desc: "Mostra sugestões no checkout, antes de pagar" },
  post_purchase: { title: "Pós-compra", desc: "Sugere na tela de confirmação do pedido" },
};

const STRATEGY_LABELS: Record<CrossSellStrategy, { title: string; desc: string }> = {
  same_category: { title: "Mesma categoria", desc: "Produtos do mesmo segmento" },
  bought_together: { title: "Comprados juntos", desc: "Baseado em histórico de compras" },
  cart_value_upgrade: { title: "Upgrade por valor", desc: "Sugere premium ao atingir threshold" },
  complementary: { title: "Complementares", desc: "Sapato → meia, celular → capinha" },
  ai_personalized: { title: "IA personalizada", desc: "Modelo decide com base no contexto" },
};

const DISPLAY_OPTIONS: Array<{ value: CrossSellDisplayMode; label: string }> = [
  { value: "inline", label: "Inline (chat)" },
  { value: "modal", label: "Modal (popup)" },
  { value: "banner", label: "Banner (topo)" },
];

export function CrossSellPage({ context }: { context: CrossSellContext }) {
  const vm = useCrossSellPage(context);
  const { state, visibleTouchpoints, toggleTouchpoint, toggleStrategy, patchConfig, save } = vm;
  const { config } = state;

  if (state.loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Carregando...</div>;

  const sectionLabel = context === "store" ? "LOJA" : "CHECKOUT";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <span className="eyebrow">{sectionLabel}</span>
          <h1 style={{ marginBottom: 4 }}>Cross Sell</h1>
          <p className="page-lead">Configure quando e como a IA sugere produtos complementares</p>
        </div>
        <Button variant="primary" size="sm" arrow onClick={save} disabled={state.saving} loading={state.saving}>
          <Save size={14} /> Salvar
        </Button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Global toggle */}
        <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h3 style={{ font: "600 14px var(--sans)", color: "var(--ink)", margin: "0 0 4px" }}>Cross Sell ativo</h3>
              <p style={{ font: "12px var(--sans)", color: "var(--muted)", margin: 0 }}>Habilita sugestões de produtos complementares pela IA</p>
            </div>
            <label style={{ position: "relative", width: 42, height: 24, cursor: "pointer" }}>
              <input type="checkbox" checked={config.enabled} onChange={() => patchConfig({ enabled: !config.enabled })} style={{ opacity: 0, width: 0, height: 0, position: "absolute" }} />
              <span style={{ position: "absolute", inset: 0, borderRadius: 12, background: config.enabled ? "var(--accent)" : "var(--border)", transition: "background 0.2s" }}>
                <span style={{ position: "absolute", top: 2, left: config.enabled ? 20 : 2, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
              </span>
            </label>
          </div>
        </section>

        {config.enabled && (
          <>
            {/* Touchpoints */}
            <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
              <h3 style={{ font: "600 11px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", textTransform: "uppercase", marginBottom: 14 }}>Onde sugerir</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {visibleTouchpoints.map((tp) => (
                  <div key={tp} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: config.touchpoints[tp] ? "rgba(15,118,110,0.04)" : "transparent" }}>
                    <div>
                      <div style={{ font: "600 13px var(--sans)", color: "var(--ink)" }}>{TOUCHPOINT_LABELS[tp].title}</div>
                      <div style={{ font: "11px var(--sans)", color: "var(--muted)", marginTop: 2 }}>{TOUCHPOINT_LABELS[tp].desc}</div>
                    </div>
                    <label style={{ position: "relative", width: 38, height: 22, cursor: "pointer", flexShrink: 0 }}>
                      <input type="checkbox" checked={config.touchpoints[tp]} onChange={() => toggleTouchpoint(tp)} style={{ opacity: 0, width: 0, height: 0, position: "absolute" }} />
                      <span style={{ position: "absolute", inset: 0, borderRadius: 11, background: config.touchpoints[tp] ? "var(--accent)" : "var(--border)", transition: "background 0.2s" }}>
                        <span style={{ position: "absolute", top: 2, left: config.touchpoints[tp] ? 18 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            </section>

            {/* Strategies */}
            <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
              <h3 style={{ font: "600 11px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", textTransform: "uppercase", marginBottom: 14 }}>Estratégias de recomendação</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(Object.keys(STRATEGY_LABELS) as CrossSellStrategy[]).map((s) => (
                  <label key={s} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", background: config.strategies.includes(s) ? "rgba(15,118,110,0.04)" : "transparent" }}>
                    <input type="checkbox" checked={config.strategies.includes(s)} onChange={() => toggleStrategy(s)} style={{ width: 16, height: 16, accentColor: "var(--accent)" }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>{STRATEGY_LABELS[s].title}</div>
                      <div style={{ font: "11px var(--sans)", color: "var(--muted)" }}>{STRATEGY_LABELS[s].desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </section>

            {/* Limits + Discount + Display */}
            <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
              <h3 style={{ font: "600 11px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", textTransform: "uppercase", marginBottom: 14 }}>Limites e apresentação</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 8 }}>Máx. sugestões por sessão</span>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={config.limits.maxSuggestionsPerSession}
                    onChange={(e) => patchConfig({ limits: { ...config.limits, maxSuggestionsPerSession: Math.max(1, Math.min(5, parseInt(e.target.value) || 2)) } })}
                    style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", font: "13px var(--mono)", color: "var(--ink)", outline: "none" }}
                  />
                </div>
                <div>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 8 }}>Cooldown entre sugestões (s)</span>
                  <input
                    type="number"
                    min={30}
                    max={600}
                    step={30}
                    value={config.limits.cooldownSeconds}
                    onChange={(e) => patchConfig({ limits: { ...config.limits, cooldownSeconds: Math.max(30, Math.min(600, parseInt(e.target.value) || 120)) } })}
                    style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", font: "13px var(--mono)", color: "var(--ink)", outline: "none" }}
                  />
                </div>
              </div>

              <div style={{ marginTop: 16, padding: "12px 0", borderTop: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div>
                    <span style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>Desconto no cross-sell</span>
                    <span style={{ font: "11px var(--sans)", color: "var(--muted)", display: "block", marginTop: 2 }}>Oferecer desconto no produto sugerido</span>
                  </div>
                  <label style={{ position: "relative", width: 38, height: 22, cursor: "pointer" }}>
                    <input type="checkbox" checked={config.discount.enabled} onChange={() => patchConfig({ discount: { ...config.discount, enabled: !config.discount.enabled } })} style={{ opacity: 0, width: 0, height: 0, position: "absolute" }} />
                    <span style={{ position: "absolute", inset: 0, borderRadius: 11, background: config.discount.enabled ? "var(--accent)" : "var(--border)", transition: "background 0.2s" }}>
                      <span style={{ position: "absolute", top: 2, left: config.discount.enabled ? 18 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
                    </span>
                  </label>
                </div>
                {config.discount.enabled && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={config.discount.percent}
                      onChange={(e) => patchConfig({ discount: { ...config.discount, percent: Math.max(1, Math.min(50, parseInt(e.target.value) || 10)) } })}
                      style={{ width: 80, height: 38, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", font: "13px var(--mono)", color: "var(--ink)", outline: "none" }}
                    />
                    <span style={{ font: "13px var(--sans)", color: "var(--muted)" }}>% de desconto</span>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 16, padding: "12px 0", borderTop: "1px solid var(--border)" }}>
                <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 10 }}>Modo de exibição</span>
                <div style={{ display: "flex", gap: 8 }}>
                  {DISPLAY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => patchConfig({ display: { mode: opt.value } })}
                      style={{
                        padding: "8px 14px",
                        borderRadius: 8,
                        border: `2px solid ${config.display.mode === opt.value ? "var(--accent)" : "var(--border)"}`,
                        background: config.display.mode === opt.value ? "var(--accent-soft, rgba(15,118,110,0.08))" : "transparent",
                        font: "600 12px var(--sans)",
                        color: config.display.mode === opt.value ? "var(--accent)" : "var(--ink)",
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
