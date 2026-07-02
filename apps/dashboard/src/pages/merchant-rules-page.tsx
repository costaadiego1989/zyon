import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Save } from "lucide-react";
import type { MerchantRules } from "@zyon/shared-types";
import type { AgentRules, MerchantProfile as MerchantMeProfile } from "../api-client.js";
import { createDashboardApi, DashboardHttpError } from "../api-client.js";
import { RulesForm } from "../components/rules-form.js";
import { QuickRepliesSection } from "../components/quick-replies-section.js";
import { LivePreviewPanel, type LivePreviewPanelRef } from "../components/LivePreviewPanel.js";
import { SaveFeedbackBanner } from "../components/save-feedback-banner.js";
import { RulesSkeleton } from "../components/rules-skeleton.js";
import { AgentRulesForm } from "../components/agent-rules-form.js";
import {
  validateOriginZip,
  validateTreasuryAddress,
  validateNonNegative,
  validateMarginConsistency,
} from "../utils/rules-validation.js";

function readError(e: unknown): string {
  return e instanceof DashboardHttpError
    ? e.responseBody || e.message
    : e instanceof Error
      ? e.message
      : "Erro desconhecido";
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function MerchantRulesAuthenticatedPage(props: {
  apiBaseUrl: string;
  me: MerchantMeProfile | null;
}) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const previewRef = useRef<LivePreviewPanelRef>(null);

  const [rules, setRules] = useState<MerchantRules | null>(null);
  const [lastSavedRules, setLastSavedRules] = useState<MerchantRules | null>(null);
  const [saving, setSaving] = useState(false);
  const [gate, setGate] = useState<"idle" | "401" | "error">("idle");
  const [hint, setHint] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const [agentRules, setAgentRules] = useState<AgentRules | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentMessage, setAgentMessage] = useState<string | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentRulesMode, setAgentRulesMode] = useState<"form" | "json">("form");

  const isDirty = useMemo(
    () => rules !== null && lastSavedRules !== null && !deepEqual(rules, lastSavedRules),
    [rules, lastSavedRules],
  );

  const hasValidationErrors = Object.keys(validationErrors).length > 0;

  const fetchRules = useCallback(async () => {
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
      setLastSavedRules(rl);
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
  }, [api, props.me]);

  useEffect(() => {
    void fetchRules();
  }, [fetchRules]);

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
    } catch (e) {
      setAgentMessage(readError(e));
    } finally {
      setAgentLoading(false);
    }
  }

  async function saveAgentRules() {
    if (!agentRules) return;
    setAgentBusy(true);
    setAgentMessage(null);
    try {
      const saved = await api.putAgentRules(agentRules);
      setAgentRules(saved);
      setAgentMessage("Regras do agente salvas.");
    } catch (e) {
      setAgentMessage(
        e instanceof SyntaxError ? `JSON inválido: ${e.message}` : readError(e),
      );
    } finally {
      setAgentBusy(false);
    }
  }

  function runValidation(currentRules: MerchantRules) {
    const errors: Record<string, string> = {};

    const zipErr = validateOriginZip(currentRules.originZip);
    if (zipErr) errors.originZip = zipErr;

    const addrErr = validateTreasuryAddress(currentRules.cryptoPayments?.treasuryAddress);
    if (currentRules.cryptoPayments?.enabled && addrErr) errors.treasuryAddress = addrErr;

    const freeShipErr = validateNonNegative(currentRules.freeShippingMinCartValue);
    if (freeShipErr) errors.freeShippingMinCartValue = freeShipErr;

    const subsidyErr = validateNonNegative(currentRules.maxShippingSubsidy);
    if (subsidyErr) errors.maxShippingSubsidy = subsidyErr;

    const marginErr = validateMarginConsistency(
      currentRules.maxDiscountPercent,
      currentRules.minimumMarginPercent,
    );
    if (marginErr) errors.marginConsistency = marginErr;

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleRulesChange(next: MerchantRules) {
    setRules(next);
    runValidation(next);
  }

  async function saveRules() {
    if (!rules) return;
    if (!runValidation(rules)) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const saved = await api.putMerchantRules(rules);
      setRules(saved);
      setLastSavedRules(saved);
      setSaveResult("success");
    } catch (e) {
      setSaveResult("error");
      setHint(readError(e));
    } finally {
      setSaving(false);
    }
  }

  const handleDismissFeedback = useCallback(() => setSaveResult(null), []);

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
          <span className="eyebrow">Atendimento</span>
          <h1>Regras do Agente</h1>
          <p className="page-lead">
            Defina o comportamento e os limites do agente de checkout.
          </p>
        </div>
        <div className="button-row">
          {isDirty && <span className="badge-unsaved">Alterações não salvas</span>}
          <button
            type="button"
            className="primary-action"
            disabled={saving || !rules || !isDirty || hasValidationErrors}
            onClick={() => void saveRules()}
            title={hasValidationErrors ? "Corrija os erros antes de salvar" : undefined}
          >
            <Save size={16} />
            {saving ? "Salvando..." : "Salvar regras"}
          </button>
        </div>
      </header>

      <div aria-live="polite" aria-atomic="true">
        <SaveFeedbackBanner
          result={saveResult}
          onDismiss={handleDismissFeedback}
        />
      </div>

      {gate === "401" ? (
        <div className="panel panel-warn" role="alert">
          <p>Sessão inválida ou expirada.</p>
          <button className="btn-sm" onClick={() => window.location.reload()}>
            Fazer login novamente
          </button>
        </div>
      ) : null}
      {gate === "error" ? (
        <div className="panel panel-error" role="alert">
          <p>{hint ?? "Falha de rede"}</p>
          <button className="btn-sm" onClick={() => void fetchRules()}>
            Tentar novamente
          </button>
        </div>
      ) : null}

      {rules ? (
        <div className="split-panel">
          <div className="split-panel-controls">
            <div className="panel stacked">
              <div className="panel-title">
                <h2>Capacidades</h2>
              <p className="page-lead" style={{ margin: 0, fontSize: 12 }}>O que o agente pode fazer durante a conversa</p>
              </div>
              <RulesForm
                rules={rules}
                onChange={handleRulesChange}
                validationErrors={validationErrors}
                onValidationChange={setValidationErrors}
              />
            </div>

            <div className="panel stacked rules-section-gap">
              <QuickRepliesSection
                value={rules.quickReplies}
                onChange={(qr) => handleRulesChange({ ...rules, quickReplies: qr })}
              />
            </div>

            <section className="panel stacked rules-section-gap">
              <div className="panel-title">
                <h2>Limites</h2>
                <Bot size={18} className="icon-brand" />
              </div>
              <p className="page-lead" style={{ margin: 0, fontSize: 12 }}>
                Restrições que o agente deve respeitar sempre
              </p>
              {agentMessage ? (
                <p className="panel panel-info">{agentMessage}</p>
              ) : null}
              {agentLoading ? (
                <p className="panel panel-info">Carregando regras do agente...</p>
              ) : null}
              <AgentRulesForm
                rules={agentRules}
                onChange={setAgentRules}
                mode={agentRulesMode}
                onModeChange={setAgentRulesMode}
                disabled={agentBusy}
                loading={agentLoading}
              />
              <div className="button-row">
                <button
                  type="button"
                  className="primary-action"
                  disabled={agentBusy || agentLoading || !agentRules}
                  onClick={() => void saveAgentRules()}
                >
                  <Save size={16} />
                  {agentBusy ? "Salvando..." : "Salvar regras"}
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

          <div className="split-panel-preview">
            <LivePreviewPanel
              ref={previewRef}
              apiBaseUrl={props.apiBaseUrl}
              me={props.me}
            />
          </div>
        </div>
      ) : gate === "idle" ? (
        <RulesSkeleton />
      ) : null}
    </>
  );
}
