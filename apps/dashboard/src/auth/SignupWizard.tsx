import React, { useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, User, Building2, KeyRound, Github } from "lucide-react";
import { friendlyAuthError } from "./auth-error.js";
import { Turnstile } from "./Turnstile.js";
import { maskPhone, maskCpfCnpj, validateCpfCnpj } from "../utils/masks.js";

const SEGMENTS = ["Moda", "Eletrônicos", "Alimentos", "Cosméticos", "Serviços", "Outro"] as const;
const VOLUMES = ["Até 50 pedidos", "50–500 pedidos", "500+ pedidos"] as const;
const ROLES = ["Proprietário(a)", "CEO / Diretor(a)", "Gerente", "Desenvolvedor(a)", "Marketing", "Outro"] as const;

export interface SignupWizardProps {
  busy: boolean;
  hint: string | null;
  onRegister: (payload: { merchant_name: string; email: string; password: string; turnstile_token?: string }) => Promise<void>;
  onSaveTheme: (theme: { accentColor: string; logoUrl: string; headerTitle: string; agentName: string }) => Promise<void>;
  onSaveCompanyData?: (data: { slug?: string; company: Record<string, unknown>; social?: Record<string, unknown>; oauth_registration_pending?: boolean; owner_name?: string }) => Promise<void>;
  onSaveOwner?: (data: { name: string; phone: string }) => Promise<void>;
  onComplete: () => Promise<void>;
  onSwitchToLogin: () => void;
  onGithubClick?: () => void;
  onGoogleClick?: () => void;
  // Cloudflare Turnstile: site key ("" disables) + controlled token from parent.
  turnstileSiteKey: string;
  captchaToken: string | null;
  setCaptchaToken: (token: string | null) => void;
  oauthProfile?: { name: string; email: string } | null;
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
  const isOAuth = Boolean(props.oauthProfile);
  const accountCreated = useRef(isOAuth);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [localBusy, setLocalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState<PersonDraft>({ name: props.oauthProfile?.name ?? "", role: "" });
  const [business, setBusiness] = useState<BusinessDraft>({ name: "", segment: "", volume: "", url: "", taxId: "" });
  const [account, setAccount] = useState<AccountDraft>({ email: props.oauthProfile?.email ?? "", password: "", confirmPassword: "", phone: "" });

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
      if (!business.taxId.trim()) { setError("Informe o CPF ou CNPJ."); return; }
      if (!validateCpfCnpj(business.taxId)) { setError("CPF ou CNPJ inválido. Verifique os dígitos."); return; }
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
    if (!account.email.trim() || (!isOAuth && !account.password)) { setError("Email e senha são obrigatórios."); return; }
    if (!isOAuth && account.password.length < 8) { setError("Mínimo 8 caracteres, com letra e número."); return; }
    if (!isOAuth && account.password !== account.confirmPassword) { setError("As senhas não coincidem."); return; }
    if (!account.phone.trim() || account.phone.replace(/\D/g, "").length < 10) { setError("Informe um celular válido."); return; }
    if (!isOAuth && import.meta.env.PROD && props.turnstileSiteKey && !props.captchaToken) {
      setError("Confirme que você não é um robô.");
      return;
    }

    setLocalBusy(true);
    try {
      if (!accountCreated.current) {
        await props.onRegister({
          merchant_name: business.name.trim(),
          email: account.email.trim(),
          password: account.password,
          turnstile_token: props.captchaToken ?? undefined,
        });
        accountCreated.current = true;
      }
      await props.onSaveOwner?.({ name: person.name.trim(), phone: account.phone.replace(/\D/g, "") });
      await props.onSaveTheme({
        accentColor: "#0F766E",
        logoUrl: "",
        headerTitle: business.name.trim(),
        agentName: "Assistente Zyon",
      });
      if (props.onSaveCompanyData) {
        const storeSlug = business.name.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
        await props.onSaveCompanyData({
          slug: storeSlug,
          oauth_registration_pending: isOAuth,
          owner_name: person.name.trim(),
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

      {step === 1 && !isOAuth && (props.onGithubClick || props.onGoogleClick) && (
        <>
          <div className="auth-social">
            {props.onGoogleClick && (
              <button type="button" className="auth-social__btn" onClick={props.onGoogleClick}>
                <GoogleIcon />
                <span>Google</span>
              </button>
            )}
            {props.onGithubClick && (
              <button type="button" className="auth-social__btn" onClick={props.onGithubClick}>
                <Github size={16} />
                <span>GitHub</span>
              </button>
            )}
          </div>
          <div className="auth-divider"><span>ou preencha manualmente</span></div>
        </>
      )}

      {step === 1 && <PersonFields draft={person} onChange={setPerson} />}
      {step === 2 && <BusinessFields draft={business} onChange={setBusiness} />}
      {step === 3 && <AccountFields draft={account} onChange={setAccount} oauth={isOAuth} />}

      {step === 3 && !isOAuth && props.turnstileSiteKey ? (
        <div style={{ marginTop: 8 }}>
          <Turnstile siteKey={props.turnstileSiteKey} onChange={props.setCaptchaToken} />
        </div>
      ) : null}

      {hint ? <div className="auth-hint">{hint}</div> : null}

      {step < 3 ? (
        <button type="button" onClick={goNext} disabled={busy} className="auth-cta">
          Continuar <ArrowRight size={16} />
        </button>
      ) : (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={
            busy ||
            (!isOAuth && import.meta.env.PROD && Boolean(props.turnstileSiteKey) && !props.captchaToken)
          }
          className="auth-cta"
        >
          {busy ? "Salvando..." : isOAuth ? "Concluir cadastro" : "Criar conta"}
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
        <label className="auth-field__label">CPF ou CNPJ</label>
        <input
          value={draft.taxId}
          onChange={(e) => onChange({ ...draft, taxId: maskCpfCnpj(e.target.value) })}
          placeholder="CPF ou CNPJ"
          maxLength={18}
          className="auth-field__input"
        />
      </div>
    </>
  );
}

function AccountFields({ draft, onChange, oauth = false }: { draft: AccountDraft; onChange: (d: AccountDraft) => void; oauth?: boolean }) {
  return (
    <>
      <div className="auth-field">
        <label className="auth-field__label">E-mail corporativo</label>
        <input type="email" value={draft.email} onChange={(e) => onChange({ ...draft, email: e.target.value })} autoComplete="username" placeholder="voce@sualoja.com.br" className="auth-field__input" readOnly={oauth} />
      </div>
      {!oauth && <><div className="auth-field">
        <label className="auth-field__label">Senha</label>
        <input type="password" value={draft.password} onChange={(e) => onChange({ ...draft, password: e.target.value })} autoComplete="new-password" placeholder="Mínimo 8 caracteres, com letra e número" minLength={8} className="auth-field__input" />
      </div>
      <div className="auth-field">
        <label className="auth-field__label">Confirmar senha</label>
        <input type="password" value={draft.confirmPassword} onChange={(e) => onChange({ ...draft, confirmPassword: e.target.value })} autoComplete="new-password" placeholder="Repita a senha" minLength={8} className="auth-field__input" />
      </div></>}
      <div className="auth-field">
        <label className="auth-field__label">Celular</label>
        <input type="tel" value={draft.phone} onChange={(e) => onChange({ ...draft, phone: maskPhone(e.target.value) })} placeholder="(11) 99999-9999" maxLength={15} className="auth-field__input" />
      </div>
    </>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z" fill="#34A853" />
      <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84Z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" fill="#EB4335" />
    </svg>
  );
}
