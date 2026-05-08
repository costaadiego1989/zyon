import {
  ArrowRight,
  Bot,
  ChartColumn,
  ChevronRight,
  ClipboardList,
  Chrome,
  KeyRound,
  LogOut,
  Settings2,
  Smartphone,
  Sparkles,
  UserRound,
  X
} from "lucide-react";
import { useState } from "react";
import type { AccountHubSection, AccountHubState } from "./use-account-hub.js";
import type { GlobalAuthController } from "./use-global-auth.js";

interface GlobalAuthModalProps {
  auth: GlobalAuthController;
  hub: AccountHubState;
}

const HUB_NAV: Array<{ key: AccountHubSection; label: string; icon: typeof ClipboardList }> = [
  { key: "summary", label: "Resumo", icon: Sparkles },
  { key: "orders", label: "Pedidos", icon: ClipboardList },
  { key: "metrics", label: "Métricas", icon: ChartColumn },
  { key: "account", label: "Conta", icon: UserRound },
  { key: "agent", label: "Agente", icon: Bot }
];

export function GlobalAuthModal({ auth, hub }: GlobalAuthModalProps) {
  const [phone, setPhone] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [phoneCode, setPhoneCode] = useState("");
  if (!auth.open) return null;

  if (auth.panel === "hub" && auth.session) {
    const overview = hub.data.overview;
    const merchant = hub.data.merchant;
    const checkoutSettings = hub.data.checkoutSettings;
    const agentContext = hub.data.agentContext;
    const theme = hub.data.merchantTheme;
    return (
      <div className="aacp-auth-modal" role="presentation">
        <button
          type="button"
          className="aacp-auth-backdrop"
          aria-label="Fechar hub"
          onClick={auth.close}
        />
        <section className="aacp-hub-sheet" role="dialog" aria-modal="true" aria-labelledby="aacp-hub-title">
          <header className="aacp-hub-header">
            <div className="aacp-hub-brand">
              <div className="aacp-auth-google-mark aacp-hub-mark" aria-hidden="true">
                <Chrome size={18} />
              </div>
              <div>
                <span>Conta global</span>
                <strong id="aacp-hub-title">{auth.session.email}</strong>
                <small>{merchant?.name ?? auth.session.merchant_name ?? "Sessão autenticada"}</small>
              </div>
            </div>
            <div className="aacp-hub-actions">
              <button type="button" className="aacp-auth-secondary" onClick={hub.refresh} disabled={hub.loading}>
                {hub.loading ? "Atualizando..." : "Atualizar"}
              </button>
              <button type="button" className="aacp-auth-close" onClick={auth.close} aria-label="Fechar hub">
                <X size={18} />
              </button>
            </div>
          </header>

          <div className="aacp-hub-shell">
            <nav className="aacp-hub-nav" aria-label="Menu da conta">
              {HUB_NAV.map((item) => {
                const Icon = item.icon;
                const active = hub.section === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={active ? "is-active" : ""}
                    onClick={() => hub.setSection(item.key)}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span>{item.label}</span>
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                );
              })}
              <button type="button" className="aacp-hub-logout" onClick={auth.logout}>
                <LogOut size={16} aria-hidden="true" />
                <span>Sair da conta</span>
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            </nav>

            <div className="aacp-hub-content">
              {hub.error ? <p className="aacp-auth-error">{hub.error}</p> : null}

              {hub.section === "summary" ? (
                <section className="aacp-hub-grid">
                  <article className="aacp-hub-card aacp-hub-card--hero">
                    <span>Checkout assistido por IA</span>
                    <strong>{merchant?.name ?? auth.session.merchant_name ?? "Conta conectada"}</strong>
                    <p>
                      {overview
                        ? `${overview.conversations_started} sessões · ${overview.orders_completed} pedidos concluídos`
                        : "Resumo comercial carregado da API."}
                    </p>
                  </article>
                  <article className="aacp-hub-card">
                    <span>Plano visual</span>
                    <strong>{theme?.fontFamily ?? "Tema padrão"}</strong>
                    <p>Fonte, cor e superfície seguem a configuração salva no merchant.</p>
                  </article>
                  <article className="aacp-hub-card">
                    <span>Login</span>
                    <strong>{auth.session.email}</strong>
                    <p>{auth.session.provider === "password" ? "Sessão por senha" : "Sessão global"}</p>
                  </article>
                </section>
              ) : null}

              {hub.section === "orders" ? (
                <section className="aacp-hub-stack">
                  <div className="aacp-hub-section-head">
                    <div>
                      <span>Histórico</span>
                      <strong>Pedidos e sessões recentes</strong>
                    </div>
                    <small>{overview?.recent_sessions.length ?? 0} itens recentes</small>
                  </div>
                  <div className="aacp-hub-list">
                    {(overview?.recent_sessions ?? []).slice(0, 4).map((session) => (
                      <article className="aacp-hub-list-item" key={session.sessionId}>
                        <div>
                          <strong>{session.sessionId}</strong>
                          <p>{session.customer?.email ?? "Sem e-mail informado"}</p>
                        </div>
                        <div>
                          <strong>
                            {session.cart.currency} {session.cart.total.toFixed(2)}
                          </strong>
                          <p>{session.paymentMethod ?? "checkout"}</p>
                        </div>
                      </article>
                    ))}
                    {(overview?.recent_sessions ?? []).length === 0 ? (
                      <div className="aacp-hub-empty">Nenhum pedido recente disponível.</div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {hub.section === "metrics" ? (
                <section className="aacp-hub-grid">
                  <MetricCard label="Sessões" value={overview?.conversations_started ?? 0} />
                  <MetricCard label="Pedidos" value={overview?.orders_completed ?? 0} />
                  <MetricCard label="Conversão" value={formatPercent(overview?.conversion_rate_with_agent ?? 0)} />
                  <MetricCard label="Receita IA" value={formatMoney(overview?.incremental_revenue ?? 0)} />
                </section>
              ) : null}

              {hub.section === "account" ? (
                <section className="aacp-hub-stack">
                  <div className="aacp-hub-section-head">
                    <div>
                      <span>Config do usuário</span>
                      <strong>Identidade e tema da conta</strong>
                    </div>
                  </div>
                  <div className="aacp-hub-list">
                    <article className="aacp-hub-list-item">
                      <div>
                        <strong>Email</strong>
                        <p>{auth.session.email}</p>
                      </div>
                      <div>
                        <strong>Merchant</strong>
                        <p>{auth.session.merchant_id}</p>
                      </div>
                    </article>
                    <article className="aacp-hub-list-item">
                      <div>
                        <strong>Nome</strong>
                        <p>{merchant?.name ?? auth.session.merchant_name ?? "Não informado"}</p>
                      </div>
                      <div>
                        <strong>Fonte</strong>
                        <p>{theme?.fontFamily ?? "Tema padrão"}</p>
                      </div>
                    </article>
                  </div>
                </section>
              ) : null}

              {hub.section === "agent" ? (
                <section className="aacp-hub-stack">
                  <div className="aacp-hub-section-head">
                    <div>
                      <span>Config do agente</span>
                      <strong>Comportamento, regras e contexto</strong>
                    </div>
                  </div>
                  <div className="aacp-hub-list">
                    <article className="aacp-hub-list-item">
                      <div>
                        <strong>Modo</strong>
                        <p>{checkoutSettings?.checkout_settings.mode ?? "proactive"}</p>
                      </div>
                      <div>
                        <strong>Handoff</strong>
                        <p>{checkoutSettings?.checkout_settings.handoff_enabled ? "Ativo" : "Desligado"}</p>
                      </div>
                    </article>
                    <article className="aacp-hub-list-item">
                      <div>
                        <strong>Persona</strong>
                        <p>{agentContext?.agent.persona ?? "assistente premium"}</p>
                      </div>
                      <div>
                        <strong>Tom</strong>
                        <p>{agentContext?.agent.tone ?? "premium"}</p>
                      </div>
                    </article>
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    );
  }

  const normalizedPhone = phone.replace(/\D/g, "");
  const canSendCode = normalizedPhone.length >= 10;
  const canConfirmCode = codeSent && phoneCode.trim().length >= 4;

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
              <Smartphone size={20} />
            </div>
            <div>
              <span>Login seguro</span>
              <strong>Entrar com celular</strong>
            </div>
          </div>
          <button type="button" className="aacp-auth-close" onClick={auth.close} aria-label="Fechar modal">
            <X size={18} />
          </button>
        </header>

        <div className="aacp-auth-copy">
          <p id="aacp-auth-title">
            Receba um codigo de acesso no celular para entrar sem senha. O Google fica preparado para OAuth,
            mas permanece desabilitado nesta etapa.
          </p>
          {auth.session ? (
            <div className="aacp-auth-session">
              <span>Conta ativa</span>
              <strong>{auth.session.email}</strong>
              <small>{auth.session.merchant_name ?? "Sessão global autenticada"}</small>
            </div>
          ) : null}
        </div>

        <form
          className="aacp-auth-form"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <label>
            <span>Celular</span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(11) 99999-9999"
            />
          </label>

          {codeSent ? (
            <label>
              <span>Codigo recebido</span>
              <input
                value={phoneCode}
                onChange={(event) => setPhoneCode(event.target.value)}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
              />
            </label>
          ) : null}

          {auth.error ? <p className="aacp-auth-error">{auth.error}</p> : null}
          {auth.status ? <p className="aacp-auth-status">{auth.status}</p> : null}
          {codeSent ? (
            <p className="aacp-auth-status">
              Codigo enviado para {phone}. Digite o codigo recebido para continuar.
            </p>
          ) : null}

          <button
            type="button"
            className="aacp-auth-submit"
            disabled={auth.loading || (!codeSent && !canSendCode) || (codeSent && !canConfirmCode)}
            onClick={() => {
              if (!codeSent) setCodeSent(true);
            }}
          >
            {codeSent ? <KeyRound size={16} aria-hidden="true" /> : <Smartphone size={16} aria-hidden="true" />}
            {codeSent ? "Confirmar codigo" : "Enviar codigo por SMS"}
          </button>

          <button type="button" className="aacp-auth-secondary" disabled aria-disabled="true">
            <Chrome size={16} aria-hidden="true" />
            Entrar com Google em breve
          </button>

          {auth.session ? (
            <button type="button" className="aacp-auth-secondary" onClick={auth.openHub}>
              <Settings2 size={16} aria-hidden="true" />
              Abrir hub da conta
            </button>
          ) : null}
        </form>
      </section>
    </div>
  );
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="aacp-hub-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
