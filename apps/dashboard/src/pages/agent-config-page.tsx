import React, { useState } from "react";
import { Save, ChevronDown, ChevronRight, X, Plus, Info } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
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
          onClick={() => void vm.handleSave()}
          disabled={!vm.loaded || vm.saving || vm.hasErrors}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--accent-dark)", background: "var(--accent-dark)", font: "600 12.5px var(--sans)", color: "white", cursor: !vm.loaded || vm.saving || vm.hasErrors ? "not-allowed" : "pointer", opacity: !vm.loaded || vm.saving || vm.hasErrors ? 0.6 : 1, flex: "none" }}
        >
          <Save size={14} /> {vm.saving ? "Salvando..." : "Salvar alterações"}
        </button>
      </div>

      {vm.loading ? (
        <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>Carregando configuração do agente...</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <TabBar
            tabs={[
              { key: "identity", label: "Identidade" },
              { key: "negotiation", label: "Negociação" },
              { key: "quick-replies", label: "Quick Replies" },
            ]}
            activeTab={vm.activeTab}
            onTabChange={(k) => vm.setActiveTab(k as typeof vm.activeTab)}
          />

          {vm.activeTab === "identity" && (
            <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
              <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>IDENTIDADE DO AGENTE</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Nome do Agente</span>
                  <input value={vm.form.agentName} onChange={(e) => vm.patch({ agentName: e.target.value })} placeholder="Assistente" style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${vm.errors.agentName ? "var(--danger)" : "var(--border)"}`, background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }} />
                  {vm.errors.agentName && <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{vm.errors.agentName}</span>}
                </label>
                <label>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Idioma</span>
                  <select value={vm.form.language} onChange={(e) => vm.patch({ language: e.target.value })} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}>
                    <option value="pt-BR">Português (BR)</option>
                    <option value="en-US">English (US)</option>
                    <option value="es-ES">Español</option>
                  </select>
                </label>
                <label>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                    Tom de Voz
                    <span title="Define o estilo de comunicação: Consultivo (orientação), Premium (exclusividade), Direto (objetivo), Amigável (casual), Técnico (preciso)" style={{ color: "var(--faint)", cursor: "help", display: "inline-flex" }}><Info size={12} /></span>
                  </span>
                  <select value={vm.form.tone} onChange={(e) => vm.patch({ tone: e.target.value as AgentTone })} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}>
                    {Object.entries(TONE_PT_TO_EN).map(([label, value]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                    Persona
                    <span title="Descreva quem é o agente: ex. 'Vendedora simpática de loja feminina' ou 'Especialista em tech'" style={{ color: "var(--faint)", cursor: "help", display: "inline-flex" }}><Info size={12} /></span>
                  </span>
                  <input value={vm.form.persona} onChange={(e) => vm.patch({ persona: e.target.value })} placeholder="Ex: Vendedora experiente e atenciosa" style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${vm.errors.persona ? "var(--danger)" : "var(--border)"}`, background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }} />
                  {vm.errors.persona && <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{vm.errors.persona}</span>}
                </label>
              </div>
              <div style={{ marginTop: 12 }}>
                <label>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                    Texto de Apresentação
                    <span title="Primeiro texto que o cliente vê ao abrir o chat. Apresente o agente e diga como ele pode ajudar." style={{ color: "var(--faint)", cursor: "help", display: "inline-flex" }}><Info size={12} /></span>
                  </span>
                  <textarea value={vm.form.greeting} onChange={(e) => vm.patch({ greeting: e.target.value })} placeholder={"Olá! Sou a Micha 👋\nA partir de agora serei sua vendedora particular..."} rows={4} style={{ width: "100%", padding: "9px 10px", borderRadius: 7, border: `1px solid ${vm.errors.greeting ? "var(--danger)" : "var(--border)"}`, background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)", resize: "vertical", lineHeight: 1.5 }} />
                  {vm.errors.greeting && <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{vm.errors.greeting}</span>}
                </label>
              </div>
            </section>
          )}

          {vm.activeTab === "negotiation" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* DESCONTO card */}
              <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px" }}>
                <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 4 }}>DESCONTO</h3>
                <p style={{ font: "12px var(--sans)", color: "var(--muted)", marginBottom: 14, margin: 0, marginTop: 4 }}>O agente pode oferecer descontos mantendo a margem de lucro mínima.</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <NumberField label="Desconto máximo (%)" value={vm.form.maxDiscountPercent} onChange={(v) => vm.patch({ maxDiscountPercent: v })} error={vm.errors.maxDiscountPercent} />
                  <NumberField label="Margem mínima (%)" value={vm.form.minimumMarginPercent} onChange={(v) => vm.patch({ minimumMarginPercent: v })} error={vm.errors.minimumMarginPercent} />
                </div>
              </section>

              {/* FRETE card */}
              <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px" }}>
                <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 4 }}>FRETE</h3>
                <p style={{ font: "12px var(--sans)", color: "var(--muted)", marginBottom: 14, margin: 0, marginTop: 4 }}>Configure opções de frete grátis e descontos parciais no envio.</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <CheckboxField label="Permitir frete grátis" checked={vm.form.allowFreeShipping} onChange={(c) => vm.patch({ allowFreeShipping: c })} />
                  <CheckboxField label="Permitir desconto parcial no frete" checked={vm.form.allowShippingDiscount} onChange={(c) => vm.patch({ allowShippingDiscount: c })} />
                  {vm.form.allowFreeShipping && (
                    <NumberField label="Valor mínimo carrinho para frete grátis (R$)" value={vm.form.freeShippingMinCartValue} onChange={(v) => vm.patch({ freeShippingMinCartValue: v })} error={vm.errors.freeShippingMinCartValue} />
                  )}
                  {vm.form.allowShippingDiscount && (
                    <RangeField label="Desconto parcial máximo no frete" value={vm.form.maxPartialShippingDiscount} onChange={(v) => vm.patch({ maxPartialShippingDiscount: v })} unit="%" />
                  )}
                </div>
              </section>

              {/* OFERTAS card */}
              <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px" }}>
                <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 4 }}>OFERTAS</h3>
                <p style={{ font: "12px var(--sans)", color: "var(--muted)", marginBottom: 14, margin: 0, marginTop: 4 }}>Após este tempo, a oferta expira e o agente pode gerar uma nova.</p>
                <NumberField label="Expiração da oferta (minutos)" value={vm.form.offerExpirationMinutes} onChange={(v) => vm.patch({ offerExpirationMinutes: v })} error={vm.errors.offerExpirationMinutes} />
              </section>
            </div>
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
      <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>{props.label}</span>
      <input value={props.value} onChange={(e) => props.onChange(e.target.value)} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${props.error ? "var(--danger)" : "var(--border)"}`, background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--mono)" }} />
      {props.error && <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{props.error}</span>}
    </label>
  );
}

function CheckboxField(props: { label: string; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        style={{ width: 18, height: 18, accentColor: "var(--accent)", cursor: "pointer", margin: 0 }}
      />
      <span style={{ font: "13px var(--sans)", color: "var(--ink)" }}>{props.label}</span>
    </label>
  );
}

function RangeField(props: { label: string; value: string | number; onChange: (v: string) => void; unit?: string }) {
  const numValue = typeof props.value === "string" ? props.value : String(props.value);
  return (
    <div>
      <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 8 }}>{props.label}: <strong style={{ color: "var(--accent)" }}>{numValue}{props.unit || ""}</strong></span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="range"
          min="0"
          max="100"
          value={numValue}
          onChange={(e) => props.onChange(e.target.value)}
          style={{ flex: 1, accentColor: "var(--accent)", cursor: "pointer", height: 6 }}
        />
      </div>
    </div>
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
