import React, { useState } from "react";
import { KeyRound, UserPlus, Github, Code2, Eye, EyeOff } from "lucide-react";
import { SignupWizard } from "./SignupWizard.js";
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
  onRegister: (payload: { merchant_name: string; email: string; password: string }) => Promise<void>;
  onSaveTheme: (theme: { accentColor: string; logoUrl: string; headerTitle: string; agentName: string }) => Promise<void>;
  onSaveCompanyData?: (data: { company: Record<string, unknown>; social?: Record<string, unknown> }) => Promise<void>;
  onComplete: () => Promise<void>;
  apiBaseUrl?: string;
}

function generateOAuthState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

function startOAuthFlow(provider: "github" | "google") {
  const state = generateOAuthState();
  sessionStorage.setItem("oauth_state", state);
  sessionStorage.setItem("oauth_provider", provider);

  const redirectUri = (import.meta as { env?: Record<string, string> }).env?.VITE_OAUTH_REDIRECT_URI
    || `${window.location.origin}/auth/oauth/callback`;

  if (provider === "github") {
    const clientId = (import.meta as { env?: Record<string, string> }).env?.VITE_GITHUB_CLIENT_ID || "";
    const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email&state=${state}`;
    window.location.href = url;
  } else {
    const clientId = (import.meta as { env?: Record<string, string> }).env?.VITE_GOOGLE_CLIENT_ID || "";
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile&state=${state}&access_type=offline&prompt=consent`;
    window.location.href = url;
  }
}

export function AuthScreen(props: AuthScreenProps) {
  const mode: AuthMode = props.mode;
  const isSignup = mode === "signup";
  return (
    <main className="auth-shell">
      {/* Left: Form */}
      <section className="auth-form-panel">
        <header className="auth-header">
          <img src="/logo-zyon.png" alt="Zyon" className="auth-header__logo" />
          <div className="auth-header__sep" />
          <span className="auth-header__label">AI Checkout Sales Agent</span>
        </header>

        <div className="auth-form-container">
          <div className="auth-tabs" role="tablist">
            <button type="button" onClick={() => props.setMode("login")} className={`auth-tabs__btn ${mode === "login" ? "auth-tabs__btn--active" : ""}`} role="tab" aria-selected={mode === "login"}>
              Entrar
            </button>
            <button type="button" onClick={() => props.setMode("signup")} className={`auth-tabs__btn ${mode === "signup" || mode === "forgot" ? "auth-tabs__btn--active" : ""}`} role="tab" aria-selected={isSignup}>
              Criar conta
            </button>
          </div>

          <div className="auth-form-area">
            {mode === "reset" ? (
              <ResetPasswordForm apiBaseUrl={props.apiBaseUrl} onBack={() => props.setMode("login")} />
            ) : mode === "forgot" ? (
              <ForgotPasswordForm apiBaseUrl={props.apiBaseUrl} onBack={() => props.setMode("login")} />
            ) : isSignup ? (
              <SignupWizard
                busy={props.busy}
                hint={props.hint}
                onRegister={props.onRegister}
                onSaveTheme={props.onSaveTheme}
                onSaveCompanyData={props.onSaveCompanyData}
                onComplete={props.onComplete}
                onSwitchToLogin={() => props.setMode("login")}
                onGithubClick={() => startOAuthFlow("github")}
                onGoogleClick={() => startOAuthFlow("google")}
              />
            ) : (
              <LoginForm {...props} onGithubClick={() => startOAuthFlow("github")} onGoogleClick={() => startOAuthFlow("google")} />
            )}
          </div>
        </div>
      </section>

      {/* Right: Hero */}
      <section className="auth-hero" aria-label="AACP Marketing">
        <div className="auth-hero__glow auth-hero__glow--top" />
        <div className="auth-hero__glow auth-hero__glow--mid" />
        <div className="auth-hero__glow auth-hero__glow--bottom" />
        <div className="auth-hero__content">
          <div className="auth-hero__logo-large">
            <img src="/logo-zyon.png" alt="Zyon" className="auth-hero__logo-img" />
          </div>
          <p className="auth-hero__tagline">
            Checkout agêntico com IA que negocia, oferece e converte.
          </p>
          <div className="auth-hero__metrics">
            <div className="auth-hero__metric">
              <span className="auth-hero__metric-value">+34%</span>
              <span className="auth-hero__metric-label">Conversão</span>
            </div>
            <div className="auth-hero__metric">
              <span className="auth-hero__metric-value">2.4s</span>
              <span className="auth-hero__metric-label">Tempo médio</span>
            </div>
            <div className="auth-hero__metric">
              <span className="auth-hero__metric-value">98%</span>
              <span className="auth-hero__metric-label">Satisfação</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function LoginForm(props: AuthScreenProps & { onGithubClick: () => void; onGoogleClick: () => void }) {
  const [showPass, setShowPass] = useState(false);
  return (
    <form onSubmit={props.onSubmit} className="auth-form">
      <div className="auth-form__header">
        <h2 className="auth-form__title">Acesse seu painel</h2>
        <p className="auth-form__subtitle">Gerencie checkout, pedidos e integrações.</p>
      </div>

      <div className="auth-social">
        <button type="button" className="auth-social__btn" onClick={props.onGoogleClick}>
          <GoogleIcon />
          <span>Google</span>
        </button>
        <button type="button" className="auth-social__btn" onClick={props.onGithubClick}>
          <Github size={16} />
          <span>GitHub</span>
        </button>
      </div>

      <div className="auth-divider">
        <span>ou</span>
      </div>

      <div className="auth-field">
        <label className="auth-field__label">Email</label>
        <input type="email" value={props.email} onChange={(e) => props.setEmail(e.target.value)} autoComplete="username" placeholder="owner@loja.com" required className="auth-field__input" />
      </div>

      <div className="auth-field">
        <div className="auth-field__label-row">
          <label className="auth-field__label">Senha</label>
          <button type="button" onClick={() => props.setMode("forgot")} className="auth-field__link">Esqueceu?</button>
        </div>
        <div className="auth-field__input-wrap">
          <input type={showPass ? "text" : "password"} value={props.password} onChange={(e) => props.setPassword(e.target.value)} autoComplete="current-password" placeholder="••••••••" minLength={4} required className="auth-field__input" />
          <button type="button" className="auth-field__eye" onClick={() => setShowPass(!showPass)} aria-label={showPass ? "Ocultar senha" : "Mostrar senha"}>
            {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      {props.hint ? <div className="auth-hint">{props.hint}</div> : null}

      <button type="submit" disabled={props.busy} className="auth-cta">
        {props.busy ? "Aguarde..." : "Entrar"}
      </button>

      <p className="auth-switch">Não tem conta? <button type="button" onClick={() => props.setMode("signup")} className="auth-switch__link">Criar conta</button></p>
    </form>
  );
}

function ForgotPasswordForm({ apiBaseUrl, onBack }: { apiBaseUrl?: string; onBack: () => void }) {
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const base = (apiBaseUrl || "http://localhost:3009").replace(/\/$/, "");
      const res = await fetch(`${base}/auth/forgot-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      if (!res.ok) { const body = await res.json().catch(() => ({})) as Record<string, unknown>; throw new Error((body.detail as string) || "Erro ao enviar email"); }
      setSent(true);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  if (sent) {
    return (
      <div className="auth-form" style={{ textAlign: "center" }}>
        <h2 className="auth-form__title">Email enviado!</h2>
        <p className="auth-form__subtitle">Se o email estiver cadastrado, você receberá um link para redefinir sua senha.</p>
        <button type="button" onClick={onBack} className="auth-switch__link" style={{ marginTop: 16 }}>← Voltar ao login</button>
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
        <label className="auth-field__label">Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="owner@loja.com" required className="auth-field__input" />
      </div>
      {error ? <div className="auth-hint">{error}</div> : null}
      <button type="submit" disabled={busy} className="auth-cta">{busy ? "Enviando..." : "Enviar link"}</button>
      <button type="button" onClick={onBack} className="auth-switch__link" style={{ textAlign: "center", width: "100%", marginTop: 8 }}>← Voltar ao login</button>
    </form>
  );
}

export function ResetPasswordForm({ apiBaseUrl, onBack }: { apiBaseUrl?: string; onBack: () => void }) {
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const token = new URLSearchParams(window.location.search).get("token") || "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) { setError("Senha deve ter no mínimo 8 caracteres"); return; }
    if (newPassword !== confirmPassword) { setError("Senhas não conferem"); return; }
    setBusy(true);
    try {
      const base = (apiBaseUrl || "http://localhost:3009").replace(/\/$/, "");
      const res = await fetch(`${base}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: newPassword }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        const msg = body.code === "token_expired" ? "Link expirado. Solicite novamente." : body.code === "invalid_or_expired_token" ? "Link inválido ou expirado." : (body.detail as string) || "Erro ao redefinir senha";
        throw new Error(msg);
      }
      setDone(true);
      // Clean URL
      window.history.replaceState({}, "", "/");
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  if (!token) {
    return (
      <div className="auth-form" style={{ textAlign: "center" }}>
        <h2 className="auth-form__title">Link inválido</h2>
        <p className="auth-form__subtitle">O link de redefinição está incompleto ou expirado.</p>
        <button type="button" onClick={onBack} className="auth-switch__link" style={{ marginTop: 16 }}>← Voltar ao login</button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="auth-form" style={{ textAlign: "center" }}>
        <h2 className="auth-form__title">Senha redefinida! ✓</h2>
        <p className="auth-form__subtitle">Sua nova senha está ativa. Faça login para acessar.</p>
        <button type="button" onClick={onBack} className="auth-cta" style={{ marginTop: 16 }}>Fazer Login</button>
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
        <label className="auth-field__label">Nova senha</label>
        <div style={{ position: "relative" }}>
          <input type={showPw ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo 8 caracteres" required minLength={8} className="auth-field__input" />
          <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--faint)" }}>
            {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      <div className="auth-field">
        <label className="auth-field__label">Confirmar senha</label>
        <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repita a nova senha" required className="auth-field__input" />
      </div>
      {error ? <div className="auth-hint">{error}</div> : null}
      <button type="submit" disabled={busy} className="auth-cta">{busy ? "Salvando..." : "Redefinir senha"}</button>
    </form>
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
