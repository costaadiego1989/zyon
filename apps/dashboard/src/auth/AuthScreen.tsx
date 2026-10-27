import React, { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { SocialLoginButtons, type SocialLoginButtonsProps } from "./SocialLoginButtons.js";
import { AuthExperience } from "./SignupExperience.js";
import { SignupWizard } from "./SignupWizard.js";
import { Turnstile } from "./Turnstile.js";
import { useApi } from "../hooks/useApi.js";
import { readError } from "../utils/read-error.js";
import { DashboardHttpError, resolveDashboardApiBaseUrl } from "../api-client.js";
import { mergeUrl } from "../api/http/url.js";
import { friendlyAuthError } from "./auth-error.js";
import { buildOAuthAuthorizationUrl, generateOAuthProofKey, isAuthCaptchaReady, requiresAuthCaptcha, type SocialLoginProvider } from "./auth-config.js";
import "./auth-screen.css";

export type AuthMode = "login" | "signup" | "forgot" | "reset";

export interface AuthScreenProps {
  mode: AuthMode;
  setMode: (mode: AuthMode) => void;
  busy: boolean;
  hint: string | null;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  merchantName: string;
  setMerchantName: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onRegister: (payload: { merchant_name: string; email: string; password: string; turnstile_token?: string }) => Promise<void>;
  onSaveTheme: (theme: { accentColor: string; logoUrl: string; headerTitle: string; agentName: string }) => Promise<void>;
  onSaveCompanyData?: (data: { slug?: string; company: Record<string, unknown>; social?: Record<string, unknown>; oauth_registration_pending?: boolean; owner_name?: string }) => Promise<void>;
  onSaveOwner?: (data: { name: string; phone: string }) => Promise<void>;
  onComplete: () => Promise<void>;
  oauthProfile?: { name: string; email: string } | null;
  // Cloudflare Turnstile: site key ("" disables the widget) + controlled token.
  turnstileSiteKey: string;
  captchaToken: string | null;
  setCaptchaToken: (token: string | null) => void;
}

export function AuthScreen(props: AuthScreenProps) {
  const [oauthError, setOAuthError] = useState<string | null>(null);
  const [oauthStarting, setOAuthStarting] = useState(false);
  useEffect(() => setOAuthError(null), [props.mode]);
  async function startOAuthFlow(provider: SocialLoginProvider) {
    if (props.busy || oauthStarting) return;
    setOAuthStarting(true);
    try {
      const env = import.meta.env;
      const proof = provider === "facebook" ? undefined : await generateOAuthProofKey();
      const clientIds = { google: env.VITE_GOOGLE_CLIENT_ID, microsoft: env.VITE_MICROSOFT_CLIENT_ID, facebook: env.VITE_FACEBOOK_CLIENT_ID };
      const url = new URL(buildOAuthAuthorizationUrl(provider, { state: "pending", origin: window.location.origin,
        clientId: clientIds[provider], facebookVersion: env.VITE_FACEBOOK_GRAPH_API_VERSION, codeChallenge: proof?.codeChallenge,
        redirectUri: env.VITE_OAUTH_REDIRECT_URI }));
      const started = await fetch(mergeUrl(resolveDashboardApiBaseUrl(env), "/auth/oauth/start"), { method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider }), signal: AbortSignal.timeout(10_000) });
      const attempt = await started.json().catch(() => ({})) as { state?: string };
      if (!started.ok || !attempt.state || !/^[A-Za-z0-9_-]{43}$/.test(attempt.state)) {
        throw new Error("Não foi possível iniciar o login. Tente novamente em instantes.");
      }
      const state = attempt.state;
      url.searchParams.set("state", state);
      // Do not retain a false OAuth attempt or leave this form on invalid config.
      sessionStorage.setItem("oauth_state", state);
      sessionStorage.setItem("oauth_provider", provider);
      if (proof) sessionStorage.setItem("oauth_code_verifier", proof.codeVerifier);
      else sessionStorage.removeItem("oauth_code_verifier");
      window.location.href = url.href;
    } catch (error) { setOAuthError(friendlyAuthError(error)); setOAuthStarting(false); }
  }
  return <AuthExperience mode={props.mode} busy={props.busy || oauthStarting} onSwitchMode={props.setMode}>
    {props.mode === "signup" ? <SignupWizard
      busy={props.busy || oauthStarting} hint={oauthError ?? props.hint} onRegister={props.onRegister}
      onSaveTheme={props.onSaveTheme} onSaveCompanyData={props.onSaveCompanyData}
      onSaveOwner={props.onSaveOwner} onComplete={props.onComplete} oauthProfile={props.oauthProfile}
      onSwitchToLogin={() => props.setMode("login")}
      onSocialLogin={startOAuthFlow}
      turnstileSiteKey={props.turnstileSiteKey} captchaToken={props.captchaToken} setCaptchaToken={props.setCaptchaToken}
    /> : props.mode === "reset" ? <ResetPasswordForm onBack={() => props.setMode("login")} turnstileSiteKey={props.turnstileSiteKey} />
      : props.mode === "forgot" ? <ForgotPasswordForm onBack={() => props.setMode("login")} turnstileSiteKey={props.turnstileSiteKey} />
      : <LoginForm {...props} busy={props.busy || oauthStarting} hint={oauthError ?? props.hint} onProviderClick={startOAuthFlow} />}
  </AuthExperience>;
}

function LoginForm(props: AuthScreenProps & Pick<SocialLoginButtonsProps, "onProviderClick">) {
  const captchaRequired = requiresAuthCaptcha(props.turnstileSiteKey, import.meta.env.PROD);
  const captchaReady = isAuthCaptchaReady(props.turnstileSiteKey, props.captchaToken, import.meta.env.PROD);
  const [showPass, setShowPass] = useState(false);
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  return (
    <form onSubmit={(event) => {
      if (props.busy || !captchaReady) { event.preventDefault(); return; }
      props.onSubmit(event);
      setCaptchaAttempt(value => value + 1);
    }} className="auth-form" aria-busy={props.busy}>
      <div className="auth-form__header">
        <h2 className="auth-form__title">Acesse seu painel</h2>
        <p className="auth-form__subtitle">Acompanhe sua loja, seus pedidos e o trabalho da IA.</p>
      </div>

      <SocialLoginButtons busy={props.busy} onProviderClick={props.onProviderClick} />

      <div className="auth-divider">
        <span>ou</span>
      </div>

      <div className="auth-field">
        <label className="auth-field__label" htmlFor="login-email">E-mail</label>
        <input id="login-email" type="email" value={props.email} onChange={(e) => props.setEmail(e.target.value)} autoComplete="username" placeholder="voce@empresa.com.br" required className="auth-field__input" />
      </div>

      <div className="auth-field">
        <div className="auth-field__label-row">
          <label className="auth-field__label" htmlFor="login-password">Senha</label>
          <button type="button" onClick={() => props.setMode("forgot")} disabled={props.busy} className="auth-field__link">Esqueceu a senha?</button>
        </div>
        <div className="auth-field__input-wrap">
          <input id="login-password" type={showPass ? "text" : "password"} value={props.password} onChange={(e) => props.setPassword(e.target.value)} autoComplete="current-password" placeholder="••••••••" minLength={4} required className="auth-field__input" />
          <button type="button" className="auth-field__eye" onClick={() => setShowPass(!showPass)} aria-label={showPass ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPass} aria-controls="login-password">
            {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      {captchaRequired ? (
        <div className="auth-field">
          <Turnstile
            required={captchaRequired}
            action="login"
            resetKey={captchaAttempt}
            theme="light"
            siteKey={props.turnstileSiteKey}
            onChange={props.setCaptchaToken}
          />
        </div>
      ) : null}

      {props.hint ? <div className="auth-hint" role="alert">{props.hint}</div> : null}

      <button
        type="submit"
        disabled={
          props.busy ||
          !captchaReady
        }
        className="auth-cta"
      >
        {props.busy ? "Aguarde..." : "Entrar"}
      </button>

      <p className="auth-switch">Não tem conta? <button type="button" onClick={() => props.setMode("signup")} disabled={props.busy} className="auth-switch__link">Criar conta</button></p>
    </form>
  );
}

function ForgotPasswordForm({ onBack, turnstileSiteKey }: { onBack: () => void; turnstileSiteKey: string }) {
  const captchaRequired = requiresAuthCaptcha(turnstileSiteKey, import.meta.env.PROD);
  const api = useApi();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !isAuthCaptchaReady(turnstileSiteKey, captchaToken, import.meta.env.PROD)) return;
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(email, captchaToken ?? undefined);
      setSent(true);
    } catch (err) { setError(friendlyAuthError(err)); } finally { setBusy(false); setCaptchaToken(null); setCaptchaAttempt(value => value + 1); }
  };

  if (sent) {
    return (
      <div className="auth-form auth-feedback" role="status">
        <h2 className="auth-form__title">Confira seu e-mail</h2>
        <p className="auth-form__subtitle">Se o email estiver cadastrado, você receberá um link para redefinir sua senha.</p>
        <button type="button" onClick={onBack} className="auth-btn-secondary">← Voltar ao login</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="auth-form">
      <div className="auth-form__header">
        <h2 className="auth-form__title">Redefinir senha</h2>
        <p className="auth-form__subtitle">Informe o email cadastrado e enviaremos um link.</p>
      </div>
      <div className="auth-field">
        <label className="auth-field__label" htmlFor="recovery-email">E-mail</label>
        <input id="recovery-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="voce@empresa.com.br" required className="auth-field__input" />
      </div>
      <Turnstile required={captchaRequired} theme="light" siteKey={turnstileSiteKey} action="forgot_password" resetKey={captchaAttempt} onChange={setCaptchaToken} />
      {error ? <div className="auth-hint" role="alert">{error}</div> : null}
      <button type="submit" disabled={busy || !isAuthCaptchaReady(turnstileSiteKey, captchaToken, import.meta.env.PROD)} className="auth-cta">{busy ? "Enviando..." : "Enviar link"}</button>
      <button type="button" onClick={onBack} disabled={busy} className="auth-btn-secondary">← Voltar ao login</button>
    </form>
  );
}

export function ResetPasswordForm({ onBack, turnstileSiteKey = "" }: { onBack: () => void; turnstileSiteKey?: string }) {
  const captchaRequired = requiresAuthCaptcha(turnstileSiteKey, import.meta.env.PROD);
  const api = useApi();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const token = new URLSearchParams(window.location.search).get("token") || "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !isAuthCaptchaReady(turnstileSiteKey, captchaToken, import.meta.env.PROD)) return;
    setError(null);
    if (newPassword.length < 8) { setError("Senha deve ter no mínimo 8 caracteres"); return; }
    if (newPassword !== confirmPassword) { setError("Senhas não conferem"); return; }
    setBusy(true);
    try {
      await api.resetPassword(token, newPassword, captchaToken ?? undefined);
      setDone(true);
      // Clean URL
      window.history.replaceState({}, "", "/");
    } catch (err) {
      let message: string;
      if (err instanceof DashboardHttpError) {
        try {
          const body = JSON.parse(err.responseBody) as Record<string, unknown>;
          const code = body.code as string | undefined;
          if (code === "token_expired") message = "Link expirado. Solicite novamente.";
          else if (code === "invalid_or_expired_token") message = "Link inválido ou expirado.";
          else message = (body.detail as string) || `Erro ao redefinir senha`;
        } catch {
          message = `Erro ao redefinir senha`;
        }
      } else {
        message = readError(err) || "Erro ao redefinir senha";
      }
      setError(message);
    } finally { setBusy(false); setCaptchaToken(null); setCaptchaAttempt(value => value + 1); }
  };

  if (!token && !done) {
    return (
      <div className="auth-form auth-feedback" role="alert">
        <h2 className="auth-form__title">Link inválido</h2>
        <p className="auth-form__subtitle">O link de redefinição está incompleto ou expirado.</p>
        <button type="button" onClick={onBack} className="auth-btn-secondary">← Voltar ao login</button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="auth-form auth-feedback" role="status">
        <h2 className="auth-form__title">Senha redefinida</h2>
        <p className="auth-form__subtitle">Sua nova senha está ativa. Faça login para acessar.</p>
        <button type="button" onClick={onBack} className="auth-cta">Entrar no painel</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="auth-form">
      <div className="auth-form__header">
        <h2 className="auth-form__title">Nova senha</h2>
        <p className="auth-form__subtitle">Defina sua nova senha de acesso.</p>
      </div>
      <div className="auth-field">
        <label className="auth-field__label" htmlFor="reset-password">Nova senha</label>
        <div className="auth-field__input-wrap">
          <input id="reset-password" type={showPw ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" placeholder="Mínimo 8 caracteres" required minLength={8} className="auth-field__input" />
          <button type="button" onClick={() => setShowPw(!showPw)} className="auth-field__eye" aria-label={showPw ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPw} aria-controls="reset-password">
            {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      <div className="auth-field">
        <label className="auth-field__label" htmlFor="reset-confirm-password">Confirmar senha</label>
        <input id="reset-confirm-password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" placeholder="Repita a nova senha" required className="auth-field__input" />
      </div>
      <Turnstile required={captchaRequired} theme="light" siteKey={turnstileSiteKey} action="reset_password" resetKey={captchaAttempt} onChange={setCaptchaToken} />
      {error ? <div className="auth-hint" role="alert">{error}</div> : null}
      <button type="submit" disabled={busy || !isAuthCaptchaReady(turnstileSiteKey, captchaToken, import.meta.env.PROD)} className="auth-cta">{busy ? "Salvando..." : "Redefinir senha"}</button>
    </form>
  );
}
