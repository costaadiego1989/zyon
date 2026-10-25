import React from "react";
import { usePlanFeatures } from "../hooks/api/usePlanFeatures.js";

export interface PremiumFeatureGateProps {
  /** Feature key from BillingPlanFeatureKey (e.g. "knowledgeBase", "crmIntegrations"). */
  feature: string;
  /** Human-readable plan name required (for display). */
  requiredPlan?: string;
  /** Human-readable feature name (for the upsell copy). */
  featureLabel?: string;
  /** What the feature does (for the upsell copy). */
  description?: string;
  children: React.ReactNode;
}

/**
 * Premium feature gate: renders children if the merchant's plan has the feature.
 * Otherwise renders an upsell/paywall card with upgrade CTA.
 *
 * Usage:
 *   <PremiumFeatureGate feature="knowledgeBase" requiredPlan="Growth" featureLabel="Base de Conhecimento">
 *     <KnowledgePage />
 *   </PremiumFeatureGate>
 */
export function PremiumFeatureGate({
  feature,
  requiredPlan = "Growth",
  featureLabel,
  description,
  children,
}: PremiumFeatureGateProps) {
  const { hasFeature, loading, plan, error, reload } = usePlanFeatures();

  // While loading, show a subtle skeleton to avoid flash
  if (loading) {
    return (
      <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
        <div style={{
          width: 240, height: 12, borderRadius: 6,
          background: "var(--color-text-faint, #94A3B8)", opacity: 0.15,
          animation: "pulse 1.5s ease-in-out infinite",
        }} />
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" style={{ padding: 32, color: "var(--color-text)" }}>
        <p>Não foi possível verificar seu plano. Tente novamente.</p>
        <button type="button" className="btn" onClick={reload}>Tentar novamente</button>
      </div>
    );
  }

  // Feature unlocked → render children
  if (hasFeature(feature)) {
    return <>{children}</>;
  }

  // Feature locked → upsell
  const label = featureLabel ?? feature;
  const planLabel = plan === "starter" ? "Starter (Free)" : plan ?? "Free";

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "60vh",
      padding: "32px 16px",
    }}>
      <div style={{
        maxWidth: 440,
        width: "100%",
        borderRadius: 16,
        border: "1px solid color-mix(in oklab, var(--color-brand, #6366F1) 20%, transparent)",
        background: "color-mix(in oklab, var(--color-brand, #6366F1) 4%, var(--surface-1, #FFFFFF))",
        padding: "40px 32px",
        textAlign: "center",
      }}>
        {/* Lock icon */}
        <div style={{ marginBottom: 20 }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand, #6366F1)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        {/* Title */}
        <h2 style={{
          font: "700 20px var(--font-sans, system-ui)",
          color: "var(--color-text, #0F172A)",
          margin: "0 0 8px",
        }}>
          Recurso Premium
        </h2>

        {/* Feature name */}
        <p style={{
          font: "600 15px var(--font-sans, system-ui)",
          color: "var(--color-brand, #6366F1)",
          margin: "0 0 12px",
        }}>
          {label}
        </p>

        {/* Description */}
        <p style={{
          font: "400 13.5px/1.6 var(--font-sans, system-ui)",
          color: "var(--color-text-muted, #64748B)",
          margin: "0 0 24px",
        }}>
          {description ?? `Este recurso está disponível a partir do plano ${requiredPlan}. Faça upgrade para desbloquear funcionalidades avançadas e escalar suas vendas.`}
        </p>

        {/* Current plan badge */}
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 20,
          background: "color-mix(in oklab, var(--color-text-faint, #94A3B8) 10%, transparent)",
          font: "500 11px var(--font-mono, monospace)",
          color: "var(--color-text-muted, #64748B)",
          letterSpacing: "0.04em",
          marginBottom: 20,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-text-faint, #94A3B8)" }} />
          Seu plano: {planLabel}
        </div>

        {/* CTA */}
        <div>
          <a
            href="#billing-plans"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 28px",
              borderRadius: 10,
              background: "var(--color-brand, #6366F1)",
              color: "#FFFFFF",
              font: "600 13.5px var(--font-sans, system-ui)",
              textDecoration: "none",
              border: "none",
              cursor: "pointer",
              transition: "opacity 0.15s",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
            </svg>
            Fazer Upgrade para {requiredPlan}
          </a>
        </div>
      </div>
    </div>
  );
}
