import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, Code2, Copy, Rocket, Settings2, Sparkles } from "lucide-react";
import {
  createDashboardApi,
  DashboardHttpError,
  type EmbedSessionResponse,
  type MerchantProfile,
  type OnboardingStateResponse,
  type OnboardingStepId,
} from "../api-client.js";

const EMBED_SCOPES = ["checkout:start", "checkout:track", "checkout:chat", "offers:apply", "coupons:apply", "payment:intents:create"];

type StepCopy = { title: string; description: string };

const STEP_COPY: Record<OnboardingStepId, StepCopy> = {
  account: { title: "Conta criada", description: "Seu tenant esta provisionado e isolado." },
  checkout_config: {
    title: "Configurar checkout",
    description: "Defina regras de desconto, tom do agente e comportamento do widget.",
  },
  embed: { title: "Gerar embed", description: "Emita um token seguro e copie o snippet para a sua loja." },
  publish: { title: "Publicar", description: "Confirme que o widget esta ativo na storefront." },
};

function errorText(e: unknown): string {
  if (e instanceof DashboardHttpError) return e.responseBody.slice(0, 160);
  return e instanceof Error ? e.message : String(e);
}

export function OnboardingWizard(props: {
  apiBaseUrl: string;
  me: MerchantProfile;
  onNavigate: (tab: "settings" | "rules" | "theme" | "embed") => void;
  onFinished: () => void;
}) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [state, setState] = useState<OnboardingStateResponse | null>(null);
  const [session, setSession] = useState<EmbedSessionResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await api.getOnboardingState();
        if (active) setState(next);
      } catch (e) {
        if (active) setMessage(errorText(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);

  async function completeStep(step: OnboardingStepId) {
    setBusy(true);
    setMessage(null);
    try {
      const next = await api.completeOnboardingStep(step);
      setState(next);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function issueEmbed() {
    setBusy(true);
    setMessage(null);
    try {
      const issued = await api.createEmbedSession({ ttl_seconds: 900, scopes: EMBED_SCOPES });
      setSession(issued);
      await completeStep("embed");
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return <p className="page-lead">{message ?? "Carregando onboarding..."}</p>;
  }

  const nextStep = state.next_step;
  const snippet = session
    ? `<script src="${props.apiBaseUrl}/widget/aacp.js" data-aacp-token="${session.embed_session_token}" async></script>`
    : null;

  if (state.completed) {
    return (
      <section className="panel stacked onboarding-done">
        <div className="panel-title">
          <h2>
            <Sparkles size={18} /> Onboarding concluido
          </h2>
        </div>
        <p className="page-lead">Tudo pronto, {props.me.name}. Seu checkout assistido esta no ar.</p>
        <button type="button" onClick={props.onFinished}>
          <Rocket size={16} /> Ir para o painel
        </button>
      </section>
    );
  }

  return (
    <section className="panel stacked onboarding-wizard">
      <header className="page-head">
        <div>
          <h1>Primeiros passos</h1>
          <p className="page-lead">Provisionamento guiado e retomavel. Continue de onde parou.</p>
        </div>
      </header>

      {message ? <p className="panel panel-info">{message}</p> : null}

      <ol className="onboarding-steps">
        {state.steps.map((step) => {
          const copy = STEP_COPY[step.id];
          const isCurrent = step.id === nextStep;
          const done = step.status === "completed";
          return (
            <li key={step.id} className={done ? "step done" : isCurrent ? "step current" : "step"}>
              <div className="step-icon">{done ? <CheckCircle2 size={20} /> : <Circle size={20} />}</div>
              <div className="step-body">
                <strong>{copy.title}</strong>
                <span>{copy.description}</span>

                {isCurrent && step.id === "checkout_config" ? (
                  <div className="step-actions">
                    <button type="button" onClick={() => props.onNavigate("settings")}>
                      <Settings2 size={15} /> Abrir checkout
                    </button>
                    <button type="button" disabled={busy} onClick={() => void completeStep("checkout_config")}>
                      Marcar como feito
                    </button>
                  </div>
                ) : null}

                {isCurrent && step.id === "embed" ? (
                  <div className="step-actions">
                    <button type="button" disabled={busy} onClick={() => void issueEmbed()}>
                      <Code2 size={15} /> Gerar embed
                    </button>
                  </div>
                ) : null}

                {isCurrent && step.id === "publish" ? (
                  <div className="step-actions">
                    <button type="button" disabled={busy} onClick={() => void completeStep("publish")}>
                      <Rocket size={15} /> Confirmar publicacao
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {snippet ? (
        <div className="panel-title">
          <h2>Snippet</h2>
          <button type="button" onClick={() => navigator.clipboard?.writeText(snippet)}>
            <Copy size={14} /> Copiar
          </button>
        </div>
      ) : null}
      {snippet ? (
        <pre className="code-block">
          <code>{snippet}</code>
        </pre>
      ) : null}

      <button type="button" className="link-button" onClick={props.onFinished}>
        Pular por enquanto
      </button>
    </section>
  );
}
