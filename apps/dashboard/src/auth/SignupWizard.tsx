import React, { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, User, Building2, KeyRound } from "lucide-react";
import { friendlyAuthError } from "./auth-error.js";

function maskCNPJ(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : "";
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function validateCNPJ(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const calc = (slice: string, weights: number[]): number => {
    const sum = slice.split("").reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calc(digits.slice(0, 12), w1);
  if (Number(digits[12]) !== d1) return false;

  const d2 = calc(digits.slice(0, 13), w2);
  if (Number(digits[13]) !== d2) return false;

  return true;
}

const SEGMENTS = ["Moda", "Eletrônicos", "Alimentos", "Cosméticos", "Serviços", "Outro"] as const;
const VOLUMES = ["Até 50 pedidos", "50–500 pedidos", "500+ pedidos"] as const;
const ROLES = ["Proprietário(a)", "CEO / Diretor(a)", "Gerente", "Desenvolvedor(a)", "Marketing", "Outro"] as const;

export interface SignupWizardProps {
  busy: boolean;
  hint: string | null;
  onRegister: (payload: { merchant_name: string; email: string; password: string }) => Promise<void>;
  onSaveTheme: (theme: { accentColor: string; logoUrl: string; headerTitle: string; agentName: string }) => Promise<void>;
  onSaveCompanyData?: (data: { company: Record<string, unknown>; social?: Record<string, unknown> }) => Promise<void>;
  onComplete: () => Promise<void>;
  onSwitchToLogin: () => void;
}

interface PersonDraft {
  name: string;
  role: string;
}

interface BusinessDraft {
  name: string;
  segment: string;
  volume: string;
  url: string;
  taxId: string;
}

interface AccountDraft {
  email: string;
  password: string;
  confirmPassword: string;
  phone: string;
}

const STEP_META = [
  { icon: User, label: "Quem é você" },
  { icon: Building2, label: "Sobre a empresa" },
  { icon: KeyRound, label: "Criar conta" },
];

export function SignupWizard(props: SignupWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [localBusy, setLocalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState<PersonDraft>({ name: "", role: "" });
  const [business, setBusiness] = useState<BusinessDraft>({ name: "", segment: "", volume: "", url: "", taxId: "" });
  const [account, setAccount] = useState<AccountDraft>({ email: "", password: "", confirmPassword: "", phone: "" });

  const busy = props.busy || localBusy;
  const hint = error ?? props.hint;

  function goNext() {
    setError(null);
    if (step === 1) {
      if (!person.name.trim()) { setError("Informe seu nome completo."); return; }
      if (!person.role) { setError("Selecione seu cargo."); return; }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!business.name.trim()) { setError("Informe o nome da loja."); return; }
      if (!business.taxId.trim()) { setError("Informe o CNPJ."); return; }
      if (!validateCNPJ(business.taxId)) { setError("CNPJ inválido. Verifique os dígitos."); return; }
      setStep(3);
      return;
    }
  }

  function goBack() {
    setError(null);
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  }

  async function handleSubmit() {
    setError(null);
    if (!account.email.trim() || !account.password) { setError("Email e senha são obrigatórios."); return; }
    if (account.password.length < 8) { setError("Mínimo 8 caracteres, com letra e número."); return; }
    if (account.password !== account.confirmPassword) { setError("As senhas não coincidem."); return; }
    if (!account.phone.trim() || account.phone.replace(/\D/g, "").length < 10) { setError("Informe um celular válido."); return; }

    setLocalBusy(true);
    try {
      await props.onRegister({
        merchant_name: business.name.trim(),
        email: account.email.trim(),
        password: account.password,
      });
      await props.onSaveTheme({
        accentColor: "#0F766E",
        logoUrl: "",
        headerTitle: business.name.trim(),
        agentName: "Assistente Zyon",
      });
      if (props.onSaveCompanyData) {
        await props.onSaveCompanyData({
          company: {
            razaoSocial: business.name.trim(),
            cnpj: business.taxId.replace(/\D/g, ""),
            email: account.email.trim(),
            phone: account.phone.replace(/\D/g, ""),
            ...(business.url && { url: business.url.trim() }),
          },
        });
      }
      await props.onComplete();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLocalBusy(false);
    }
  }

  return (
    <div className="auth-form">
      <ProgressBar step={step} />

      <div className="auth-form__header">
        <h2 className="auth-form__title">{STEP_META[step - 1].label}</h2>
        <p className="auth-form__subtitle">
          {step === 1 && "Vamos personalizar o Zyon para o seu papel."}
          {step === 2 && "Dados da loja que o agente vai atender."}
          {step === 3 && "Suas credenciais de acesso ao painel."}
        </p>
      </div>

      {step === 1 && <PersonFields draft={person} onChange={setPerson} />}
      {step === 2 && <BusinessFields draft={business} onChange={setBusiness} />}
      {step === 3 && <AccountFields draft={account} onChange={setAccount} />}

      {hint ? <div className="auth-hint">{hint}</div> : null}

      {step < 3 ? (
        <button type="button" onClick={goNext} disabled={busy} className="auth-cta">
          Continuar <ArrowRight size={16} />
        </button>
      ) : (
        <button type="button" onClick={handleSubmit} disabled={busy} className="auth-cta">
          {busy ? "Criando..." : "Criar conta"}
        </button>
      )}

      {step === 3 && (
        <p className="auth-terms">
          Ao criar a conta você concorda com os <a href="#">Termos de Uso</a> e a <a href="#">Política de Privacidade</a> do Zyon.
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
        {step > 1 ? (
          <button type="button" onClick={goBack} disabled={busy} className="auth-btn-secondary">
            <ArrowLeft size={14} /> Voltar
          </button>
        ) : <span />}
        <p className="auth-switch" style={{ margin: 0 }}>
          Já tem conta? <button type="button" onClick={props.onSwitchToLogin} className="auth-switch__link">Entrar</button>
        </p>
      </div>
    </div>
  );
}

function ProgressBar({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="auth-progress">
      {STEP_META.map((meta, idx) => {
        const n = idx + 1;
        const isCompleted = step > n;
        const isActive = step === n;
        const Icon = meta.icon;
        const barCls = isCompleted ? "auth-progress__bar--filled" : isActive ? "auth-progress__bar--active" : "auth-progress__bar--empty";
        const labelCls = isCompleted ? "auth-progress__label--completed" : isActive ? "auth-progress__label--active" : "";
        return (
          <div key={n} className="auth-progress__item">
            <div className={`auth-progress__bar ${barCls}`} />
            <span className={`auth-progress__label ${labelCls}`}>
              {isCompleted ? <CheckCircle2 size={13} /> : <Icon size={13} />}
              {meta.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PersonFields({ draft, onChange }: { draft: PersonDraft; onChange: (d: PersonDraft) => void }) {
  return (
    <>
      <div className="auth-field">
        <label className="auth-field__label">Nome completo</label>
        <input value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder="Ana Souza" className="auth-field__input" />
      </div>
      <div className="auth-field">
        <label className="auth-field__label">Cargo / papel na empresa</label>
        <select value={draft.role} onChange={(e) => onChange({ ...draft, role: e.target.value })} className="auth-field__select">
          <option value="">Selecione seu cargo</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
    </>
  );
}

function BusinessFields({ draft, onChange }: { draft: BusinessDraft; onChange: (d: BusinessDraft) => void }) {
  return (
    <>
      <div className="auth-field">
        <label className="auth-field__label">Nome da loja</label>
        <input value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder="Loja Aurora" className="auth-field__input" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="auth-field">
          <label className="auth-field__label">Segmento</label>
          <select value={draft.segment} onChange={(e) => onChange({ ...draft, segment: e.target.value })} className="auth-field__select">
            <option value="">Selecione</option>
            {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="auth-field">
          <label className="auth-field__label">Volume mensal</label>
          <select value={draft.volume} onChange={(e) => onChange({ ...draft, volume: e.target.value })} className="auth-field__select">
            <option value="">Selecione</option>
            {VOLUMES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>
      <div className="auth-field">
        <label className="auth-field__label">URL da loja</label>
        <input value={draft.url} onChange={(e) => onChange({ ...draft, url: e.target.value })} placeholder="sualoja.com.br" className="auth-field__input" />
      </div>
      <div className="auth-field">
        <label className="auth-field__label">CNPJ</label>
        <input
          value={draft.taxId}
          onChange={(e) => onChange({ ...draft, taxId: maskCNPJ(e.target.value) })}
          placeholder="00.000.000/0000-00"
          maxLength={18}
          className="auth-field__input"
        />
      </div>
    </>
  );
}

function AccountFields({ draft, onChange }: { draft: AccountDraft; onChange: (d: AccountDraft) => void }) {
  return (
    <>
      <div className="auth-field">
        <label className="auth-field__label">E-mail corporativo</label>
        <input type="email" value={draft.email} onChange={(e) => onChange({ ...draft, email: e.target.value })} autoComplete="username" placeholder="voce@sualoja.com.br" className="auth-field__input" />
      </div>
      <div className="auth-field">
        <label className="auth-field__label">Senha</label>
        <input type="password" value={draft.password} onChange={(e) => onChange({ ...draft, password: e.target.value })} autoComplete="new-password" placeholder="Mínimo 8 caracteres, com letra e número" minLength={8} className="auth-field__input" />
      </div>
      <div className="auth-field">
        <label className="auth-field__label">Confirmar senha</label>
        <input type="password" value={draft.confirmPassword} onChange={(e) => onChange({ ...draft, confirmPassword: e.target.value })} autoComplete="new-password" placeholder="Repita a senha" minLength={8} className="auth-field__input" />
      </div>
      <div className="auth-field">
        <label className="auth-field__label">Celular</label>
        <input type="tel" value={draft.phone} onChange={(e) => onChange({ ...draft, phone: maskPhone(e.target.value) })} placeholder="(11) 99999-9999" maxLength={15} className="auth-field__input" />
      </div>
    </>
  );
}
