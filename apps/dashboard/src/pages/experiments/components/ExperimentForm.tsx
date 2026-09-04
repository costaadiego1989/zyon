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
  /** Generate the challenger variant prompt via the real LLM endpoint. */
  onGenerateVariants?: () => void | Promise<void>;
  /** True while the LLM call is in flight. */
  generatingVariants?: boolean;
}


const CHALLENGER_ANGLES = [
  {
    angle: "Abordagem direta e proativa",
    strategy: "Proatividade. Nao espere o cliente pedir. Antecipe necessidades, sugira acoes, ofereca ajuda antes de ser perguntado.",
    tone: "Energetico, confiante, direto. Frases curtas de impacto. 1-2 emojis por mensagem.",
    triggers: "- Cliente demonstra interesse -> empurre para acao\n- Hesitacao -> ofereca incentivo\n- Carrinho com itens -> sugira fechamento",
    examples: "- \"Excelente escolha! Esse eh nosso mais vendido. Adiciono?\"\n- \"Consigo um preco especial se fechar agora!\"\n- \"Vi que gostou! Tenho algo que combina - mostro?\"",
    prohibitions: "- NUNCA espere o cliente tomar iniciativa\n- NUNCA seja passivo\n- NUNCA perca oportunidade de sugerir acao",
  },
  {
    angle: "Empatia e personalizacao",
    strategy: "Conexao antes de conversao. Pergunte preferencias, entenda contexto, personalize. Atendimento exclusivo.",
    tone: "Caloroso, atencioso, consultivo. Como personal shopper. Perguntas abertas.",
    triggers: "- Primeiro contato -> pergunte o que busca\n- Cliente ve produto -> pergunte preferencias\n- Antes de sugerir -> contextualize",
    examples: "- \"Me conta: eh pra voce ou pra presentear?\"\n- \"Baseado no que disse, separei 3 opcoes perfeitas\"\n- \"Entendi seu estilo! Olha esse que combina\"",
    prohibitions: "- NUNCA sugira sem entender contexto\n- NUNCA trate como mais um\n- NUNCA apresse a decisao",
  },
  {
    angle: "Urgencia e escassez",
    strategy: "FOMO. Destaque estoque limitado, prazos, ofertas exclusivas do chat.",
    tone: "Empolgado, assertivo. Emojis de urgencia. Frases que criam acao imediata.",
    triggers: "- Produto visualizado -> mencione estoque\n- Hesitacao -> oferta exclusiva do chat\n- Carrinho parado -> prazo do desconto",
    examples: "- \"Ultimas unidades! Garanto o seu se fechar agora\"\n- \"Oferta exclusiva: X% OFF so nesse chat\"\n- \"Esse preco nao vai existir depois que sair daqui\"",
    prohibitions: "- NUNCA minta sobre estoque ou prazos\n- NUNCA repita urgencia mais de 2x\n- NUNCA ignore irritacao do cliente",
  },
  {
    angle: "Social proof e autoridade",
    strategy: "Validacao social. Cite avaliacoes, vendas, tendencias. Posicione-se como especialista.",
    tone: "Confiante, informativo, expert. Dados concretos.",
    triggers: "- Qualquer produto -> mencione avaliacao\n- Hesitacao -> cite numero de vendas\n- Comparacao -> use satisfacao para recomendar",
    examples: "- \"Esse eh nosso #1 em vendas - avaliacao 4.9\"\n- \"Clientes que levaram esse voltam pra comprar em outra cor\"\n- \"Essa versao tem satisfacao 30% maior\"",
    prohibitions: "- NUNCA invente numeros\n- NUNCA cite social proof sem dados\n- NUNCA ignore preferencia pessoal",
  },
];

function buildVariantPrompt(opts: { role: "control" | "challenger"; index: number; name: string; description: string }): { name: string; description: string } {
  const objective = opts.description ? `${opts.name} - ${opts.description}` : opts.name;

  if (opts.role === "control") {
    return {
      name: "Controle (atual)",
      description: [
        `PAPEL: Mantenha o comportamento padrao. Voce eh a referencia de comparacao para "${opts.name}".`,
        "",
        "ESTRATEGIA: Siga as regras de negociacao configuradas sem alteracoes. Atenda normalmente.",
        "",
        "TOM: Use o tom ja configurado (identidade do agente).",
        "",
        `OBJETIVO DO TESTE: "${objective}"`,
        "-> Nesta variante voce NAO muda nada. Serve como baseline.",
        "",
        "PROIBICOES:",
        "- Nao altere seu comportamento",
        "- Aja como se este teste nao existisse",
      ].join("\n"),
    };
  }

  const angle = CHALLENGER_ANGLES[(opts.index - 1) % CHALLENGER_ANGLES.length];

  return {
    name: angle.angle,
    description: [
      `PAPEL: Vendedor focado em "${opts.name}". Use a abordagem "${angle.angle}".`,
      "",
      `OBJETIVO: ${objective}`,
      "",
      `ESTRATEGIA: ${angle.strategy}`,
      "",
      `TOM: ${angle.tone}`,
      "",
      "GATILHOS:",
      angle.triggers,
      "",
      "EXEMPLOS DE COMO RESPONDER:",
      angle.examples,
      "",
      "PROIBICOES:",
      angle.prohibitions,
    ].join("\n"),
  };
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
  onGenerateVariants,
  generatingVariants,
}: ExperimentFormProps) {
  const [templateGenerating, setTemplateGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  // Deterministic template fallback — used only when the real LLM handler
  // is not wired (kept so the form still works offline / without an API key).
  function fillFromTemplate() {
    const weight = Math.round(100 / form.variants.length);
    const name = form.name.trim();
    const desc = form.description?.trim() || "";

    for (let i = 0; i < form.variants.length; i++) {
      const generated = buildVariantPrompt({
        role: i === 0 ? "control" : "challenger",
        index: i,
        name,
        description: desc,
      });
      updateVariant(i, {
        name: generated.name,
        description: generated.description,
        is_control: i === 0,
        weight,
      });
    }
    setTemplateGenerating(true);
    setHasGenerated(true);
    setTimeout(() => setTemplateGenerating(false), 400);
  }

  async function handleAiGenerate() {
    if (onGenerateVariants) {
      // Real LLM path (same engine as product catalog description generator).
      await onGenerateVariants();
      setHasGenerated(true);
      return;
    }
    // Fallback: deterministic local template.
    fillFromTemplate();
  }

  const generating = Boolean(generatingVariants) || templateGenerating;
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
            <h2 style={{ font: "600 15px var(--font-serif)", color: "var(--color-text)", margin: 0 }}>
              Novo Teste A/B
            </h2>
            <p style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", margin: "4px 0 0" }}>
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
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--color-brand)", color: "#fff", font: "700 11px var(--font-mono)", display: "flex", alignItems: "center", justifyContent: "center" }}>1</span>
              <span style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)" }}>O que você quer testar?</span>
            </div>

            <label>
              <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 4 }}>
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
                  border: `1px solid ${errors.name ? "var(--color-error)" : "var(--color-border)"}`,
                  background: "var(--surface-1)",
                  color: "var(--color-text)",
                  font: "13px var(--font-sans)",
                }}
              />
              {errors.name && (
                <span style={{ font: "11px var(--font-sans)", color: "var(--color-error)", marginTop: 4, display: "block" }}>
                  {errors.name}
                </span>
              )}
            </label>

            <label>
              <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 4 }}>
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
                  border: "1px solid var(--color-border)",
                  background: "var(--surface-1)",
                  color: "var(--color-text)",
                  font: "13px var(--font-sans)",
                  resize: "vertical",
                }}
              />
              <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 4, display: "block" }}>
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
              <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>
                Não gostou? Ajuste o título/contexto e clique novamente
              </span>
            )}
          </div>

          {/* Divider */}
          <hr style={{ border: "none", borderTop: "1px solid var(--color-border)", margin: "4px 0" }} />

          {/* Step 2: Variants */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--color-brand)", color: "#fff", font: "700 11px var(--font-mono)", display: "flex", alignItems: "center", justifyContent: "center" }}>2</span>
                <span style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)" }}>Variantes</span>
              </div>
              <Button size="sm" onClick={addVariant}>
                <Plus size={12} /> Adicionar
              </Button>
            </div>

            {errors.variants && (
              <span style={{ font: "11px var(--font-sans)", color: "var(--color-error)", display: "block" }}>
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
                    background: isControl ? "oklch(25% 0.02 160 / 0.3)" : "var(--surface-1)",
                    border: `1px solid ${isControl ? "var(--color-brand)" : "var(--color-border)"}`,
                    borderRadius: 12,
                    padding: 16,
                    position: "relative",
                    transition: "border-color 0.2s, background 0.2s",
                  }}
                >
                  {/* Fixed role label */}
                  <span style={{
                    position: "absolute", top: -9, left: 14,
                    font: "600 9px var(--font-mono)",
                    color: isControl ? "var(--color-brand)" : "var(--warning, #f59e0b)",
                    background: "var(--surface-2)", padding: "2px 8px",
                    borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.06em",
                    border: `1px solid ${isControl ? "var(--color-brand)" : "var(--warning, #f59e0b)"}`,
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
                        border: "1px solid var(--color-border)",
                        background: "var(--surface-2)",
                        color: "var(--color-text)",
                        font: "600 13px var(--font-sans)",
                      }}
                    />

                    {/* Instruction */}
                    <div>
                      <span style={{ font: "600 10px var(--font-mono)", color: "var(--color-text-muted)", display: "block", marginBottom: 4, textTransform: "uppercase" }}>
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
                          border: "1px solid var(--color-border)",
                          background: "var(--surface-2)",
                          color: "var(--color-text)",
                          font: "12px var(--font-sans)",
                          resize: "vertical",
                          lineHeight: 1.5,
                        }}
                      />
                    </div>

                    {/* Footer: traffic + remove */}
                    <div style={{ display: "flex", alignItems: "center", paddingTop: 8, borderTop: "1px solid var(--color-border)" }}>
                      <span style={{
                        font: "600 11px var(--font-mono)",
                        color: "var(--color-text-muted)",
                        background: "var(--surface-2)",
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: "1px solid var(--color-border)",
                      }}>
                        {Math.round(100 / form.variants.length)}% do público
                      </span>
                      <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)", marginLeft: 8 }}>
                        {variantLabel}
                      </span>
                      {!isControl && form.variants.length > 2 && (
                        <button
                          onClick={() => removeVariant(idx)}
                          aria-label="Remover variante"
                          style={{
                            marginLeft: "auto",
                            background: "var(--color-error-bg)",
                            border: "1px solid var(--color-error)",
                            borderRadius: 6,
                            padding: "5px 8px",
                            cursor: "pointer",
                            color: "var(--color-error)",
                            font: "11px var(--font-sans)",
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
          <hr style={{ border: "none", borderTop: "1px solid var(--color-border)", margin: "4px 0" }} />

          {/* Step 3: Sample */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--color-brand)", color: "#fff", font: "700 11px var(--font-mono)", display: "flex", alignItems: "center", justifyContent: "center" }}>3</span>
              <span style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)" }}>Quando encerrar?</span>
            </div>

            <label>
              <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 4 }}>
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
                  border: `1px solid ${errors.sample_size ? "var(--color-error)" : "var(--color-border)"}`,
                  background: "var(--surface-1)",
                  color: "var(--color-text)",
                  font: "13px var(--font-mono)",
                }}
              />
              {errors.sample_size && (
                <span style={{ font: "11px var(--font-sans)", color: "var(--color-error)", marginTop: 4, display: "block" }}>
                  {errors.sample_size}
                </span>
              )}
              <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 6, display: "block" }}>
                Recomendado: 100+ sessões por variante para confiança ≥ 95%
              </span>
            </label>
          </div>

          {/* Info Box */}
          <div style={{ display: "flex", gap: 10, padding: "12px 14px", background: "oklch(50% 0.04 240 / 0.12)", borderRadius: 8, marginTop: 8 }}>
            <Info size={16} style={{ color: "var(--color-brand)", flexShrink: 0, marginTop: 2 }} />
            <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
              <strong style={{ color: "var(--color-text)" }}>Como funciona:</strong> Ao iniciar, cada sessão de compra recebe uma variante aleatória.
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
