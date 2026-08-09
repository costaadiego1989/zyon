import React from "react";
import { KeyRound, UserPlus } from "lucide-react";
import { SignupWizard } from "./SignupWizard.js";
import "./auth-screen.css";

export type AuthMode = "login" | "signup" | "forgot";

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
  onComplete: () => Promise<void>;
  apiBaseUrl?: string;
}

export function AuthScreen(props: AuthScreenProps) {
  const mode: AuthMode = props.mode;
  const isSignup = mode === "signup";
  return (
    <main className="auth-shell">
      <section className="auth-hero" aria-label="AACP">
        <div className="auth-hero__glow auth-hero__glow--top" />
        <div className="auth-hero__glow auth-hero__glow--bottom" />
        <div className="auth-hero__content">
          <div className="auth-hero__brand">
            <div className="auth-hero__logo">Z</div>
            <div>
              <div className="auth-hero__brand-name">Zyon Console</div>
              <div className="auth-hero__brand-sub">Merchant Platform</div>
            </div>
          </div>
          <h1 className="auth-hero__title">
            Controle operacional para vender, integrar e acompanhar pedidos.
          </h1>
          <p className="auth-hero__subtitle">
            Checkout agêntico com IA que negocia, oferece e converte — tudo em um painel unificado.
          </p>
          <div className="auth-hero__pills">
            {["Webhooks assinados", "Tracking por API", "Embed seguro", "Multi-gateway"].map(item => (
              <span key={item} className="auth-hero__pill">{item}</span>
            ))}
          </div>
          <div className="auth-hero__trust">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V5l8-3z" /></svg>
            Dados criptografados em trânsito e repouso · SOC 2 em andamento
          </div>
        </div>
      </section>

      <section className="auth-panel" aria-label={mode === "login" ? "Entrar" : "Criar conta"}>
        <div className="auth-panel__inner">
          <div className="auth-tabs" role="tablist" aria-label="Acesso">
            <button
              type="button"
              onClick={() => props.setMode("login")}
              className={`auth-tabs__btn ${mode === "login" ? "auth-tabs__btn--active" : ""}`}
              role="tab"
              aria-selected={mode === "login"}
            >
              <KeyRound size={14} /> Entrar
            </button>
            <button
              type="button"
              onClick={() => props.setMode("signup")}
              className={`auth-tabs__btn ${mode === "signup" ? "auth-tabs__btn--active" : ""}`}
              role="tab"
              aria-selected={mode === "signup"}
            >
              <UserPlus size={14} /> Criar conta
            </button>
          </div>

          <div className="auth-panel__form-area">
            {mode === "forgot" ? (
              <ForgotPasswordForm
                apiBaseUrl={props.apiBaseUrl}
                onBack={() => props.setMode("login")}
              />
            ) : isSignup ? (
              <SignupWizard
                busy={props.busy}
                hint={props.hint}
                onRegister={props.onRegister}
                onSaveTheme={props.onSaveTheme}
                onComplete={props.onComplete}
                onSwitchToLogin={() => props.setMode("login")}
              />
            ) : (
              <LoginForm {...props} />
            )}
          </div>

          <footer className="auth-footer">
            <span>© 2026 Zyon</span>
            <span className="auth-footer__dot">·</span>
            <a href="#" className="auth-footer__link">Docs</a>
            <span className="auth-footer__dot">·</span>
            <a href="#" className="auth-footer__link">Status</a>
          </footer>
        </div>
      </section>
    </main>
  );
}

function LoginForm(props: AuthScreenProps) {
  return (
    <form onSubmit={props.onSubmit} className="auth-form">
      <div className="auth-form__header">
        <span className="auth-form__kicker">Sessão merchant</span>
        <h2 className="auth-form__title">Acesse seu painel</h2>
      </div>
      <div className="auth-field">
        <label className="auth-field__label">Email</label>
        <input
          type="email"
          value={props.email}
          onChange={(e) => props.setEmail(e.target.value)}
          autoComplete="username"
          placeholder="owner@loja.com"
          required
          className="auth-field__input"
        />
      </div>
      <div className="auth-field">
        <div className="auth-field__label-row">
          <label className="auth-field__label">Senha</label>
          <button type="button" onClick={() => props.setMode("forgot")} className="auth-field__forgot">
            Esqueceu a senha?
          </button>
        </div>
        <input
          type="password"
          value={props.password}
          onChange={(e) => props.setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder="••••••••"
          minLength={4}
          required
          className="auth-field__input"
        />
      </div>
      {props.hint ? <div className="auth-hint">{props.hint}</div> : null}
      <button type="submit" disabled={props.busy} className="auth-cta">
        <KeyRound size={15} />
        {props.busy ? "Aguarde..." : "Entrar"}
      </button>
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
      const res = await fetch(`${base}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((body.detail as string) || "Erro ao enviar email");
      }
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="auth-form" style={{ alignItems: "center", textAlign: "center" }}>
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="oklch(74% 0.19 149)" strokeWidth="1.5" aria-hidden="true"><path d="M22 12h-6l-2 3H10l-2-3H2" /><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" /></svg>
        <h2 className="auth-form__title">Email enviado!</h2>
        <p className="auth-hero__subtitle" style={{ marginBottom: 0 }}>
          Se o email estiver cadastrado, você receberá um link para redefinir sua senha.
        </p>
        <button type="button" onClick={onBack} className="auth-field__forgot" style={{ marginTop: 12 }}>
          ← Voltar ao login
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="auth-form">
      <div className="auth-form__header">
        <span className="auth-form__kicker">Recuperação</span>
        <h2 className="auth-form__title">Redefinir senha</h2>
      </div>
      <p className="auth-hero__subtitle" style={{ marginBottom: 0 }}>
        Informe o email cadastrado e enviaremos um link para criar uma nova senha.
      </p>
      <div className="auth-field">
        <label className="auth-field__label">Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="owner@loja.com" required className="auth-field__input" />
      </div>
      {error ? <div className="auth-hint">{error}</div> : null}
      <button type="submit" disabled={busy} className="auth-cta">
        {busy ? "Enviando..." : "Enviar link de redefinição"}
      </button>
      <button type="button" onClick={onBack} className="auth-field__forgot" style={{ textAlign: "center", width: "100%" }}>
        ← Voltar ao login
      </button>
    </form>
  );
}
