import React, { useEffect, useMemo, useState } from "react";
import { Save, ChevronDown, ChevronRight, X, Plus, Info } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
import { useApi } from "../hooks/useApi.js";
import { SaveFeedbackBanner } from "../components/save-feedback-banner.js";
import { TabBar } from "../components/TabBar.js";
import { showToast } from "../components/Toast.js";
import type { StageQuickReplies, AgentTone } from "@zyon/shared-types";

const TONE_PT_TO_EN: Record<string, AgentTone> = {
  "Consultivo": "consultative",
  "Premium": "premium",
  "Direto": "direct",
  "Amigável": "friendly",
  "Técnico": "technical"
};

const TONE_EN_TO_PT = Object.fromEntries(Object.entries(TONE_PT_TO_EN).map(([k, v]) => [v, k]));

export interface AgentConfigPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

export interface AgentConfigForm {
  agentName: string;
  persona: string;
  tone: AgentTone;
  language: string;
  greeting: string;
  maxDiscountPercent: string;
  minimumMarginPercent: string;
  quickReplies: StageQuickReplies | undefined;
}

const DEFAULT_FORM: AgentConfigForm = {
  agentName: "Assistente",
  persona: "",
  tone: "consultative",
  language: "pt-BR",
  greeting: "Olá! Como posso ajudá-lo?",
  maxDiscountPercent: "10",
  minimumMarginPercent: "15",
  quickReplies: undefined,
};

export function validateAgentConfig(form: AgentConfigForm): Record<string, string> {
  const errors: Record<string, string> = {};

  if (form.agentName.trim().length > 100) {
    errors.agentName = "Máximo 100 caracteres";
  }

  if (form.persona.length > 200) {
    errors.persona = "Máximo 200 caracteres";
  }

  if (form.greeting.length > 500) {
    errors.greeting = "Máximo 500 caracteres";
  }

  const maxDiscount = Number(form.maxDiscountPercent);
  if (Number.isNaN(maxDiscount) || maxDiscount < 0 || maxDiscount > 100) {
    errors.maxDiscountPercent = "Informe um valor entre 0 e 100";
  }

  const minMargin = Number(form.minimumMarginPercent);
  if (Number.isNaN(minMargin) || minMargin < 0 || minMargin > 100) {
    errors.minimumMarginPercent = "Informe um valor entre 0 e 100";
  }

  return errors;
}

export function AgentConfigPage(_props: AgentConfigPageProps) {
  const api = useApi();
  const [form, setForm] = useState<AgentConfigForm>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<"identity" | "negotiation" | "quick-replies">("identity");
  const [stageQrConfig, setStageQrConfig] = useState<StageQrConfig>(DEFAULT_STAGE_QR);

  const errors = useMemo(() => validateAgentConfig(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;

  useEffect(() => {
    if (!_props.me) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rules = await api.getMerchantRules();
        const ar = await api.getAgentRules();
        if (cancelled) return;

        const arUnknown = ar as unknown as Record<string, unknown>;
        const rulesUnknown = rules as unknown as Record<string, unknown>;
        const identity = (arUnknown.identity ?? {}) as Record<string, unknown>;

        setForm({
          agentName: String(identity.agentName ?? "Assistente"),
          persona: String(identity.persona ?? ""),
          tone: isValidTone(identity.tone) ? identity.tone : "consultative",
          language: String(identity.language ?? "pt-BR"),
          greeting: String(identity.greeting ?? ""),
          maxDiscountPercent: String(rulesUnknown.maxDiscountPercent ?? 10),
          minimumMarginPercent: String(rulesUnknown.minimumMarginPercent ?? 15),
          quickReplies: (rulesUnknown.quickReplies as unknown as StageQuickReplies | undefined) ?? undefined,
        });
      } catch (e) {
        if (cancelled) return;
        setSaveError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [api, _props.me]);

  function patch(p: Partial<AgentConfigForm>) {
    setForm((prev) => ({ ...prev, ...p }));
  }

  async function handleSave() {
    if (hasErrors) {
      setSaveResult("error");
      setSaveError("Corrija os erros antes de salvar");
      return;
    }
    setSaving(true);
    setSaveResult(null);
    setSaveError(null);
    try {
      const rulesPatch: Record<string, unknown> = {
        maxDiscountPercent: Number(form.maxDiscountPercent),
        minimumMarginPercent: Number(form.minimumMarginPercent),
        quickReplies: form.quickReplies,
      };
      await api.putMerchantRules(rulesPatch as never);

      // Send agent rules in proper nested format
      const agentRulesPatch = {
        identity: {
          agentName: form.agentName,
          persona: form.persona,
          tone: form.tone,
          language: form.language,
          greeting: form.greeting,
        }
      };
      await api.putAgentRules(agentRulesPatch as never);

      setSaveResult("success");
      showToast("success", "Configurações do agente salvas com sucesso");
    } catch (e) {
      setSaveResult("error");
      setSaveError(e instanceof Error ? e.message : String(e));
      showToast("error", "Erro ao salvar configurações do agente");
    } finally {
      setSaving(false);
    }
  }

  if (!_props.me) {
    return (
      <header className="page-head">
        <div>
          <h1>Agente da loja</h1>
          <p className="page-lead">Login necessário.</p>
        </div>
      </header>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>LOJA</div>
          <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Agente da loja</h1>
          <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Personalize o agente que atende seus clientes.</div>
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!loaded || saving || hasErrors}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--accent-dark)", background: "var(--accent-dark)", font: "600 12.5px var(--sans)", color: "white", cursor: !loaded || saving || hasErrors ? "not-allowed" : "pointer", opacity: !loaded || saving || hasErrors ? 0.6 : 1, flex: "none" }}
        >
          <Save size={14} /> {saving ? "Salvando..." : "Salvar alterações"}
        </button>
      </div>

      <SaveFeedbackBanner
        result={saveResult}
        errorMessage={saveError ?? undefined}
        onDismiss={() => { setSaveResult(null); setSaveError(null); }}
      />

      {loading ? (
        <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>Carregando configuração do agente...</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Tabs */}
          <TabBar
            tabs={[
              { key: "identity", label: "Identidade" },
              { key: "negotiation", label: "Negociação" },
              { key: "quick-replies", label: "Quick Replies" },
            ]}
            activeTab={activeTab}
            onTabChange={(k) => setActiveTab(k as typeof activeTab)}
          />

          {/* Identity Tab */}
          {activeTab === "identity" && (
            <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
              <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>IDENTIDADE DO AGENTE</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Nome do Agente</span>
                  <input value={form.agentName} onChange={(e) => patch({ agentName: e.target.value })} placeholder="Assistente" style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${errors.agentName ? "var(--danger)" : "var(--border)"}`, background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }} />
                  {errors.agentName && <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{errors.agentName}</span>}
                </label>
                <label>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Idioma</span>
                  <select value={form.language} onChange={(e) => patch({ language: e.target.value })} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}>
                    <option value="pt-BR">Português (BR)</option>
                    <option value="en-US">English (US)</option>
                    <option value="es-ES">Español</option>
                  </select>
                </label>
                <label>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                    Tom de Voz
                    <span title="Define o estilo de comunicação do agente: Consultivo (orientação), Premium (exclusividade), Direto (objetivo), Amigável (casual), Técnico (preciso)" style={{ color: "var(--faint)", cursor: "help", display: "inline-flex" }}><Info size={12} /></span>
                  </span>
                  <select value={form.tone} onChange={(e) => patch({ tone: e.target.value as AgentTone })} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}>
                    {Object.entries(TONE_PT_TO_EN).map(([label, value]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                    Persona
                    <span title="Descreva brevemente quem é o agente: ex. 'Vendedora simpática de loja de roupas femininas' ou 'Especialista em tecnologia que simplifica termos complexos'" style={{ color: "var(--faint)", cursor: "help", display: "inline-flex" }}><Info size={12} /></span>
                  </span>
                  <input value={form.persona} onChange={(e) => patch({ persona: e.target.value })} placeholder="Ex: Vendedora experiente e atenciosa" style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${errors.persona ? "var(--danger)" : "var(--border)"}`, background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }} />
                  {errors.persona && <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{errors.persona}</span>}
                </label>
              </div>
              <div style={{ marginTop: 12 }}>
                <label>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                    Texto de Apresentação
                    <span title="Este é o primeiro texto que o cliente verá ao abrir o chat. Apresente o agente e diga como ele pode ajudar." style={{ color: "var(--faint)", cursor: "help", display: "inline-flex" }}><Info size={12} /></span>
                  </span>
                  <textarea value={form.greeting} onChange={(e) => patch({ greeting: e.target.value })} placeholder="Olá! Sou a Micha 👋&#10;A partir de agora serei sua vendedora particular e irei te ajudar a encontrar produtos, aplicar cupons, calcular frete e finalizar sua compra de forma bem fluida e fácil. Vamos começar!" rows={4} style={{ width: "100%", padding: "9px 10px", borderRadius: 7, border: `1px solid ${errors.greeting ? "var(--danger)" : "var(--border)"}`, background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)", resize: "vertical", lineHeight: 1.5 }} />
                  {errors.greeting && <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{errors.greeting}</span>}
                </label>
              </div>
            </section>
          )}

          {/* Negotiation Tab */}
          {activeTab === "negotiation" && (
            <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
              <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>LIMITES DE NEGOCIAÇÃO</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <NumberField label="Desconto máximo (%)" value={form.maxDiscountPercent} onChange={(v) => patch({ maxDiscountPercent: v })} error={errors.maxDiscountPercent} />
                <NumberField label="Margem mínima (%)" value={form.minimumMarginPercent} onChange={(v) => patch({ minimumMarginPercent: v })} error={errors.minimumMarginPercent} />
              </div>
            </section>
          )}

          {/* Quick Replies Tab */}
          {activeTab === "quick-replies" && (
            <StageQuickRepliesEditor config={stageQrConfig} onChange={setStageQrConfig} />
          )}
        </div>
      )}
    </div>
  );
}

function NumberField(props: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <label>
      <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>{props.label}</span>
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${props.error ? "var(--danger)" : "var(--border)"}`, background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--mono)" }}
      />
      {props.error ? (
        <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{props.error}</span>
      ) : null}
    </label>
  );
}

const VALID_TONES: AgentTone[] = ["consultative", "premium", "direct", "friendly", "technical"];

function isValidTone(value: unknown): value is AgentTone {
  return typeof value === "string" && VALID_TONES.includes(value as AgentTone);
}

type StageQrStage = { stage: string; label: string; replies: string[] };
type StageQrConfig = { stages: StageQrStage[]; fallback: string[] };

const DEFAULT_STAGE_QR: StageQrConfig = {
  stages: [
    { stage: "welcome", label: "Início", replies: ["Ver Produtos", "Encontrar Produto", "Categorias", "Prazo de Entrega", "Trocas e Devoluções", "Rastrear Pedido", "Meus Dados", "Ofertas"] },
    { stage: "browsing", label: "Navegação", replies: ["Selecionar Produto", "Filtrar Produtos", "Categorias", "Ofertas do Dia", "Voltar ao Início"] },
    { stage: "filter", label: "Filtros", replies: ["Por Preço", "Por Avaliação", "Mais Vendidos", "Novidades", "Frete Grátis", "Por Desconto", "Limpar Filtros"] },
    { stage: "categories", label: "Categorias", replies: ["Ver Todas", "Filtrar Categoria", "Voltar"] },
    { stage: "product_detail", label: "Detalhe do Produto", replies: ["Adicionar ao Carrinho", "Mais Informações", "Ver Avaliações", "Tirar Dúvidas", "Comparar", "Lista de Desejos", "Produtos Semelhantes", "Voltar"] },
    { stage: "more_info", label: "Informações", replies: ["Especificações Técnicas", "Dimensões e Peso", "Material", "Garantia", "Prazo de Entrega", "Voltar ao Produto"] },
    { stage: "reviews", label: "Avaliações", replies: ["Escrever Avaliação", "Positivas", "Negativas", "Ordenar por Recentes", "Voltar ao Produto"] },
    { stage: "review_card", label: "Avaliação Selecionada", replies: ["Curtir", "Responder", "Reportar", "Voltar às Avaliações"] },
    { stage: "questions", label: "Dúvidas", replies: ["Fazer Pergunta", "Ver Respondidas", "Minhas Perguntas", "Voltar ao Produto"] },
    { stage: "compare", label: "Comparação", replies: ["Ver Tabela Comparativa", "Escolher Outro", "Adicionar ao Carrinho", "Voltar ao Produto"] },
    { stage: "wishlist", label: "Lista de Desejos", replies: ["Ver Lista", "Compartilhar", "Mover para Carrinho", "Remover Item", "Voltar"] },
    { stage: "added_to_cart", label: "Adicionado ao Carrinho", replies: ["Ver Carrinho", "Continuar Comprando", "Produtos Similares", "Aplicar Cupom", "Finalizar Compra"] },
    { stage: "post_purchase", label: "Pós-compra", replies: ["Rastrear Pedido", "Nota Fiscal", "Alterar Endereço", "Cancelar Pedido", "Avaliar Produto", "Suporte"] },
    { stage: "support", label: "Suporte", replies: ["FAQ", "Falar com Humano", "Reportar Problema", "Status do Pedido", "Voltar ao Início"] },
  ],
  fallback: ["Ver Produtos", "Categorias", "Meus Dados", "Suporte"],
};

function StageQuickRepliesEditor({ config, onChange }: { config: StageQrConfig; onChange: (c: StageQrConfig) => void }) {
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [newReply, setNewReply] = useState("");

  function removeReply(stageIdx: number, replyIdx: number) {
    const updated = { ...config, stages: config.stages.map((s, i) => i === stageIdx ? { ...s, replies: s.replies.filter((_, ri) => ri !== replyIdx) } : s) };
    onChange(updated);
  }

  function addReply(stageIdx: number) {
    if (!newReply.trim()) return;
    const updated = { ...config, stages: config.stages.map((s, i) => i === stageIdx ? { ...s, replies: [...s.replies, newReply.trim()] } : s) };
    onChange(updated);
    setNewReply("");
  }

  function resetStage(stageIdx: number) {
    const defaultStage = DEFAULT_STAGE_QR.stages[stageIdx];
    if (!defaultStage) return;
    const updated = { ...config, stages: config.stages.map((s, i) => i === stageIdx ? { ...s, replies: [...defaultStage.replies] } : s) };
    onChange(updated);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ font: "600 13px var(--sans)", color: "var(--ink)", margin: 0 }}>Quick Replies por Estágio</h3>
        <p style={{ font: "12px var(--sans)", color: "var(--muted)", marginTop: 4, margin: 0 }}>Configure as sugestões em cada etapa da jornada de compra</p>
      </div>
      {config.stages.map((stage, stageIdx) => {
        const isExpanded = expandedStage === stage.stage;
        return (
          <div key={stage.stage} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            <button type="button" onClick={() => setExpandedStage(isExpanded ? null : stage.stage)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", border: "none", background: "transparent", cursor: "pointer", color: "var(--ink)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span style={{ font: "600 13px var(--sans)" }}>{stage.label}</span>
                <span style={{ font: "11px var(--mono)", color: "var(--faint)" }}>{stage.stage}</span>
              </div>
              <span style={{ font: "11px var(--mono)", color: "var(--muted)" }}>{stage.replies.length} replies</span>
            </button>
            {isExpanded && (
              <div style={{ padding: "0 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {stage.replies.map((reply, ri) => (
                    <span key={ri} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--accent-soft)", color: "var(--accent)", borderRadius: 999, padding: "4px 12px", font: "12px var(--sans)" }}>
                      {reply}
                      <button type="button" onClick={() => removeReply(stageIdx, ri)} style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", padding: 0, display: "flex" }}><X size={12} /></button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={newReply} onChange={(e) => setNewReply(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addReply(stageIdx); } }} placeholder="Nova resposta..." style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12px var(--sans)" }} />
                  <button type="button" onClick={() => addReply(stageIdx)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink)", cursor: "pointer", font: "600 11px var(--sans)", display: "flex", alignItems: "center", gap: 4 }}><Plus size={12} /> Adicionar</button>
                  <button type="button" onClick={() => resetStage(stageIdx)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--muted)", cursor: "pointer", font: "600 11px var(--sans)" }}>Resetar</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}