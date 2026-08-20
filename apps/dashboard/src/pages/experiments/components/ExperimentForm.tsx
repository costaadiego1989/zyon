import React, { useState } from "react";
import { Plus, X, Save, Sparkles, Info } from "lucide-react";
import type { ExperimentForm, Variant } from "../types.js";
import { Button } from "../../../components/Button.js";

interface ExperimentFormProps {
  form: ExperimentForm;
  errors: Record<string, string>;
  loading: boolean;
  onClose: () => void;
  onSave: () => void;
  patch: (p: Partial<ExperimentForm>) => void;
  addVariant: () => void;
  removeVariant: (idx: number) => void;
  updateVariant: (idx: number, updates: Partial<Variant>) => void;
}

/** Pre-built templates for common A/B test scenarios */
const AI_TEMPLATES: Record<string, { control: Partial<Variant>; challenger: Partial<Variant> }> = {
  desconto: {
    control: {
      name: "Conservador",
      description: "Você é um vendedor consultivo. Ofereça no máximo 10% de desconto e apenas quando o cliente demonstrar objeção de preço. Priorize valor percebido e benefícios do produto antes de negociar preço.",
    },
    challenger: {
      name: "Agressivo",
      description: "Você é um vendedor direto e persuasivo. Ofereça até 20% de desconto proativamente para fechar rápido. Use urgência e escassez. Mencione que a oferta é limitada ao chat atual.",
    },
  },
  abordagem: {
    control: {
      name: "Formal",
      description: "Você é um assistente profissional e cordial. Use linguagem formal (você/senhor). Apresente-se, pergunte como pode ajudar, e aguarde a iniciativa do cliente. Não pressione.",
    },
    challenger: {
      name: "Casual e proativo",
      description: "Você é um amigo que entende do assunto. Use linguagem informal (tu/vc). Sugira produtos logo de início baseado no que o cliente está olhando. Seja divertido e use emojis moderadamente.",
    },
  },
  frete: {
    control: {
      name: "Sem frete grátis",
      description: "Não mencione frete grátis a menos que o cliente reclame. Foque em prazo de entrega rápido e confiabilidade. Ofereça desconto parcial no frete apenas como último recurso.",
    },
    challenger: {
      name: "Frete grátis agressivo",
      description: "Ofereça frete grátis para compras acima de R$150 proativamente. Mencione a economia do frete como argumento de venda. Se o carrinho está próximo do mínimo, sugira adicionar um item para atingir.",
    },
  },
  upsell: {
    control: {
      name: "Sem upsell",
      description: "Foque apenas no produto que o cliente busca. Não sugira upgrades ou complementos a menos que perguntem. Ajude a finalizar a compra atual rapidamente.",
    },
    challenger: {
      name: "Upsell ativo",
      description: "Sempre que possível, sugira a versão premium ou complementos relevantes. Use frases como 'clientes que compraram X também levaram Y'. Mostre o valor extra que justifica o preço maior.",
    },
  },
};

function detectTemplate(name: string, description: string): string | null {
  const text = `${name} ${description}`.toLowerCase();
  if (text.includes("desconto") || text.includes("preço") || text.includes("oferta")) return "desconto";
  if (text.includes("abordagem") || text.includes("tom") || text.includes("estilo") || text.includes("linguagem")) return "abordagem";
  if (text.includes("frete") || text.includes("entrega") || text.includes("shipping")) return "frete";
  if (text.includes("upsell") || text.includes("cross") || text.includes("upgrade") || text.includes("complemento")) return "upsell";
  return null;
}

export function ExperimentForm({
  form,
  errors,
  loading,
  onClose,
  onSave,
  patch,
  addVariant,
  removeVariant,
  updateVariant,
}: ExperimentFormProps) {
  const [generating, setGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  function handleAiGenerate() {
    const template = detectTemplate(form.name, form.description ?? "");
    const weight = Math.round(100 / form.variants.length);

    if (!template) {
      // Generic fallback — fill ALL variants
      updateVariant(0, {
        name: "Controle (atual)",
        description: "Use o comportamento padrão do agente. Siga as regras de negociação configuradas sem alterações. Mantenha tom e abordagem atuais.",
        is_control: true,
        weight,
      });
      for (let i = 1; i < form.variants.length; i++) {
        updateVariant(i, {
          name: i === 1 ? "Abordagem Direta" : `Variante ${String.fromCharCode(65 + i)}`,
          description: i === 1
            ? `Baseado no objetivo "${form.name}": seja mais proativo, ofereça benefícios adicionais, use linguagem persuasiva para aumentar conversão.`
            : `Variação ${i + 1}: teste uma abordagem diferente das anteriores. Foque em ${i === 2 ? "urgência e escassez" : "empatia e personalização"}.`,
          is_control: false,
          weight,
        });
      }
    } else {
      const t = AI_TEMPLATES[template];
      updateVariant(0, { ...t.control, is_control: true, weight });
      for (let i = 1; i < form.variants.length; i++) {
        updateVariant(i, {
          ...(i === 1 ? t.challenger : {
            name: `Variante ${String.fromCharCode(65 + i)}`,
            description: `Abordagem alternativa para "${form.name}": combine elementos de ambas estratégias anteriores com foco em ${i === 2 ? "personalização" : "velocidade de fechamento"}.`,
          }),
          is_control: false,
          weight,
        });
      }
    }
    setGenerating(true);
    setHasGenerated(true);
    setTimeout(() => setGenerating(false), 600);
  }

  const canGenerate = form.name.trim().length >= 3;

  return (
    <div className="experiment-drawer-overlay" onClick={onClose}>
      <aside
        className="experiment-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Novo Teste A/B"
      >
        {/* Header */}
        <header className="experiment-drawer__header">
          <div>
            <h2 style={{ font: "600 15px var(--serif)", color: "var(--ink)", margin: 0 }}>
              Novo Teste A/B
            </h2>
            <p style={{ font: "12px var(--sans)", color: "var(--muted)", margin: "4px 0 0" }}>
              Compare estratégias de abordagem do agente IA
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="experiment-drawer__close">
            <X size={18} />
          </button>
        </header>

        {/* Body */}
        <div className="experiment-drawer__body">
          {/* Step 1: Context */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--accent)", color: "#fff", font: "700 11px var(--mono)", display: "flex", alignItems: "center", justifyContent: "center" }}>1</span>
              <span style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>O que você quer testar?</span>
            </div>

            <label>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>
                Título do teste
              </span>
              <input
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Ex: Abordagem agressiva vs consultiva"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 7,
                  border: `1px solid ${errors.name ? "var(--danger)" : "var(--border)"}`,
                  background: "var(--bg)",
                  color: "var(--ink)",
                  font: "13px var(--sans)",
                }}
              />
              {errors.name && (
                <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>
                  {errors.name}
                </span>
              )}
            </label>

            <label>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>
                Contexto / Objetivo
              </span>
              <textarea
                value={form.description ?? ""}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="Ex: Quero testar se um tom mais direto aumenta conversão em 15% vs o tom atual"
                rows={2}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 7,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--ink)",
                  font: "13px var(--sans)",
                  resize: "vertical",
                }}
              />
              <span style={{ font: "11px var(--sans)", color: "var(--muted)", marginTop: 4, display: "block" }}>
                Isso ajuda a IA a sugerir variantes relevantes para seu cenário
              </span>
            </label>

            {/* AI Generate Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleAiGenerate}
              disabled={!canGenerate || generating}
              loading={generating}
            >
              <Sparkles size={14} />
              {generating ? "Gerando..." : hasGenerated ? "Regenerar variantes" : "Gerar variantes com IA"}
            </Button>
            {hasGenerated && (
              <span style={{ font: "11px var(--sans)", color: "var(--muted)" }}>
                Não gostou? Ajuste o título/contexto e clique novamente
              </span>
            )}
          </div>

          {/* Divider */}
          <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "4px 0" }} />

          {/* Step 2: Variants */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--accent)", color: "#fff", font: "700 11px var(--mono)", display: "flex", alignItems: "center", justifyContent: "center" }}>2</span>
                <span style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>Variantes</span>
              </div>
              <Button size="sm" onClick={addVariant}>
                <Plus size={12} /> Adicionar
              </Button>
            </div>

            {errors.variants && (
              <span style={{ font: "11px var(--sans)", color: "var(--danger)", display: "block" }}>
                {errors.variants}
              </span>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {form.variants.map((v, idx) => {
                const isControl = idx === 0;
                const variantLabel = isControl ? "Como o agente age HOJE" : `Nova abordagem ${form.variants.length > 2 ? String.fromCharCode(65 + idx) : ""}`.trim();

                return (
                <div
                  key={idx}
                  style={{
                    background: isControl ? "oklch(25% 0.02 160 / 0.3)" : "var(--bg)",
                    border: `1px solid ${isControl ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 12,
                    padding: 16,
                    position: "relative",
                    transition: "border-color 0.2s, background 0.2s",
                  }}
                >
                  {/* Fixed role label */}
                  <span style={{
                    position: "absolute", top: -9, left: 14,
                    font: "600 9px var(--mono)",
                    color: isControl ? "var(--accent)" : "var(--warning, #f59e0b)",
                    background: "var(--card)", padding: "2px 8px",
                    borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.06em",
                    border: `1px solid ${isControl ? "var(--accent)" : "var(--warning, #f59e0b)"}`,
                  }}>
                    {isControl ? "● Atual (controle)" : "◆ Desafiante"}
                  </span>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                    {/* Variant name */}
                    <input
                      value={v.name}
                      onChange={(e) => updateVariant(idx, { name: e.target.value })}
                      placeholder={isControl ? "Ex: Consultivo, paciente, sem pressão" : "Ex: Direto, agressivo, usa urgência"}
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "var(--card)",
                        color: "var(--ink)",
                        font: "600 13px var(--sans)",
                      }}
                    />

                    {/* Instruction */}
                    <div>
                      <span style={{ font: "600 10px var(--mono)", color: "var(--muted)", display: "block", marginBottom: 4, textTransform: "uppercase" }}>
                        {isControl ? "Como o agente se comporta hoje?" : "Como quer que ele se comporte neste teste?"}
                      </span>
                      <textarea
                        value={v.description ?? ""}
                        onChange={(e) => updateVariant(idx, { description: e.target.value })}
                        placeholder={isControl
                          ? "Descreva o comportamento atual do agente. Ex: 'Atende de forma consultiva, pergunta antes de oferecer desconto, tom educado e paciente...'"
                          : "Descreva a nova abordagem. Ex: 'Seja direto, ofereça 15% logo de início, mencione que é oferta exclusiva do chat, use escassez...'"
                        }
                        rows={4}
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "var(--card)",
                          color: "var(--ink)",
                          font: "12px var(--sans)",
                          resize: "vertical",
                          lineHeight: 1.5,
                        }}
                      />
                    </div>

                    {/* Footer: traffic + remove */}
                    <div style={{ display: "flex", alignItems: "center", paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                      <span style={{
                        font: "600 11px var(--mono)",
                        color: "var(--muted)",
                        background: "var(--card)",
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                      }}>
                        {Math.round(100 / form.variants.length)}% do público
                      </span>
                      <span style={{ font: "11px var(--sans)", color: "var(--muted)", marginLeft: 8 }}>
                        {variantLabel}
                      </span>
                      {!isControl && form.variants.length > 2 && (
                        <button
                          onClick={() => removeVariant(idx)}
                          aria-label="Remover variante"
                          style={{
                            marginLeft: "auto",
                            background: "var(--danger-soft)",
                            border: "1px solid var(--danger)",
                            borderRadius: 6,
                            padding: "5px 8px",
                            cursor: "pointer",
                            color: "var(--danger)",
                            font: "11px var(--sans)",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <X size={12} /> Remover
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "4px 0" }} />

          {/* Step 3: Sample */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--accent)", color: "#fff", font: "700 11px var(--mono)", display: "flex", alignItems: "center", justifyContent: "center" }}>3</span>
              <span style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>Quando encerrar?</span>
            </div>

            <label>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>
                Sessões por variante (mín. para significância)
              </span>
              <input
                type="number"
                value={form.sample_size}
                onChange={(e) => patch({ sample_size: Number(e.target.value) })}
                min="10"
                max="1000000"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 7,
                  border: `1px solid ${errors.sample_size ? "var(--danger)" : "var(--border)"}`,
                  background: "var(--bg)",
                  color: "var(--ink)",
                  font: "13px var(--mono)",
                }}
              />
              {errors.sample_size && (
                <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>
                  {errors.sample_size}
                </span>
              )}
              <span style={{ font: "11px var(--sans)", color: "var(--muted)", marginTop: 6, display: "block" }}>
                Recomendado: 100+ sessões por variante para confiança ≥ 95%
              </span>
            </label>
          </div>

          {/* Info Box */}
          <div style={{ display: "flex", gap: 10, padding: "12px 14px", background: "oklch(50% 0.04 240 / 0.12)", borderRadius: 8, marginTop: 8 }}>
            <Info size={16} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
            <div style={{ font: "12px var(--sans)", color: "var(--muted)", lineHeight: 1.5 }}>
              <strong style={{ color: "var(--ink)" }}>Como funciona:</strong> Ao iniciar, cada sessão de compra recebe uma variante aleatória.
              O agente IA usa a instrução (prompt) daquela variante para conduzir toda a conversa.
              Ao final, comparamos taxa de conversão e ticket médio entre variantes.
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="experiment-drawer__footer">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={onSave} loading={loading} disabled={Object.keys(errors).length > 0}>
            <Save size={14} /> Criar Teste
          </Button>
        </footer>
      </aside>
    </div>
  );
}
