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

type Volume = (typeof VOLUMES)[number];

function recommendedPlanFor(volume: Volume): PlanKey {
  if (volume === "Até 50 pedidos") return "starter";
  if (volume === "50–500 pedidos") return "growth";
  return "scale";
}

const inputStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 9,
  border: "1px solid oklch(27% 0.006 145)",
  background: "oklch(10% 0.002 145)",
  font: "14px 'Manrope', sans-serif",
  color: "oklch(96% 0.002 145)",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  font: "600 11px 'IBM Plex Mono', monospace",
  letterSpacing: "0.03em",
  color: "oklch(62% 0.006 145)",
};

const fieldStack: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const ctaStyle: React.CSSProperties = {
  padding: "13px 20px",
  borderRadius: 9,
  border: "none",
  background: "linear-gradient(150deg, oklch(74% 0.19 149), oklch(60% 0.17 149))",
  font: "600 13.5px 'Manrope', sans-serif",
  color: "white",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  boxShadow: "0 2px 8px oklch(60% 0.17 149 / 0.3)",
};

export interface SignupWizardProps {
  busy: boolean;
  hint: string | null;
  onRegister: (payload: { merchant_name: string; email: string; password: string }) => Promise<void>;
  onSaveTheme: (theme: { accentColor: string; logoUrl: string; headerTitle: string; agentName: string }) => Promise<void>;
  onComplete: () => Promise<void>;
  onSwitchToLogin: () => void;
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
  taxId: string;
}

interface ThemeDraft {
  color: string;
  logoUrl: string;
  agentName: string;
}

const STEPS = [
  { title: "Sobre sua empresa", subtitle: "Conte-nos sobre sua loja" },
  { title: "Sua conta", subtitle: "Dados de acesso" },
  { title: "Escolha seu plano", subtitle: "14 dias grátis em qualquer plano" },
  { title: "Personalização rápida", subtitle: "Ajustes visuais iniciais" },
];

export function SignupWizard(props: SignupWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [localBusy, setLocalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businessDraft, setBusinessDraft] = useState<BusinessDraft>({
    name: "",
    segment: "Moda",
    url: "",
    volume: "Até 50 pedidos",
  });
  const [accountDraft, setAccountDraft] = useState<AccountDraft>({
    email: "",
    password: "",
    phone: "",
    taxId: "",
  });
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>("starter");
  const [themeDraft, setThemeDraft] = useState<ThemeDraft>({
    color: "#0F766E",
    logoUrl: "",
    agentName: "",
  });

  const recommended = useMemo(() => recommendedPlanFor(businessDraft.volume), [businessDraft.volume]);

  const busy = props.busy || localBusy;
  const hint = error ?? props.hint;

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
      if (!businessDraft.name.trim()) {
        setError("Informe o nome da loja.");
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!accountDraft.email.trim() || !accountDraft.password) {
        setError("Email e senha são obrigatórios.");
        return;
      }
      if (accountDraft.password.length < 8) {
        setError("A senha deve ter pelo menos 8 caracteres.");
        return;
      }
      setStep(3);
      return;
    }
    if (step === 3) {
      setStep(4);
    }
  }

  function goBack() {
    setError(null);
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
    else if (step === 4) setStep(3);
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
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <p style={{ font: "500 11px 'IBM Plex Mono', monospace", letterSpacing: "0.04em", color: "oklch(52% 0.006 145)", marginBottom: 0 }}>
          Novo tenant · Etapa {step} de 4
        </p>
        <h2 style={{ font: "600 22px 'Source Serif 4', serif", color: "oklch(96% 0.002 145)", letterSpacing: "-0.01em", margin: 0 }}>
          {STEPS[step - 1].title}
        </h2>
        <p style={{ font: "13px 'Manrope', sans-serif", color: "oklch(62% 0.008 145)", margin: 0 }}>
          {STEPS[step - 1].subtitle}
        </p>
      </div>

      <ProgressBar step={step} />

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {step === 1 ? (
          <Step1
            draft={businessDraft}
            onChange={updateBusiness}
          />
        ) : null}
        {step === 2 ? <Step2 draft={accountDraft} onChange={updateAccount} /> : null}
        {step === 3 ? (
          <Step3
            selected={selectedPlan}
            recommended={recommended}
            onSelect={(key) => {
              setSelectedPlan(key);
              setStep(4);
            }}
          />
        ) : null}
        {step === 4 ? <Step4 draft={themeDraft} onChange={updateTheme} /> : null}
      </div>

      {hint ? (
        <p
          style={{
            font: "12.5px 'Manrope', sans-serif",
            color: "oklch(68% 0.18 25)",
            padding: "10px 14px",
            borderRadius: 8,
            background: "oklch(28% 0.06 25)",
            border: "1px solid oklch(35% 0.08 25)",
            margin: 0,
          }}
        >
          {hint}
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
        {step > 1 ? (
          <button
            type="button"
            onClick={goBack}
            disabled={busy}
            style={{
              padding: "11px 18px",
              borderRadius: 9,
              border: "1px solid oklch(27% 0.006 145)",
              background: "transparent",
              font: "600 13px 'Manrope', sans-serif",
              color: "oklch(96% 0.002 145)",
              cursor: busy ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              opacity: busy ? 0.6 : 1,
            }}
          >
            <ArrowLeft size={14} /> Voltar
          </button>
        ) : (
          <button
            type="button"
            onClick={props.onSwitchToLogin}
            disabled={busy}
            style={{
              padding: "11px 18px",
              borderRadius: 9,
              border: "1px solid oklch(27% 0.006 145)",
              background: "transparent",
              font: "600 13px 'Manrope', sans-serif",
              color: "oklch(96% 0.002 145)",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            Já tenho conta
          </button>
        )}

        {step < 4 ? (
          <button
            type="button"
            onClick={goNext}
            disabled={busy}
            style={{
              ...ctaStyle,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            Continuar <ArrowRight size={14} />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleFinalSubmit}
            disabled={busy}
            style={{
              ...ctaStyle,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            <Sparkles size={14} />
            {busy ? "Criando..." : "Criar minha conta"}
          </button>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={4}
      aria-valuenow={step}
      style={{ display: "flex", alignItems: "center", gap: 0 }}
    >
      {[1, 2, 3, 4].map((n, idx) => {
        const isCompleted = step > n;
        const isActive = step === n;
        return (
          <React.Fragment key={n}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: isCompleted
                  ? "linear-gradient(150deg, oklch(74% 0.19 149), oklch(60% 0.17 149))"
                  : isActive
                    ? "linear-gradient(150deg, oklch(74% 0.19 149), oklch(60% 0.17 149))"
                    : "oklch(18% 0.003 145)",
                color: isCompleted || isActive ? "white" : "oklch(52% 0.006 145)",
                border: isCompleted || isActive ? "none" : "1px solid oklch(27% 0.006 145)",
                font: "600 12px 'IBM Plex Mono', monospace",
                flex: "none",
              }}
            >
              {isCompleted ? <CheckCircle2 size={14} /> : n}
            </div>
            {idx < 3 ? (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  background: step > n ? "linear-gradient(90deg, oklch(74% 0.19 149), oklch(60% 0.17 149))" : "oklch(22% 0.006 145)",
                  margin: "0 6px",
                }}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function Step1(props: { draft: BusinessDraft; onChange: <K extends keyof BusinessDraft>(key: K, value: BusinessDraft[K]) => void }) {
  const { draft, onChange } = props;
  return (
    <>
      <Field label="Nome da loja" required>
        <input
          value={draft.name}
          onChange={(e) => onChange("name", e.target.value)}
          placeholder="Northstar Atelier"
          required
          style={inputStyle}
        />
      </Field>
      <Field label="Segmento">
        <select
          value={draft.segment}
          onChange={(e) => onChange("segment", e.target.value as BusinessDraft["segment"])}
          style={{ ...inputStyle, appearance: "none" }}
        >
          {SEGMENTS.map((seg) => (
            <option key={seg} value={seg}>
              {seg}
            </option>
          ))}
        </select>
      </Field>
      <Field label="URL da loja" hint="Opcional">
        <input
          value={draft.url}
          onChange={(e) => onChange("url", e.target.value)}
          placeholder="suastore.com.br"
          style={inputStyle}
        />
      </Field>
      <Field label="Volume mensal">
        <select
          value={draft.volume}
          onChange={(e) => onChange("volume", e.target.value as BusinessDraft["volume"])}
          style={{ ...inputStyle, appearance: "none" }}
        >
          {VOLUMES.map((vol) => (
            <option key={vol} value={vol}>
              {vol}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

function Step2(props: { draft: AccountDraft; onChange: <K extends keyof AccountDraft>(key: K, value: AccountDraft[K]) => void }) {
  const { draft, onChange } = props;
  return (
    <>
      <Field label="Email" required>
        <input
          type="email"
          value={draft.email}
          onChange={(e) => onChange("email", e.target.value)}
          autoComplete="username"
          placeholder="owner@loja.com"
          required
          style={inputStyle}
        />
      </Field>
      <Field label="Senha" required hint="Mínimo 8 caracteres">
        <input
          type="password"
          value={draft.password}
          onChange={(e) => onChange("password", e.target.value)}
          autoComplete="new-password"
          placeholder="••••••••"
          minLength={8}
          required
          style={inputStyle}
        />
      </Field>
      <Field label="Telefone" hint="Opcional">
        <input
          type="tel"
          value={draft.phone}
          onChange={(e) => onChange("phone", e.target.value)}
          placeholder="(11) 99999-9999"
          style={inputStyle}
        />
      </Field>
      <Field label="CNPJ/CPF" hint="Opcional">
        <input
          type="text"
          value={draft.taxId}
          onChange={(e) => onChange("taxId", e.target.value)}
          placeholder="00.000.000/0001-00"
          style={inputStyle}
        />
      </Field>
    </>
  );
}

function Step3(props: {
  selected: PlanKey;
  recommended: PlanKey;
  onSelect: (key: PlanKey) => void;
}) {
  const { recommended, onSelect } = props;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {PLANS.map((plan) => {
        const isRecommended = plan.key === recommended;
        const isHighlight = "highlight" in plan && plan.highlight === true;
        return (
          <div
            key={plan.key}
            style={{
              border: `1px solid ${isHighlight || isRecommended ? "oklch(74% 0.19 149)" : "oklch(27% 0.006 145)"}`,
              borderRadius: 12,
              padding: 20,
              background: "oklch(12% 0.003 145)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h3 style={{ font: "600 16px 'Source Serif 4', serif", color: "oklch(96% 0.002 145)", margin: 0 }}>
                    {plan.name}
                  </h3>
                  {isRecommended ? (
                    <span
                      style={{
                        font: "600 10px 'IBM Plex Mono', monospace",
                        letterSpacing: "0.04em",
                        padding: "3px 8px",
                        borderRadius: 999,
                        background: "linear-gradient(150deg, oklch(74% 0.19 149), oklch(60% 0.17 149))",
                        color: "white",
                      }}
                    >
                      Recomendado
                    </span>
                  ) : null}
                </div>
                <div style={{ font: "13px 'Manrope', sans-serif", color: "oklch(62% 0.008 145)", marginTop: 4 }}>
                  {plan.price} · {plan.fee}
                </div>
              </div>
              <span
                style={{
                  font: "600 10px 'IBM Plex Mono', monospace",
                  letterSpacing: "0.04em",
                  padding: "3px 8px",
                  borderRadius: 999,
                  background: "oklch(18% 0.003 145)",
                  border: "1px solid oklch(27% 0.006 145)",
                  color: "oklch(74% 0.19 149)",
                }}
              >
                14 dias grátis
              </span>
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
              {plan.features.map((feature) => (
                <li
                  key={feature}
                  style={{ font: "12.5px 'Manrope', sans-serif", color: "oklch(70% 0.006 145)" }}
                >
                  {feature}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => onSelect(plan.key)}
              style={{
                ...ctaStyle,
                marginTop: 4,
              }}
            >
              Começar com {plan.name}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Step4(props: { draft: ThemeDraft; onChange: <K extends keyof ThemeDraft>(key: K, value: ThemeDraft[K]) => void }) {
  const { draft, onChange } = props;
  return (
    <>
      <Field label="Cor do tema">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            type="color"
            value={draft.color}
            onChange={(e) => onChange("color", e.target.value)}
            style={{
              width: 48,
              height: 40,
              borderRadius: 9,
              border: "1px solid oklch(27% 0.006 145)",
              background: "transparent",
              cursor: "pointer",
              padding: 2,
            }}
          />
          <input
            value={draft.color}
            onChange={(e) => onChange("color", e.target.value)}
            style={{ ...inputStyle, flex: 1, font: "13px 'IBM Plex Mono', monospace" }}
          />
        </div>
      </Field>
      <Field label="Logo URL" hint="Opcional">
        <input
          value={draft.logoUrl}
          onChange={(e) => onChange("logoUrl", e.target.value)}
          placeholder="https://..."
          style={inputStyle}
        />
      </Field>
      <Field label="Nome do agente" hint="Opcional">
        <input
          value={draft.agentName}
          onChange={(e) => onChange("agentName", e.target.value)}
          placeholder="Assistente Zyon"
          style={inputStyle}
        />
      </Field>
    </>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={fieldStack}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <label style={labelStyle}>
          {label}
          {required ? <span style={{ color: "oklch(68% 0.18 25)", marginLeft: 4 }}>*</span> : null}
        </label>
        {hint ? (
          <span style={{ font: "11px 'Manrope', sans-serif", color: "oklch(48% 0.006 145)" }}>{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
