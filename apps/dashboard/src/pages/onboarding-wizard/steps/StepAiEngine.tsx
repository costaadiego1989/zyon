import React, { useEffect, useState } from "react";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import { Button } from "../../../components/Button.js";
import { useApi } from "../../../hooks/useApi.js";
import { usePlanFeatures } from "../../../hooks/api/usePlanFeatures.js";
import { showToast } from "../../../components/Toast.js";
import { reportError } from "../../../lib/observability/error-reporter.js";

export function StepAiEngine() {
  const api = useApi();
  const { plan, loading: planLoading } = usePlanFeatures();
  const isGrowthPlus = plan === "growth" || plan === "scale";
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setError(null);
    void api.getMerchantRules().then(rules => {
      if (alive) { setEnabled(rules.autonomousEngineEnabled === true); setLoaded(true); }
    }).catch(err => {
      reportError({ source: "onboarding.aiEngine.load", error: err, severity: "warning" });
      if (alive) setError("Não foi possível consultar a automação. Tente novamente antes de alterar.");
    });
    return () => { alive = false; };
  }, [api, attempt]);

  async function toggle(next: boolean) {
    setSaving(true);
    setError(null);
    // Wait for both writes before reconciling a partial failure.
    const results = await Promise.allSettled([
      api.putMerchantRules({ autonomousEngineEnabled: next }),
      api.putStoreSettings({ intentMemory: { intent_tracking_enabled: next } }),
    ]);
    if (results.every(result => result.status === "fulfilled")) {
      setEnabled(next);
      showToast("success", next ? "Automação ativada" : "Automação desativada");
    } else {
      results.forEach(result => { if (result.status === "rejected") reportError({ source: "onboarding.aiEngine.toggle", error: result.reason, severity: "warning" }); });
      try {
        const rules = await api.getMerchantRules();
        setEnabled(rules.autonomousEngineEnabled === true);
        setError("A alteração não foi concluída em todos os recursos. O status abaixo reflete a automação salva. Tente aplicar novamente para sincronizar a memória de intenção.");
      } catch {
        setLoaded(false);
        setError("Não foi possível confirmar o resultado. Consulte novamente antes de alterar.");
      }
    }
    setSaving(false);
  }
  return <div className="onb-field-group">
    {!isGrowthPlus && !planLoading ? <p className="onb-help">A automação de vendas está disponível nos planos Growth e Scale. Você pode concluir a configuração sem ativá-la.</p> : <>
      <p className="onb-help">Permita que a IA teste oportunidades de venda dentro das regras da loja. Revise os limites de desconto e margem antes de ativar.</p>
      <ol className="onb-review-list"><li>Configure ofertas e limites em Regras comerciais.</li><li>Ative a automação quando essas regras estiverem prontas.</li><li>Acompanhe resultados e testes nas páginas de inteligência.</li></ol>
      <div className="onb-toggle-row"><div><label htmlFor="onb-ai-toggle" className="onb-toggle-title">Automação de vendas</label><div className="onb-toggle-sub" role="status">{saving ? "Salvando…" : !loaded ? (error ? "Status indisponível" : "Consultando status…") : enabled ? "Ativada" : "Desativada"}</div></div>
        <ToggleSwitch id="onb-ai-toggle" checked={enabled} disabled={saving || !loaded || planLoading} onChange={next => void toggle(next)} />
      </div>
      <p className="onb-help">Esta opção é salva ao alterar. Você pode continuar com a automação desativada.</p>
      {error && <div className="onb-ai-feedback"><p role="alert" className="onb-message">{error}</p><Button variant="outline" disabled={saving} onClick={() => loaded ? void toggle(enabled) : setAttempt(value => value + 1)}>{loaded ? "Sincronizar configuração" : "Consultar novamente"}</Button></div>}
    </>}
  </div>;
}
