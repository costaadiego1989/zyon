import React, { useState } from "react";
import { Save, ChevronDown, ChevronRight, X, Plus, Info } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
import { Button } from "../components/Button.js";
import { SectionHeader } from "../components/SectionHeader.js";
import { TabBar } from "../components/TabBar.js";
import { useAgentConfigPage, TONE_PT_TO_EN, DEFAULT_STAGE_QR, type StageQrConfig } from "./useAgentConfigPage.js";
import type { AgentTone } from "@zyon/shared-types";

export interface AgentConfigPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

export function AgentConfigPage(props: AgentConfigPageProps) {
  const vm = useAgentConfigPage({ me: props.me });

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <span className="eyebrow">Agente IA</span>
          <h1>Configuração do Agente</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <header className="page-head">
          <div>
            <span className="eyebrow">Agente IA</span>
            <h1>Configuração do Agente</h1>
            <p className="page-lead">Personalize o agente que atende seus clientes</p>
          </div>
        </header>
        <Button variant="primary" size="sm" arrow onClick={() => void vm.handleSave()} disabled={!vm.loaded || vm.saving || vm.hasErrors} loading={vm.saving}>
          <Save size={14} /> Salvar alterações
        </Button>
      </div>

      {vm.loading ? (
        <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>Carregando configuração do agente...</div>
      ) : (
        <div className="page-container">
          <TabBar
            tabs={[
              { key: "identity", label: "Identidade" },
              { key: "quick-replies", label: "Quick Replies" },
            ]}
            activeTab={vm.activeTab}
            onTabChange={(k) => vm.setActiveTab(k as typeof vm.activeTab)}
          />

          {vm.activeTab === "identity" && (
            <section style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: "20px 22px" }}>
              <SectionHeader title="Identidade do Agente" variant="secondary" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 4 }}>Nome do Agente</span>
                  <input value={vm.form.agentName} onChange={(e) => vm.patch({ agentName: e.target.value })} placeholder="Assistente" style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${vm.errors.agentName ? "var(--color-error)" : "var(--color-border)"}`, background: "var(--surface-1)", color: "var(--color-text)", font: "12.5px var(--font-sans)" }} />
                  {vm.errors.agentName && <span style={{ font: "11px var(--font-sans)", color: "var(--color-error)", marginTop: 4, display: "block" }}>{vm.errors.agentName}</span>}
                </label>
                <label>
                  <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 4 }}>Idioma</span>
                  <select value={vm.form.language} onChange={(e) => vm.patch({ language: e.target.value })} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--surface-1)", color: "var(--color-text)", font: "12.5px var(--font-sans)" }}>
                    <option value="pt-BR">Português (BR)</option>
                    <option value="en-US">English (US)</option>
                    <option value="es-ES">Español</option>
                  </select>
                </label>
                <label>
                  <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                    Tom de Voz
                    <span title="Define o estilo de comunicação: Consultivo (orientação), Premium (exclusividade), Direto (objetivo), Amigável (casual), Técnico (preciso)" style={{ color: "var(--color-text-faint)", cursor: "help", display: "inline-flex" }}><Info size={12} /></span>
                  </span>
                  <select value={vm.form.tone} onChange={(e) => vm.patch({ tone: e.target.value as AgentTone })} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--surface-1)", color: "var(--color-text)", font: "12.5px var(--font-sans)" }}>
                    {Object.entries(TONE_PT_TO_EN).map(([label, value]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                    Persona
                    <span title="Descreva quem é o agente: ex. 'Vendedora simpática de loja feminina' ou 'Especialista em tech'" style={{ color: "var(--color-text-faint)", cursor: "help", display: "inline-flex" }}><Info size={12} /></span>
                  </span>
                  <input value={vm.form.persona} onChange={(e) => vm.patch({ persona: e.target.value })} placeholder="Ex: Vendedora experiente e atenciosa" style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${vm.errors.persona ? "var(--color-error)" : "var(--color-border)"}`, background: "var(--surface-1)", color: "var(--color-text)", font: "12.5px var(--font-sans)" }} />
                  {vm.errors.persona && <span style={{ font: "11px var(--font-sans)", color: "var(--color-error)", marginTop: 4, display: "block" }}>{vm.errors.persona}</span>}
                </label>
              </div>
              <div style={{ marginTop: 12 }}>
                <label>
                  <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
                    Texto de Apresentação (Storefront)
                    <span title="Primeiro texto que o cliente vê ao abrir o chat na loja. Apresente o agente e diga como ele pode ajudar." style={{ color: "var(--color-text-faint)", cursor: "help", display: "inline-flex" }}><Info size={12} /></span>
                  </span>
                  <textarea value={vm.form.greeting} onChange={(e) => vm.patch({ greeting: e.target.value })} placeholder={"Olá! Sou a Micha 👋\nA partir de agora serei sua vendedora particular..."} rows={3} style={{ width: "100%", padding: "9px 10px", borderRadius: 7, border: `1px solid ${vm.errors.greeting ? "var(--color-error)" : "var(--color-border)"}`, background: "var(--surface-1)", color: "var(--color-text)", font: "12.5px var(--font-sans)", resize: "vertical", lineHeight: 1.5 }} />
                  {vm.errors.greeting && <span style={{ font: "11px var(--font-sans)", color: "var(--color-error)", marginTop: 4, display: "block" }}>{vm.errors.greeting}</span>}
                </label>
              </div>

              <div style={{ marginTop: 12 }}>
                <label>
                  <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
                    Texto de Apresentação (Checkout — carrinho vazio)
                    <span title="Texto exibido quando o cliente abre o checkout sem produtos no carrinho. Convide-o a buscar produtos." style={{ color: "var(--color-text-faint)", cursor: "help", display: "inline-flex" }}><Info size={12} /></span>
                  </span>
                  <textarea value={vm.form.emptyCartGreeting} onChange={(e) => vm.patch({ emptyCartGreeting: e.target.value })} placeholder={"O que você deseja comprar? Digite aqui que encontro para você."} rows={3} style={{ width: "100%", padding: "9px 10px", borderRadius: 7, border: `1px solid ${vm.errors.emptyCartGreeting ? "var(--color-error)" : "var(--color-border)"}`, background: "var(--surface-1)", color: "var(--color-text)", font: "12.5px var(--font-sans)", resize: "vertical", lineHeight: 1.5 }} />
                  {vm.errors.emptyCartGreeting && <span style={{ font: "11px var(--font-sans)", color: "var(--color-error)", marginTop: 4, display: "block" }}>{vm.errors.emptyCartGreeting}</span>}
                </label>
              </div>
            </section>
          )}

          {vm.activeTab === "quick-replies" && (
            <StageQuickRepliesEditor config={vm.stageQrConfig} onChange={vm.setStageQrConfig} />
          )}
        </div>
      )}
    </div>
  );
}

function NumberField(props: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <label>
      <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 4 }}>{props.label}</span>
      <input value={props.value} onChange={(e) => props.onChange(e.target.value)} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${props.error ? "var(--color-error)" : "var(--color-border)"}`, background: "var(--surface-1)", color: "var(--color-text)", font: "12.5px var(--font-mono)" }} />
      {props.error && <span style={{ font: "11px var(--font-sans)", color: "var(--color-error)", marginTop: 4, display: "block" }}>{props.error}</span>}
    </label>
  );
}

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
        <SectionHeader title="Quick Replies por Estágio" variant="secondary" />
        <p style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 4, margin: 0 }}>Configure as sugestões em cada etapa da jornada de compra</p>
      </div>
      {config.stages.map((stage, stageIdx) => {
        const isExpanded = expandedStage === stage.stage;
        return (
          <div key={stage.stage} style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden" }}>
            <button type="button" onClick={() => setExpandedStage(isExpanded ? null : stage.stage)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", border: "none", background: "transparent", cursor: "pointer", color: "var(--color-text)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span style={{ font: "600 13px var(--font-sans)" }}>{stage.label}</span>
                <span style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)" }}>{stage.stage}</span>
              </div>
              <span style={{ font: "11px var(--font-mono)", color: "var(--color-text-muted)" }}>{stage.replies.length} replies</span>
            </button>
            {isExpanded && (
              <div style={{ padding: "0 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {stage.replies.map((reply, ri) => (
                    <span key={ri} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--color-brand-subtle)", color: "var(--color-brand)", borderRadius: 999, padding: "4px 12px", font: "12px var(--font-sans)" }}>
                      {reply}
                      <button type="button" onClick={() => removeReply(stageIdx, ri)} style={{ border: "none", background: "none", color: "var(--color-brand)", cursor: "pointer", padding: 0, display: "flex" }}><X size={12} /></button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={newReply} onChange={(e) => setNewReply(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addReply(stageIdx); } }} placeholder="Nova resposta..." style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--surface-1)", color: "var(--color-text)", font: "12px var(--font-sans)" }} />
                  <button type="button" onClick={() => addReply(stageIdx)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--surface-2)", color: "var(--color-text)", cursor: "pointer", font: "600 11px var(--font-sans)", display: "flex", alignItems: "center", gap: 4 }}><Plus size={12} /> Adicionar</button>
                  <button type="button" onClick={() => resetStage(stageIdx)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--surface-2)", color: "var(--color-text-muted)", cursor: "pointer", font: "600 11px var(--font-sans)" }}>Resetar</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
