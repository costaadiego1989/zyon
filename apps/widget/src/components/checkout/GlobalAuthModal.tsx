import {
  Bot,
  ChartColumn,
  ClipboardList,
  KeyRound,
  LogIn,
  LogOut,
  ShieldCheck,
  Smartphone,
  UserRound,
  X
} from "lucide-react";
import { useState } from "react";
import type { AccountHubSection, AccountHubState } from "../../hooks/use-account-hub.js";
import type { GlobalAuthController } from "../../hooks/use-global-auth.js";
import { cn } from "../../hooks/checkout-view-model.js";

interface GlobalAuthModalProps {
  auth: GlobalAuthController;
  hub: AccountHubState;
}

const HUB_NAV: Array<{ key: AccountHubSection; label: string; icon: typeof ClipboardList }> = [
  { key: "summary", label: "Resumo", icon: ShieldCheck },
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

  const handlePhoneChange = (value: string) => {
    const numbers = value.replace(/\D/g, "").slice(0, 11);
    let masked = numbers;
    if (numbers.length > 2) masked = `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    if (numbers.length > 7) {
      masked = `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
    }
    setPhone(masked);
  };

  const normalizedPhone = phone.replace(/\D/g, "");
  const canSendCode = normalizedPhone.length >= 10;
  const canConfirmCode = codeSent && phoneCode.trim().length === 6;

  if (auth.panel === "hub" && auth.session) {
    return <AccountHub auth={auth} hub={hub} />;
  }

  return (
    <div className="aacp-auth-layer" role="presentation">
      <div className="aacp-auth-backdrop" onClick={auth.close} aria-hidden />
      <section
        className="aacp-auth-dialog aacp-login-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aacp-login-title"
      >
        <button type="button" className="aacp-icon-button aacp-auth-close" onClick={auth.close} aria-label="Fechar">
          <X size={20} />
        </button>

        <div className="aacp-auth-icon" aria-hidden>
          <LogIn size={24} />
        </div>

        <span className="aacp-auth-eyebrow">Conta segura</span>
        <h2 id="aacp-login-title" className="aacp-auth-title">
          Entrar com celular
        </h2>
        <p className="aacp-auth-copy">
          Acesse pedidos anteriores e conclua compras futuras com menos etapas.
        </p>

        <div className="aacp-auth-assurance">
          <ShieldCheck size={17} />
          <span>Seu acesso e seus dados permanecem protegidos.</span>
        </div>

        <button type="button" className="aacp-auth-provider" disabled>
          <span className="aacp-auth-provider-mark" aria-hidden>G</span>
          Entrar com Google em breve
        </button>

        <div className="aacp-auth-divider" aria-hidden>
          <span>ou use seu celular</span>
        </div>

        <form
          className="aacp-auth-form"
          onSubmit={(event) => event.preventDefault()}
        >
          {!codeSent ? (
            <label className="aacp-auth-field">
              <span>Celular</span>
              <div className="aacp-auth-input-wrap">
                <Smartphone size={19} aria-hidden />
                <input
                  value={phone}
                  onChange={(event) => handlePhoneChange(event.target.value)}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(11) 99999-9999"
                  aria-label="Numero do celular"
                />
              </div>
            </label>
          ) : (
            <label className="aacp-auth-field">
              <span>Codigo de verificacao</span>
              <div className="aacp-auth-input-wrap">
                <KeyRound size={19} aria-hidden />
                <input
                  value={phoneCode}
                  onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  maxLength={6}
                  aria-label="Codigo de verificacao"
                />
              </div>
            </label>
          )}

          {codeSent ? (
            <p className="aacp-auth-status" role="status">
              Codigo enviado para {normalizedPhone}
            </p>
          ) : null}

          {auth.error ? (
            <p className="aacp-auth-error" role="alert">
              {auth.error}
            </p>
          ) : null}

          <button
            type="button"
            className="aacp-auth-primary"
            disabled={auth.loading || (!codeSent && !canSendCode) || (codeSent && !canConfirmCode)}
            onClick={async () => {
              if (!codeSent) {
                const sent = await auth.sendPhoneCode(normalizedPhone);
                if (sent) setCodeSent(true);
                return;
              }
              await auth.verifyPhoneCode(normalizedPhone, phoneCode);
            }}
          >
            {auth.loading ? "Processando..." : codeSent ? "Confirmar codigo" : "Enviar codigo por SMS"}
          </button>

          {codeSent ? (
            <button type="button" className="aacp-auth-secondary" onClick={() => setCodeSent(false)}>
              Alterar numero
            </button>
          ) : null}
        </form>
      </section>
    </div>
  );
}

function AccountHub({ auth, hub }: GlobalAuthModalProps) {
  const overview = hub.data.overview;
  const merchant = hub.data.merchant;
  const theme = hub.data.merchantTheme;
  const agentContext = hub.data.agentContext;
  const currentLabel = HUB_NAV.find((item) => item.key === hub.section)?.label ?? "Resumo";

  return (
    <div className="aacp-auth-layer" role="presentation">
      <div className="aacp-auth-backdrop" onClick={auth.close} aria-hidden />
      <section
        className="aacp-auth-dialog aacp-hub-sheet aacp-hub-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aacp-hub-title"
      >
        <header className="aacp-hub-header">
          <div className="aacp-hub-identity">
            <div className="aacp-hub-mark" aria-hidden>
              <ShieldCheck size={20} />
            </div>
            <div>
              <span>Conta verificada</span>
              <strong id="aacp-hub-title">{auth.session?.email}</strong>
            </div>
          </div>
          <button type="button" className="aacp-icon-button" onClick={auth.close} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>

        <div className="aacp-hub-layout">
          <nav className="aacp-hub-nav" aria-label="Navegacao da conta">
            <div className="aacp-hub-nav-label">Sua conta</div>
            {HUB_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={cn("aacp-hub-nav-item", hub.section === item.key && "is-active")}
                  onClick={() => hub.setSection(item.key)}
                  aria-current={hub.section === item.key ? "page" : undefined}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              );
            })}
            <button type="button" className="aacp-hub-logout" onClick={auth.logout}>
              <LogOut size={18} />
              <span>Sair da conta</span>
            </button>
          </nav>

          <main className="aacp-hub-content">
            <div className="aacp-hub-content-head">
              <div>
                <span>Central do comprador</span>
                <h2>{currentLabel}</h2>
              </div>
              <span className="aacp-hub-secure-label">
                <ShieldCheck size={15} />
                Sessao protegida
              </span>
            </div>

            {hub.loading ? <div className="aacp-hub-state">Carregando...</div> : null}
            {hub.error && !hub.loading ? <div className="aacp-hub-state is-error">{hub.error}</div> : null}

            {!hub.loading && !hub.error && hub.section === "summary" ? (
              <div className="aacp-hub-section">
                <article className="aacp-hub-overview">
                  <span>Resumo da operacao</span>
                  <h3>{merchant?.name ?? "Sua conta"}</h3>
                  <p>
                    {overview
                      ? `${overview.conversations_started} sessões iniciadas hoje.`
                      : "Seus dados de compra aparecerao aqui assim que estiverem disponiveis."}
                  </p>
                </article>
                <div className="aacp-hub-metrics">
                  <MetricCard label="Experiencia" value={theme?.fontFamily ?? "Padrao da loja"} />
                  <MetricCard
                    label="Metodo de acesso"
                    value={auth.session?.provider === "password" ? "Senha" : "Celular"}
                  />
                </div>
              </div>
            ) : null}

            {!hub.loading && !hub.error && hub.section === "orders" ? (
              <div className="aacp-hub-section">
                <SectionIntro
                  title="Pedidos recentes"
                  description="Acompanhe as sessoes e valores associados a esta conta."
                />
                <div className="aacp-hub-list">
                  {overview?.recent_sessions?.length ? (
                    overview.recent_sessions.map((session) => (
                      <article key={session.sessionId} className="aacp-hub-list-row">
                        <div>
                          <strong>{session.sessionId}</strong>
                          <span>{session.customer?.email ?? "Cliente nao identificado"}</span>
                        </div>
                        <span>{formatMoney(session.cart.total)}</span>
                      </article>
                    ))
                  ) : (
                    <EmptyHubState text="Nenhum pedido recente encontrado." />
                  )}
                </div>
              </div>
            ) : null}

            {!hub.loading && !hub.error && hub.section === "metrics" ? (
              <div className="aacp-hub-section">
                <SectionIntro
                  title="Desempenho operacional"
                  description="Indicadores essenciais da experiencia assistida."
                />
                <div className="aacp-hub-metrics">
                  <MetricCard
                label="Receita IA"
                    value={formatMoney(overview?.incremental_revenue ?? 0)}
                    emphasis
                  />
                  <MetricCard
                    label="Sessoes iniciadas"
                    value={overview?.conversations_started ?? 0}
                  />
                </div>
              </div>
            ) : null}

            {!hub.loading && !hub.error && hub.section === "agent" ? (
              <div className="aacp-hub-section">
                <SectionIntro
                  title="Assistente da loja"
                  description="Entenda quem conduz a experiencia e como ele opera."
                />
                <dl className="aacp-hub-details">
                  <Detail label="Nome" value={agentContext?.agent?.agentName ?? "Assistente de compras"} />
                  <Detail label="Persona" value={agentContext?.agent?.persona ?? "Orientacao clara e objetiva."} />
                  <Detail
                    label="Modo de operacao"
                    value={agentContext?.checkout_settings?.agentMode ?? "Assistido"}
                  />
                </dl>
              </div>
            ) : null}

            {!hub.loading && !hub.error && hub.section === "account" ? (
              <div className="aacp-hub-section">
                <SectionIntro
                  title="Dados da conta"
                  description="Informacoes usadas para identificar sua sessao de compra."
                />
                <dl className="aacp-hub-details">
                  <Detail label="E-mail" value={auth.session?.email ?? "Nao informado"} />
                  <Detail label="Status" value="Conta verificada" />
                  <Detail label="Protecao" value="Sessao autenticada" />
                </dl>
              </div>
            ) : null}
          </main>
        </div>
      </section>
    </div>
  );
}

function SectionIntro({ title, description }: { title: string; description: string }) {
  return (
    <header className="aacp-hub-section-intro">
      <h3>{title}</h3>
      <p>{description}</p>
    </header>
  );
}

function MetricCard({
  label,
  value,
  emphasis = false
}: {
  label: string;
  value: string | number;
  emphasis?: boolean;
}) {
  return (
    <article className={cn("aacp-hub-metric", emphasis && "is-emphasis")}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function EmptyHubState({ text }: { text: string }) {
  return <div className="aacp-hub-empty">{text}</div>;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
