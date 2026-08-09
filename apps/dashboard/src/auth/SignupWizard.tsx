import React, { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { friendlyAuthError } from "./auth-error.js";

const PLANS = [
  {
    key: "starter",
    name: "Starter",
    price: "R$ 89/mês",
    fee: "1,99% por transação",
    features: [
      "50 pedidos/mês",
      "50 sessões/mês",
      "100 conversas IA/mês",
      "1 conexão commerce",
      "Webhooks ilimitados",
      "1 cross-sell",
      "1 cupom ativo",
      "Tema e agente customizados",
      "Sem marca d'água",
    ],
  },
  {
    key: "growth",
    name: "Growth",
    price: "R$ 199/mês",
    fee: "1,49% por transação",
    features: [
      "500 pedidos/mês",
      "1.000 sessões/mês",
      "5.000 conversas IA/mês",
      "2 conexões commerce",
      "Webhooks ilimitados",
      "10 cross-sells",
      "10 cupons ativos",
      "Tema e agente customizados",
      "Voice checkout",
      "Face biometry",
      "Crypto payments",
    ],
    highlight: true,
  },
  {
    key: "scale",
    name: "Scale",
    price: "R$ 499/mês",
    fee: "0,99% por transação",
    features: [
      "Pedidos ilimitados",
      "Sessões ilimitadas",
      "Conversas IA ilimitadas",
      "Conexões commerce ilimitadas",
      "Webhooks ilimitados",
      "10 membros",
      "Cross-sell ilimitado",
      "Cupons ilimitados",
      "Face biometry",
      "Crypto payments",
      "White-label",
    ],
  },
] as const;

type PlanKey = (typeof PLANS)[number]["key"];

const SEGMENTS = ["Moda", "Eletrônicos", "Alimentos", "Cosméticos", "Serviços", "Outro"] as const;
const VOLUMES = ["Até 50 pedidos", "50–500 pedidos", "500+ pedidos"] as const;
const ROLES = ["Proprietário(a)", "CEO / Diretor(a)", "Gerente", "Desenvolvedor(a)", "Marketing", "Outro"] as const;

type Volume = (typeof VOLUMES)[number];

function recommendedPlanFor(volume: Volume): PlanKey {
  if (volume === "Até 50 pedidos") return "starter";
  if (volume === "50–500 pedidos") return "growth";
  return "scale";
}

export interface SignupWizardProps {
  busy: boolean;
  hint: string | null;
  onRegister: (payload: { merchant_name: string; email: string; password: string }) => Promise<void>;
  onSaveTheme: (theme: { accentColor: string; logoUrl: string; headerTitle: string; agentName: string }) => Promise<void>;
  onComplete: () => Promise<void>;
  onSwitchToLogin: () => void;
}

interface PersonDraft {
  name: string;
  role: string;
  taxId: string;
}

interface BusinessDraft {
  name: string;
  segment: (typeof SEGMENTS)[number];
  url: string;
  volume: Volume;
}

interface AccountDraft {
  email: string;
  password: string;
  phone: string;
}

interface ThemeDraft {
  color: string;
  logoUrl: string;
  agentName: string;
}

const STEPS = [
  { title: "Quem é você", subtitle: "Identificação pessoal e CNPJ" },
  { title: "Sobre sua empresa", subtitle: "Conte-nos sobre sua operação" },
  { title: "Criar sua conta", subtitle: "Credenciais de acesso" },
  { title: "Escolha seu plano", subtitle: "14 dias grátis em qualquer plano" },
  { title: "Personalização", subtitle: "Ajustes visuais do checkout" },
];

export function SignupWizard(props: SignupWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [localBusy, setLocalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [personDraft, setPersonDraft] = useState<PersonDraft>({ name: "", role: "", taxId: "" });
  const [businessDraft, setBusinessDraft] = useState<BusinessDraft>({ name: "", segment: "Moda", url: "", volume: "Até 50 pedidos" });
  const [accountDraft, setAccountDraft] = useState<AccountDraft>({ email: "", password: "", phone: "" });
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>("starter");
  const [themeDraft, setThemeDraft] = useState<ThemeDraft>({ color: "#0F766E", logoUrl: "", agentName: "" });

  const recommended = useMemo(() => recommendedPlanFor(businessDraft.volume), [businessDraft.volume]);
  const busy = props.busy || localBusy;
  const hint = error ?? props.hint;

  function updatePerson<K extends keyof PersonDraft>(key: K, value: PersonDraft[K]) {
    setPersonDraft((prev) => ({ ...prev, [key]: value }));
  }
  function updateBusiness<K extends keyof BusinessDraft>(key: K, value: BusinessDraft[K]) {
    setBusinessDraft((prev) => ({ ...prev, [key]: value }));
  }
  function updateAccount<K extends keyof AccountDraft>(key: K, value: AccountDraft[K]) {
    setAccountDraft((prev) => ({ ...prev, [key]: value }));
  }
  function updateTheme<K extends keyof ThemeDraft>(key: K, value: ThemeDraft[K]) {
    setThemeDraft((prev) => ({ ...prev, [key]: value }));
  }

  function goNext() {
    setError(null);
    if (step === 1) {
      if (!personDraft.name.trim()) { setError("Informe seu nome."); return; }
      if (!personDraft.role) { setError("Selecione seu cargo."); return; }
      if (!personDraft.taxId.trim()) { setError("Informe o CNPJ."); return; }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!businessDraft.name.trim()) { setError("Informe o nome da loja."); return; }
      setStep(3);
      return;
    }
    if (step === 3) {
      if (!accountDraft.email.trim() || !accountDraft.password) { setError("Email e senha são obrigatórios."); return; }
      if (accountDraft.password.length < 8) { setError("A senha deve ter pelo menos 8 caracteres."); return; }
      if (!accountDraft.phone.trim()) { setError("Informe seu celular."); return; }
      setStep(4);
      return;
    }
    if (step === 4) {
      setStep(5);
    }
  }

  function goBack() {
    setError(null);
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
    else if (step === 4) setStep(3);
    else if (step === 5) setStep(4);
  }

  async function handleFinalSubmit() {
    setLocalBusy(true);
    setError(null);
    try {
      await props.onRegister({
        merchant_name: businessDraft.name.trim(),
        email: accountDraft.email.trim(),
        password: accountDraft.password,
      });
      await props.onSaveTheme({
        accentColor: themeDraft.color,
        logoUrl: themeDraft.logoUrl,
        headerTitle: businessDraft.name.trim(),
        agentName: themeDraft.agentName.trim() || "Assistente Zyon",
      });
      await props.onComplete();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLocalBusy(false);
    }
  }

  return (
    <div className="auth-form">
      <div className="auth-form__header">
        <span className="auth-form__kicker">Etapa {step} de 5</span>
        <h2 className="auth-form__title">{STEPS[step - 1].title}</h2>
        <p style={{ font: "400 13px 'Manrope', sans-serif", color: "oklch(54% 0.006 145)", margin: "6px 0 0" }}>
          {STEPS[step - 1].subtitle}
        </p>
      </div>

      <ProgressBar step={step} />

      {step === 1 ? <PersonStep draft={personDraft} onChange={updatePerson} /> : null}
      {step === 2 ? <BusinessStep draft={businessDraft} onChange={updateBusiness} /> : null}
      {step === 3 ? <AccountStep draft={accountDraft} onChange={updateAccount} /> : null}
      {step === 4 ? (
        <PlanStep
          selected={selectedPlan}
          recommended={recommended}
          onSelect={(key) => { setSelectedPlan(key); setStep(5); }}
        />
      ) : null}
      {step === 5 ? <ThemeStep draft={themeDraft} onChange={updateTheme} /> : null}

      {hint ? <div className="auth-hint">{hint}</div> : null}

      <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
        {step > 1 ? (
          <button type="button" onClick={goBack} disabled={busy} className="auth-btn-secondary">
            <ArrowLeft size={14} /> Voltar
          </button>
        ) : (
          <button type="button" onClick={props.onSwitchToLogin} disabled={busy} className="auth-btn-secondary">
            Já tenho conta
          </button>
        )}

        {step < 5 ? (
          <button type="button" onClick={goNext} disabled={busy} className="auth-cta">
            Continuar <ArrowRight size={14} />
          </button>
        ) : (
          <button type="button" onClick={handleFinalSubmit} disabled={busy} className="auth-cta">
            <Sparkles size={14} />
            {busy ? "Criando..." : "Criar minha conta"}
          </button>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ step }: { step: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <div className="auth-progress" role="progressbar" aria-valuemin={1} aria-valuemax={5} aria-valuenow={step}>
      {[1, 2, 3, 4, 5].map((n, idx) => {
        const cls = step > n ? "auth-progress__step--completed" : step === n ? "auth-progress__step--active" : "auth-progress__step--pending";
        return (
          <React.Fragment key={n}>
            <div className={`auth-progress__step ${cls}`}>
              {step > n ? <CheckCircle2 size={14} /> : n}
            </div>
            {idx < 4 ? (
              <div className={`auth-progress__line ${step > n ? "auth-progress__line--filled" : "auth-progress__line--empty"}`} />
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function PersonStep(props: { draft: PersonDraft; onChange: <K extends keyof PersonDraft>(key: K, value: PersonDraft[K]) => void }) {
  const { draft, onChange } = props;
  return (
    <>
      <div className="auth-field">
        <label className="auth-field__label">Seu nome completo <span className="auth-field__required">*</span></label>
        <input value={draft.name} onChange={(e) => onChange("name", e.target.value)} placeholder="Maria Silva" required className="auth-field__input" />
      </div>
      <div className="auth-field">
        <label className="auth-field__label">Seu cargo <span className="auth-field__required">*</span></label>
        <select value={draft.role} onChange={(e) => onChange("role", e.target.value)} className="auth-field__select">
          <option value="">Selecione...</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="auth-field">
        <label className="auth-field__label">CNPJ <span className="auth-field__required">*</span></label>
        <input value={draft.taxId} onChange={(e) => onChange("taxId", e.target.value)} placeholder="00.000.000/0001-00" required className="auth-field__input" />
      </div>
    </>
  );
}

function BusinessStep(props: { draft: BusinessDraft; onChange: <K extends keyof BusinessDraft>(key: K, value: BusinessDraft[K]) => void }) {
  const { draft, onChange } = props;
  return (
    <>
      <div className="auth-field">
        <label className="auth-field__label">Nome da loja <span className="auth-field__required">*</span></label>
        <input value={draft.name} onChange={(e) => onChange("name", e.target.value)} placeholder="Northstar Atelier" required className="auth-field__input" />
      </div>
      <div className="auth-field">
        <label className="auth-field__label">Segmento</label>
        <select value={draft.segment} onChange={(e) => onChange("segment", e.target.value as BusinessDraft["segment"])} className="auth-field__select">
          {SEGMENTS.map((seg) => <option key={seg} value={seg}>{seg}</option>)}
        </select>
      </div>
      <div className="auth-field">
        <label className="auth-field__label">URL da loja <span className="auth-field__hint">Opcional</span></label>
        <input value={draft.url} onChange={(e) => onChange("url", e.target.value)} placeholder="suastore.com.br" className="auth-field__input" />
      </div>
      <div className="auth-field">
        <label className="auth-field__label">Volume mensal</label>
        <select value={draft.volume} onChange={(e) => onChange("volume", e.target.value as BusinessDraft["volume"])} className="auth-field__select">
          {VOLUMES.map((vol) => <option key={vol} value={vol}>{vol}</option>)}
        </select>
      </div>
    </>
  );
}

function AccountStep(props: { draft: AccountDraft; onChange: <K extends keyof AccountDraft>(key: K, value: AccountDraft[K]) => void }) {
  const { draft, onChange } = props;
  return (
    <>
      <div className="auth-field">
        <label className="auth-field__label">Email <span className="auth-field__required">*</span></label>
        <input type="email" value={draft.email} onChange={(e) => onChange("email", e.target.value)} autoComplete="username" placeholder="owner@loja.com" required className="auth-field__input" />
      </div>
      <div className="auth-field">
        <label className="auth-field__label">Senha <span className="auth-field__hint">Mínimo 8 caracteres</span></label>
        <input type="password" value={draft.password} onChange={(e) => onChange("password", e.target.value)} autoComplete="new-password" placeholder="••••••••" minLength={8} required className="auth-field__input" />
      </div>
      <div className="auth-field">
        <label className="auth-field__label">Celular <span className="auth-field__required">*</span></label>
        <input type="tel" value={draft.phone} onChange={(e) => onChange("phone", e.target.value)} placeholder="(11) 99999-9999" required className="auth-field__input" />
      </div>
    </>
  );
}

function PlanStep(props: { selected: PlanKey; recommended: PlanKey; onSelect: (key: PlanKey) => void }) {
  const { recommended, onSelect } = props;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {PLANS.map((plan) => {
        const isRecommended = plan.key === recommended;
        return (
          <div
            key={plan.key}
            style={{
              border: `1px solid ${isRecommended ? "oklch(50% 0.1 149)" : "oklch(22% 0.005 145)"}`,
              borderRadius: 10,
              padding: "18px 20px",
              background: isRecommended ? "oklch(13% 0.01 149)" : "oklch(11% 0.003 145)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              transition: "border-color 0.15s ease-out",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h3 style={{ font: "600 15px 'Manrope', sans-serif", color: "oklch(96% 0.002 145)", margin: 0 }}>
                  {plan.name}
                </h3>
                {isRecommended ? (
                  <span style={{
                    font: "600 10px 'IBM Plex Mono', monospace",
                    letterSpacing: "0.03em",
                    padding: "3px 8px",
                    borderRadius: 4,
                    background: "oklch(58% 0.14 149)",
                    color: "white",
                  }}>
                    Recomendado
                  </span>
                ) : null}
              </div>
              <span style={{ font: "500 11px 'IBM Plex Mono', monospace", color: "oklch(60% 0.08 149)" }}>
                14 dias grátis
              </span>
            </div>
            <div style={{ font: "400 12.5px 'Manrope', sans-serif", color: "oklch(58% 0.006 145)" }}>
              {plan.price} · {plan.fee}
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
              {plan.features.slice(0, 5).map((f) => (
                <li key={f} style={{ font: "400 12px 'Manrope', sans-serif", color: "oklch(62% 0.006 145)" }}>{f}</li>
              ))}
              {plan.features.length > 5 ? (
                <li style={{ font: "400 12px 'Manrope', sans-serif", color: "oklch(50% 0.006 145)" }}>
                  + {plan.features.length - 5} recursos
                </li>
              ) : null}
            </ul>
            <button type="button" onClick={() => onSelect(plan.key)} className="auth-cta" style={{ marginTop: 2 }}>
              Começar com {plan.name}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ThemeStep(props: { draft: ThemeDraft; onChange: <K extends keyof ThemeDraft>(key: K, value: ThemeDraft[K]) => void }) {
  const { draft, onChange } = props;
  return (
    <>
      <div className="auth-field">
        <label className="auth-field__label">Cor do tema</label>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            type="color"
            value={draft.color}
            onChange={(e) => onChange("color", e.target.value)}
            style={{ width: 44, height: 38, borderRadius: 6, border: "1px solid oklch(24% 0.005 145)", background: "transparent", cursor: "pointer", padding: 2 }}
          />
          <input value={draft.color} onChange={(e) => onChange("color", e.target.value)} className="auth-field__input" style={{ flex: 1, fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }} />
        </div>
      </div>
      <div className="auth-field">
        <label className="auth-field__label">Logo URL <span className="auth-field__hint">Opcional</span></label>
        <input value={draft.logoUrl} onChange={(e) => onChange("logoUrl", e.target.value)} placeholder="https://..." className="auth-field__input" />
      </div>
      <div className="auth-field">
        <label className="auth-field__label">Nome do agente <span className="auth-field__hint">Opcional</span></label>
        <input value={draft.agentName} onChange={(e) => onChange("agentName", e.target.value)} placeholder="Assistente Zyon" className="auth-field__input" />
      </div>
    </>
  );
}
