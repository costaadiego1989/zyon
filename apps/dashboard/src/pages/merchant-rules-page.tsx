import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Save } from "lucide-react";
import type { MerchantRules } from "@zyon/shared-types";
import type { AgentRules, MerchantProfile as MerchantMeProfile } from "../api-client.js";
import { createDashboardApi, DashboardHttpError } from "../api-client.js";
import { RulesForm } from "../components/rules-form.js";
import { QuickRepliesSection } from "../components/quick-replies-section.js";
import { LivePreviewPanel, type LivePreviewPanelRef } from "../components/LivePreviewPanel.js";

function readError(e: unknown): string {
  return e instanceof DashboardHttpError
    ? e.responseBody || e.message
    : e instanceof Error
      ? e.message
      : "Erro desconhecido";
}

export function MerchantRulesAuthenticatedPage(props: {
  apiBaseUrl: string;
  me: MerchantMeProfile | null;
}) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const previewRef = useRef<LivePreviewPanelRef>(null);

  // merchant-rules state (existing)
  const [rules, setRules] = useState<MerchantRules | null>(null);
  const [saving, setSaving] = useState(false);
  const [gate, setGate] = useState<"idle" | "401" | "error">("idle");
  const [hint, setHint] = useState<string | null>(null);

  // agent-rules state (new)
  const [agentRules, setAgentRules] = useState<AgentRules | null>(null);
  const [agentRulesJson, setAgentRulesJson] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentMessage, setAgentMessage] = useState<string | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);

  useEffect(() => {
    async function fetchRules() {
      if (!props.me) {
        setRules(null);
        setAgentRules(null);
        setGate("idle");
        setHint(null);
        return;
      }
      try {
        const rl = await api.getMerchantRules();
        setRules(rl);
        setGate("idle");
        setHint(null);
      } catch (e) {
        setRules(null);
        setHint(null);
        if (e instanceof DashboardHttpError && e.status === 401) setGate("401");
        else {
          setGate("error");
          setHint(readError(e));
        }
      }
    }
    void fetchRules();
  }, [api, props.me]);

  useEffect(() => {
    if (!props.me) return;
    void loadAgentRules();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAgentRules() {
    setAgentLoading(true);
    setAgentMessage(null);
    try {
      const ar = await api.getAgentRules();
      setAgentRules(ar);
      setAgentRulesJson(JSON.stringify(ar, null, 2));
    } catch (e) {
      setAgentMessage(readError(e));
    } finally {
      setAgentLoading(false);
    }
  }

  async function saveAgentRules() {
    setAgentBusy(true);
    setAgentMessage(null);
    try {
      const parsed = JSON.parse(agentRulesJson) as AgentRules;
      const saved = await api.putAgentRules(parsed);
      setAgentRules(saved);
      setAgentRulesJson(JSON.stringify(saved, null, 2));
      setAgentMessage("Regras do agente salvas.");
    } catch (e) {
      setAgentMessage(
        e instanceof SyntaxError ? `JSON invalido: ${e.message}` : readError(e),
      );
    } finally {
      setAgentBusy(false);
    }
  }

  async function saveRules() {
    if (!rules) return;
    setSaving(true);
    try {
      const saved = await api.putMerchantRules(rules);
      setRules(saved);
    } finally {
      setSaving(false);
    }
  }

  if (!props.me) {
    return (
      <>
        <h1>Regras (sessão JWT)</h1>
        <p className="page-lead">
          Faça login na barra superior para ler e gravar <code>GET/PUT /merchants/me/rules</code> protegidas por cookie.
        </p>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Regras do merchant atual</h1>
          <p className="page-lead">{props.me.name ?? props.me.id} · rotas <code>/merchants/me/rules</code>.</p>
        </div>
        <button
          type="button"
          className="primary-action"
          disabled={saving || !rules}
          onClick={() => void saveRules()}
        >
          <Save size={16} />
          {saving ? "Salvando..." : "Salvar regras"}
        </button>
      </header>

      {gate === "401" ? (
        <p className="panel panel-warn">Sessão invalida ou expirada (401).</p>
      ) : null}
      {gate === "error" ? (
        <p className="panel panel-error">{hint ?? "Falha de rede"}</p>
      ) : null}

      <div className="split-panel">
        {/* Left: rules form + quick replies */}
        <div className="split-panel-controls">
          {rules ? (
            <>
              <div className="panel stacked">
                <div className="panel-title">
                  <h2>Configuração de Regras</h2>
                </div>
                <RulesForm rules={rules} onChange={setRules} />
              </div>

              <div className="panel stacked" style={{ marginTop: 16 }}>
                <QuickRepliesSection
                  value={rules.quickReplies}
                  onChange={(qr) => setRules({ ...rules, quickReplies: qr })}
                />
              </div>
            </>
          ) : gate === "idle" ? (
            <p className="panel panel-info">Carregando regras...</p>
          ) : null}

          {/* Agent rules JSON editor */}
          <section className="panel stacked" style={{ marginTop: 16 }}>
            <div className="panel-title">
              <h2>Motor de regras do agente</h2>
              <Bot size={18} style={{ color: "var(--color-brand-light)" }} />
            </div>
            <p className="page-lead" style={{ marginBottom: 12 }}>
              Configuração avançada: <code>GET/PUT /agent-rules</code>. Edite o JSON e salve.
            </p>
            {agentMessage ? (
              <p className="panel panel-info" style={{ marginBottom: 8 }}>{agentMessage}</p>
            ) : null}
            {agentLoading ? (
              <p className="panel panel-info" style={{ marginBottom: 8 }}>Carregando regras do agente...</p>
            ) : null}
            <textarea
              spellCheck={false}
              disabled={agentBusy || agentLoading}
              className="mono-textarea"
              value={agentRulesJson}
              onChange={(e) => setAgentRulesJson(e.target.value)}
              rows={12}
              aria-label="JSON das regras do agente"
            />
            <div className="button-row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="primary-action"
                disabled={agentBusy || agentLoading || !agentRules}
                onClick={() => void saveAgentRules()}
              >
                <Save size={16} />
                {agentBusy ? "Salvando..." : "Salvar regras do agente"}
              </button>
              <button
                type="button"
                disabled={agentBusy || agentLoading}
                onClick={() => void loadAgentRules()}
              >
                Recarregar
              </button>
            </div>
          </section>
        </div>

        {/* Right: live preview sticky */}
        <div className="split-panel-preview">
          <LivePreviewPanel
            ref={previewRef}
            apiBaseUrl={props.apiBaseUrl}
            me={props.me}
          />
        </div>
      </div>
    </>
  );
}
