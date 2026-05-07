import { Chrome, LogIn, Store, X } from "lucide-react";
import type { GlobalAuthController } from "./use-global-auth.js";

export function GlobalAuthModal({ auth }: { auth: GlobalAuthController }) {
  if (!auth.open) return null;

  const title = auth.mode === "login" ? "Entrar na aplicação global" : "Criar conta global";
  const subtitle =
    auth.mode === "login"
      ? "Use sua conta global para acessar o checkout e reaproveitar identidade, cookies e sessão."
      : "Crie sua conta global para registrar a loja e reutilizar a sessão em outros checkouts.";

  return (
    <div className="aacp-auth-modal" role="presentation">
      <button
        type="button"
        className="aacp-auth-backdrop"
        aria-label="Fechar modal de login"
        onClick={auth.close}
      />
      <section className="aacp-auth-sheet" role="dialog" aria-modal="true" aria-labelledby="aacp-auth-title">
        <header className="aacp-auth-header">
          <div className="aacp-auth-brand">
            <div className="aacp-auth-google-mark" aria-hidden="true">
              <span className="g g-blue" />
              <span className="g g-red" />
              <span className="g g-yellow" />
              <span className="g g-green" />
              <span>G</span>
            </div>
            <div>
              <span>Global account</span>
              <strong>{title}</strong>
            </div>
          </div>
          <button type="button" className="aacp-auth-close" onClick={auth.close} aria-label="Fechar modal">
            <X size={18} />
          </button>
        </header>

        <div className="aacp-auth-copy">
          <p id="aacp-auth-title">{subtitle}</p>
          {auth.session ? (
            <div className="aacp-auth-session">
              <span>Conta ativa</span>
              <strong>{auth.session.email}</strong>
              <small>{auth.session.merchant_name ?? "Sessão global autenticada"}</small>
            </div>
          ) : null}
        </div>

        <div className="aacp-auth-tabs" role="tablist" aria-label="Modo de autenticação">
          <button
            type="button"
            role="tab"
            aria-selected={auth.mode === "login"}
            className={auth.mode === "login" ? "is-active" : ""}
            onClick={() => auth.setMode("login")}
          >
            Entrar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={auth.mode === "register"}
            className={auth.mode === "register" ? "is-active" : ""}
            onClick={() => auth.setMode("register")}
          >
            Criar conta
          </button>
        </div>

        <form
          className="aacp-auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            void auth.submit();
          }}
        >
          <label>
            <span>Email</span>
            <input
              value={auth.email}
              onChange={(event) => auth.setEmail(event.target.value)}
              type="email"
              autoComplete="username"
              placeholder="voce@empresa.com"
            />
          </label>

          <label>
            <span>Password</span>
            <input
              value={auth.password}
              onChange={(event) => auth.setPassword(event.target.value)}
              type="password"
              autoComplete={auth.mode === "login" ? "current-password" : "new-password"}
              placeholder="••••••••"
            />
          </label>

          {auth.mode === "register" ? (
            <label>
              <span>Nome da loja</span>
              <input
                value={auth.merchantName}
                onChange={(event) => auth.setMerchantName(event.target.value)}
                type="text"
                autoComplete="organization"
                placeholder="Northstar Atelier"
              />
            </label>
          ) : null}

          {auth.error ? <p className="aacp-auth-error">{auth.error}</p> : null}
          {auth.status ? <p className="aacp-auth-status">{auth.status}</p> : null}

          <button type="submit" className="aacp-auth-submit" disabled={auth.loading}>
            <LogIn size={16} aria-hidden="true" />
            {auth.loading ? "Conectando..." : auth.mode === "login" ? "Entrar na conta global" : "Criar conta global"}
          </button>

          {auth.mode === "login" ? (
            <button type="button" className="aacp-auth-secondary" onClick={auth.openRegister}>
              <Store size={16} aria-hidden="true" />
              Ainda não tenho conta global
            </button>
          ) : (
            <button type="button" className="aacp-auth-secondary" onClick={auth.openLogin}>
              <Chrome size={16} aria-hidden="true" />
              Já tenho conta global
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
