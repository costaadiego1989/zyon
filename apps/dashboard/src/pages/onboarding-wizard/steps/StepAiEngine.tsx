import React, { useEffect, useState } from "react";
import { Sparkles, Check } from "lucide-react";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import { useApi } from "../../../hooks/useApi.js";
import { usePlanFeatures } from "../../../hooks/api/usePlanFeatures.js";
import { showToast } from "../../../components/Toast.js";
import { reportError } from "../../../lib/observability/error-reporter.js";

/**
 * Onboarding step 6 — activate the autonomous AI engine. A single toggle turns
 * on BOTH the autonomous revenue engine (MerchantRules.autonomousEngineEnabled)
 * and intent memory (storeSettings.intentMemory.intent_tracking_enabled).
 * Growth+ only — the wizard auto-skips this step for lower plans, but the gate
 * is enforced here too.
 */
export function StepAiEngine() {
  const api = useApi();
  const { plan, loading: planLoading } = usePlanFeatures();
  const isGrowthPlus = plan === "growth" || plan === "scale";

  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const rules = await api.getMerchantRules?.().catch(() => null);
        if (alive && rules && typeof rules.autonomousEngineEnabled === "boolean") {
          setEnabled(rules.autonomousEngineEnabled);
        }
      } catch (err) {
        reportError({ source: "onboarding.aiEngine.load", error: err, severity: "warning" });
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, [api]);

  const toggle = async (next: boolean) => {
    setEnabled(next); // optimistic
    setSaving(true);
    try {
      await Promise.all([
        api.putMerchantRules?.({ autonomousEngineEnabled: next }),
        api.putStoreSettings?.({ intentMemory: { intent_tracking_enabled: next } }),
      ]);
      showToast("success", next ? "Motor de IA ativado" : "Motor de IA desativado");
    } catch (err) {
      setEnabled(!next); // revert
      reportError({ source: "onboarding.aiEngine.toggle", error: err, severity: "warning" });
      showToast("error", "Não foi possível alterar o motor de IA");
    } finally {
      setSaving(false);
    }
  };

  const FEATURES = [
    "Descobre e testa hipóteses de receita automaticamente",
    "Aprende a intenção de compra de cada cliente",
    "Ajusta ofertas e mensagens dentro dos seus limites",
  ];

  return (
    <div className="onb-field-group">
      <div className="onb-hero-icon" aria-hidden="true">
        <Sparkles size={22} />
      </div>

      {!isGrowthPlus && !planLoading ? (
        <>
          <p className="onb-help">
            O Motor de IA autônomo está disponível nos planos <strong>Growth</strong> e
            <strong> Scale</strong>. Faça upgrade para ativar a IA que descobre e testa
            oportunidades de receita sozinha.
          </p>
          <span className="onb-plan-badge">Growth+</span>
        </>
      ) : (
        <>
          <p className="onb-help">
            Ative a IA autônoma de vendas. Ela trabalha nos bastidores, sempre dentro dos
            limites que você define nas regras da loja.
          </p>

          <ul className="onb-feature-list">
            {FEATURES.map((f) => (
              <li key={f}><Check size={14} aria-hidden="true" /> {f}</li>
            ))}
          </ul>

          <div className="onb-toggle-row">
            <div>
              <div className="onb-toggle-title">Motor de IA autônomo</div>
              <div className="onb-toggle-sub">
                {enabled ? "Ativado — a IA já está trabalhando." : "Desativado."}
              </div>
            </div>
            <ToggleSwitch
              checked={enabled}
              onChange={(v) => void toggle(v)}
              disabled={saving || !loaded}
            />
          </div>
        </>
      )}
    </div>
  );
}
