import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, User, Building2, KeyRound } from "lucide-react";
import { SocialLoginButtons } from "./SocialLoginButtons.js";
import { friendlyAuthError } from "./auth-error.js";
import { Turnstile } from "./Turnstile.js";
import { maskPhone, maskCpfCnpj, validateCpfCnpj } from "../utils/masks.js";
import { STORE_CATEGORIES, ROLES, VOLUMES } from "../lib/signup-options.js";
import { SegmentSelect } from "../components/SegmentSelect.js";
import { isAuthCaptchaReady, requiresAuthCaptcha, type SocialLoginProvider } from "./auth-config.js";

export interface SignupWizardProps {
  busy: boolean;
  hint: string | null;
  onRegister: (payload: { merchant_name: string; email: string; password: string; turnstile_token?: string }) => Promise<void>;
  onSaveTheme: (theme: { accentColor: string; logoUrl: string; headerTitle: string; agentName: string }) => Promise<void>;
  onSaveCompanyData?: (data: { slug?: string; company: Record<string, unknown>; social?: Record<string, unknown>; oauth_registration_pending?: boolean; owner_name?: string }) => Promise<void>;
  onSaveOwner?: (data: { name: string; phone: string }) => Promise<void>;
  onComplete: () => Promise<void>;
  onSwitchToLogin: () => void;
  onSocialLogin?: (provider: SocialLoginProvider) => void;
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
  const captchaRequired = requiresAuthCaptcha(props.turnstileSiteKey, import.meta.env.PROD);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const isOAuth = Boolean(props.oauthProfile);
  const accountCreated = useRef(isOAuth);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [localBusy, setLocalBusy] = useState(false);
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState<PersonDraft>({ name: props.oauthProfile?.name ?? "", role: "" });
  const [business, setBusiness] = useState<BusinessDraft>({ name: "", segment: "", volume: "", taxId: "" });
  const [account, setAccount] = useState<AccountDraft>({ email: props.oauthProfile?.email ?? "", password: "", confirmPassword: "", phone: "" });

  const busy = props.busy || localBusy;
  const hint = error ?? props.hint;
  useEffect(() => { if (step > 1) titleRef.current?.focus({ preventScroll: true }); }, [step]);

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
    if (busy) return;
    setError(null);
    if (!account.email.trim() || (!isOAuth && !account.password)) { setError("Email e senha são obrigatórios."); return; }
    if (!isOAuth && account.password.length < 8) { setError("Mínimo 8 caracteres, com letra e número."); return; }
    if (!isOAuth && account.password !== account.confirmPassword) { setError("As senhas não coincidem."); return; }
    if (!account.phone.trim() || account.phone.replace(/\D/g, "").length < 10) { setError("Informe um celular válido."); return; }
    if (!isOAuth && !accountCreated.current && !isAuthCaptchaReady(props.turnstileSiteKey, props.captchaToken, import.meta.env.PROD)) {
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
        await props.onSaveCompanyData({
          oauth_registration_pending: isOAuth,
          owner_name: person.name.trim(),
          company: {
            razaoSocial: business.name.trim(),
            cnpj: business.taxId.replace(/\D/g, ""),
            email: account.email.trim(),
            phone: account.phone.replace(/\D/g, ""),
          },
        });
      }
      await props.onComplete();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLocalBusy(false);
      props.setCaptchaToken(null);
      setCaptchaAttempt(value => value + 1);
    }
  }

  return (
    <form className="auth-form" noValidate aria-busy={busy} onSubmit={(event) => { event.preventDefault(); if (!busy) { if (step < 3) goNext(); else void handleSubmit(); } }}>
      <ProgressBar step={step} />

      <div className="auth-form__header">
        <h2 ref={titleRef} tabIndex={-1} className="auth-form__title">{STEP_META[step - 1].label}</h2>
        <p className="auth-form__subtitle">
          {step === 1 && "Vamos preparar sua loja autônoma. Comece por você."}
          {step === 2 && "Apresente a empresa que a Zyon vai ajudar a vender."}
          {step === 3 && "Suas credenciais de acesso ao painel."}
        </p>
      </div>

      {step === 1 && !isOAuth && props.onSocialLogin && (
        <>
          <SocialLoginButtons busy={busy} onProviderClick={props.onSocialLogin} />
          <div className="auth-divider"><span>ou preencha manualmente</span></div>
        </>
      )}

      <div className="auth-form-fields" key={step}>
      {step === 1 && <PersonFields draft={person} onChange={setPerson} />}
      {step === 2 && <BusinessFields draft={business} onChange={setBusiness} />}
      {step === 3 && <AccountFields draft={account} onChange={setAccount} oauth={isOAuth} />}
      </div>

      {step === 3 && !isOAuth && !accountCreated.current && captchaRequired ? (
        <div style={{ marginTop: 8 }}>
          <Turnstile required={captchaRequired} action="signup" resetKey={captchaAttempt} theme="light" siteKey={props.turnstileSiteKey} onChange={props.setCaptchaToken} />
        </div>
      ) : null}

      {hint ? <div className="auth-hint" role="alert">{hint}</div> : null}

      {step < 3 ? (
        <button type="submit" disabled={busy} className="auth-cta">
          Continuar <ArrowRight size={16} />
        </button>
      ) : (
        <button
          type="submit"
          disabled={
            busy ||
            (!isOAuth && !accountCreated.current && !isAuthCaptchaReady(props.turnstileSiteKey, props.captchaToken, import.meta.env.PROD))
          }
          className="auth-cta"
        >
          {busy ? "Salvando..." : isOAuth ? "Concluir cadastro" : "Criar conta"}
        </button>
      )}

      {step === 3 && (
        <p className="auth-terms">
          Ao criar a conta você concorda com os <a href="https://www.zyon-payments.com.br/termos" target="_blank" rel="noreferrer">Termos de Uso</a> e a <a href="https://www.zyon-payments.com.br/privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a> do Zyon.
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
    </form>
  );
}

function ProgressBar({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="auth-progress" role="list" aria-label="Etapas do cadastro">
      {STEP_META.map((meta, idx) => {
        const n = idx + 1;
        const isCompleted = step > n;
        const isActive = step === n;
        const Icon = meta.icon;
        const barCls = isCompleted ? "auth-progress__bar--filled" : isActive ? "auth-progress__bar--active" : "auth-progress__bar--empty";
        const labelCls = isCompleted ? "auth-progress__label--completed" : isActive ? "auth-progress__label--active" : "";
        return (
          <div key={n} className="auth-progress__item" role="listitem" aria-current={isActive ? "step" : undefined}>
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
        <label className="auth-field__label" htmlFor="signup-name">Nome completo</label>
        <input id="signup-name" autoComplete="name" value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder="Ana Souza" className="auth-field__input" />
      </div>
      <div className="auth-field">
        <label className="auth-field__label" htmlFor="signup-role">Cargo / papel na empresa</label>
        <select id="signup-role" value={draft.role} onChange={(e) => onChange({ ...draft, role: e.target.value })} className="auth-field__select">
          <option value="">Selecione seu cargo</option>
          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
    </>
  );
}

function BusinessFields({ draft, onChange }: { draft: BusinessDraft; onChange: (d: BusinessDraft) => void }) {
  return (
    <>
      <div className="auth-field">
        <label className="auth-field__label" htmlFor="signup-store">Nome da loja</label>
        <input id="signup-store" autoComplete="organization" value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder="Loja Aurora" className="auth-field__input" />
      </div>
      <div className="auth-business-row">
        <div className="auth-field">
          <label className="auth-field__label">Segmento</label>
          <SegmentSelect
            value={draft.segment}
            onChange={(v) => onChange({ ...draft, segment: v })}
            options={STORE_CATEGORIES}
            placeholder="Buscar segmento…"
          />
        </div>
        <div className="auth-field">
          <label className="auth-field__label" htmlFor="signup-volume">Volume mensal</label>
          <select id="signup-volume" value={draft.volume} onChange={(e) => onChange({ ...draft, volume: e.target.value })} className="auth-field__select">
            <option value="">Selecione</option>
            {VOLUMES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </div>
      </div>
      <div className="auth-field">
        <label className="auth-field__label" htmlFor="signup-tax">CPF ou CNPJ</label>
        <input
          id="signup-tax" inputMode="numeric" value={draft.taxId}
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
        <label className="auth-field__label" htmlFor="signup-email">E-mail corporativo</label>
        <input id="signup-email" type="email" value={draft.email} onChange={(e) => onChange({ ...draft, email: e.target.value })} autoComplete="username" placeholder="voce@sualoja.com.br" className="auth-field__input" readOnly={oauth} />
      </div>
      {!oauth && <><div className="auth-field">
        <label className="auth-field__label" htmlFor="signup-password">Senha</label>
        <input id="signup-password" type="password" value={draft.password} onChange={(e) => onChange({ ...draft, password: e.target.value })} autoComplete="new-password" placeholder="Mínimo 8 caracteres, com letra e número" minLength={8} className="auth-field__input" />
      </div>
      <div className="auth-field">
        <label className="auth-field__label" htmlFor="signup-confirm-password">Confirmar senha</label>
        <input id="signup-confirm-password" type="password" value={draft.confirmPassword} onChange={(e) => onChange({ ...draft, confirmPassword: e.target.value })} autoComplete="new-password" placeholder="Repita a senha" minLength={8} className="auth-field__input" />
      </div></>}
      <div className="auth-field">
        <label className="auth-field__label" htmlFor="signup-phone">Celular</label>
        <input id="signup-phone" autoComplete="tel-national" type="tel" value={draft.phone} onChange={(e) => onChange({ ...draft, phone: maskPhone(e.target.value) })} placeholder="(11) 99999-9999" maxLength={15} className="auth-field__input" />
      </div>
    </>
  );
}
