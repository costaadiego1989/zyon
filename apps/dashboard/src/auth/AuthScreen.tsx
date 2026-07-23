import React from "react";
import { KeyRound, UserPlus } from "lucide-react";
import { SignupWizard } from "./SignupWizard.js";

export type AuthMode = "login" | "signup";

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
}

export function AuthScreen(props: AuthScreenProps) {
  const mode: AuthMode = props.mode;
  const isSignup = mode === "signup";
  return (
    <main style={{ display: "flex", width: "100%", height: "100vh", background: "oklch(10% 0.003 145)", fontFamily: "var(--sans, 'Manrope', sans-serif)", color: "oklch(96% 0.002 145)" }}>
      <section style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "60px 64px", background: "linear-gradient(165deg, oklch(12% 0.01 149) 0%, oklch(8% 0.003 145) 100%)", position: "relative", overflow: "hidden" }} aria-label="AACP">
        <div style={{ position: "absolute", top: -120, right: -120, width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, oklch(74% 0.19 149 / 0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -80, left: -80, width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, oklch(60% 0.17 149 / 0.05) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 1, maxWidth: 480 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 48 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(150deg, oklch(74% 0.19 149), oklch(60% 0.17 149))", display: "flex", alignItems: "center", justifyContent: "center", font: "700 16px 'IBM Plex Mono', monospace", color: "white" }}>Z</div>
            <div>
              <div style={{ font: "700 18px 'Source Serif 4', serif", letterSpacing: "-0.01em", color: "oklch(96% 0.002 145)" }}>Zyon Console</div>
              <div style={{ font: "11px 'IBM Plex Mono', monospace", color: "oklch(52% 0.006 145)", marginTop: 2 }}>Merchant Platform</div>
            </div>
          </div>
          <h1 style={{ font: "600 32px 'Source Serif 4', serif", letterSpacing: "-0.02em", lineHeight: 1.25, color: "oklch(96% 0.002 145)", marginBottom: 16 }}>
            Controle operacional para vender, integrar e acompanhar pedidos.
          </h1>
          <p style={{ font: "15px 'Manrope', sans-serif", color: "oklch(62% 0.008 145)", lineHeight: 1.6, marginBottom: 32 }}>
            Checkout agêntico com IA que negocia, oferece e converte — tudo em um painel unificado.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {["Webhooks assinados", "Tracking por API", "Embed seguro", "Multi-gateway"].map(item => (
              <span key={item} style={{ font: "500 11px 'IBM Plex Mono', monospace", padding: "6px 12px", borderRadius: 7, border: "1px solid oklch(27% 0.006 145)", background: "oklch(15% 0.003 145)", color: "oklch(70% 0.006 145)" }}>{item}</span>
            ))}
          </div>
          <div style={{ marginTop: 48, display: "flex", alignItems: "center", gap: 8, font: "11px 'IBM Plex Mono', monospace", color: "oklch(48% 0.006 145)" }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="oklch(48% 0.006 145)" strokeWidth="1.5" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V5l8-3z" /></svg>
            Dados criptografados em trânsito e repouso · SOC 2 em andamento
          </div>
        </div>
      </section>
      <section style={{ width: 460, flex: "none", display: "flex", flexDirection: "column", justifyContent: "center", padding: "48px 48px", background: "oklch(14% 0.003 145)", borderLeft: "1px solid oklch(22% 0.006 145)" }} aria-label={mode === "login" ? "Entrar" : "Criar conta"}>
        <div style={{ display: "flex", gap: 4, marginBottom: 32, background: "oklch(10% 0.002 145)", borderRadius: 10, padding: 4 }} role="tablist" aria-label="Acesso">
          <button type="button" onClick={() => props.setMode("login")} style={{ flex: 1, padding: "10px 16px", borderRadius: 8, border: "none", font: "600 12.5px 'Manrope', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: mode === "login" ? "oklch(20% 0.004 145)" : "transparent", color: mode === "login" ? "oklch(96% 0.002 145)" : "oklch(52% 0.006 145)", boxShadow: mode === "login" ? "0 1px 3px rgba(0,0,0,0.3)" : "none" }}>
            <KeyRound size={14} /> Entrar
          </button>
          <button type="button" onClick={() => props.setMode("signup")} style={{ flex: 1, padding: "10px 16px", borderRadius: 8, border: "none", font: "600 12.5px 'Manrope', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: mode === "signup" ? "oklch(20% 0.004 145)" : "transparent", color: mode === "signup" ? "oklch(96% 0.002 145)" : "oklch(52% 0.006 145)", boxShadow: mode === "signup" ? "0 1px 3px rgba(0,0,0,0.3)" : "none" }}>
            <UserPlus size={14} /> Criar conta
          </button>
        </div>
        {isSignup ? (
          <SignupWizard
            busy={props.busy}
            hint={props.hint}
            onRegister={props.onRegister}
            onSaveTheme={props.onSaveTheme}
            onComplete={props.onComplete}
            onSwitchToLogin={() => props.setMode("login")}
          />
        ) : (
        <form onSubmit={props.onSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ marginBottom: 4 }}>
            <p style={{ font: "500 11px 'IBM Plex Mono', monospace", letterSpacing: "0.04em", color: "oklch(52% 0.006 145)", marginBottom: 6 }}>{mode === "login" ? "Sessão merchant" : "Novo tenant"}</p>
            <h2 style={{ font: "600 22px 'Source Serif 4', serif", color: "oklch(96% 0.002 145)", letterSpacing: "-0.01em" }}>{mode === "login" ? "Acesse seu painel" : "Cadastre sua loja"}</h2>
          </div>
          {isSignup ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ font: "600 11px 'IBM Plex Mono', monospace", letterSpacing: "0.03em", color: "oklch(62% 0.006 145)" }}>Nome da loja</label>
              <input value={props.merchantName} onChange={(event) => props.setMerchantName(event.target.value)} autoComplete="organization" placeholder="Northstar Atelier" required style={{ padding: "12px 14px", borderRadius: 9, border: "1px solid oklch(27% 0.006 145)", background: "oklch(10% 0.002 145)", font: "14px 'Manrope', sans-serif", color: "oklch(96% 0.002 145)", outline: "none" }} />
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ font: "600 11px 'IBM Plex Mono', monospace", letterSpacing: "0.03em", color: "oklch(62% 0.006 145)" }}>Email</label>
            <input type="email" value={props.email} onChange={(event) => props.setEmail(event.target.value)} autoComplete="username" placeholder="owner@loja.com" required style={{ padding: "12px 14px", borderRadius: 9, border: "1px solid oklch(27% 0.006 145)", background: "oklch(10% 0.002 145)", font: "14px 'Manrope', sans-serif", color: "oklch(96% 0.002 145)", outline: "none" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ font: "600 11px 'IBM Plex Mono', monospace", letterSpacing: "0.03em", color: "oklch(62% 0.006 145)" }}>Senha</label>
              {mode === "login" ? (
                <button type="button" onClick={() => {}} style={{ font: "11px 'Manrope', sans-serif", color: "oklch(74% 0.19 149)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Esqueceu a senha?</button>
              ) : null}
            </div>
            <input type="password" value={props.password} onChange={(event) => props.setPassword(event.target.value)} autoComplete="current-password" placeholder="••••••••" minLength={4} required style={{ padding: "12px 14px", borderRadius: 9, border: "1px solid oklch(27% 0.006 145)", background: "oklch(10% 0.002 145)", font: "14px 'Manrope', sans-serif", color: "oklch(96% 0.002 145)", outline: "none" }} />
          </div>
          {isSignup ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ font: "600 11px 'IBM Plex Mono', monospace", letterSpacing: "0.03em", color: "oklch(62% 0.006 145)" }}>CNPJ / CPF (opcional)</label>
              <input type="text" placeholder="00.000.000/0001-00" style={{ padding: "12px 14px", borderRadius: 9, border: "1px solid oklch(27% 0.006 145)", background: "oklch(10% 0.002 145)", font: "14px 'Manrope', sans-serif", color: "oklch(96% 0.002 145)", outline: "none" }} />
            </div>
          ) : null}
          {props.hint ? <p style={{ font: "12.5px 'Manrope', sans-serif", color: "oklch(68% 0.18 25)", padding: "10px 14px", borderRadius: 8, background: "oklch(28% 0.06 25)", border: "1px solid oklch(35% 0.08 25)" }}>{props.hint}</p> : null}
          <button type="submit" disabled={props.busy} style={{ padding: "13px 20px", borderRadius: 9, border: "none", background: "linear-gradient(150deg, oklch(74% 0.19 149), oklch(60% 0.17 149))", font: "600 13.5px 'Manrope', sans-serif", color: "white", cursor: props.busy ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: props.busy ? 0.6 : 1, marginTop: 4, boxShadow: "0 2px 8px oklch(60% 0.17 149 / 0.3)" }}>
            {mode === "login" ? <KeyRound size={15} /> : <UserPlus size={15} />}
            {props.busy ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}
          </button>
          {isSignup ? (
            <p style={{ font: "11px 'Manrope', sans-serif", color: "oklch(48% 0.006 145)", textAlign: "center", lineHeight: 1.5, marginTop: 8 }}>
              Ao criar conta, você concorda com os <span style={{ color: "oklch(74% 0.19 149)", cursor: "pointer" }}>Termos de Serviço</span> e <span style={{ color: "oklch(74% 0.19 149)", cursor: "pointer" }}>Política de Privacidade</span>.
            </p>
          ) : null}
        </form>
        )}
        <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid oklch(22% 0.006 145)", display: "flex", justifyContent: "center", gap: 16, font: "11px 'IBM Plex Mono', monospace", color: "oklch(48% 0.006 145)" }}>
          <span>© 2026 Zyon</span>
          <span style={{ color: "oklch(30% 0.006 145)" }}>·</span>
          <span style={{ cursor: "pointer", color: "oklch(62% 0.008 145)" }}>Docs</span>
          <span style={{ color: "oklch(30% 0.006 145)" }}>·</span>
          <span style={{ cursor: "pointer", color: "oklch(62% 0.008 145)" }}>Status</span>
        </div>
      </section>
    </main>
  );
}
