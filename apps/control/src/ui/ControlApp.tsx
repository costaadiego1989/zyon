import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Building2,
  CircleUserRound,
  FileClock,
  HeartPulse,
  LogOut,
  Menu,
  MessageSquareMore,
  ReceiptText,
  ServerCog,
  ShoppingBag,
  ShieldCheck,
  TicketPercent,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  PlatformApi,
  PlatformApiError,
  type PlatformOverview,
  type PlatformOverviewSourceId,
  type PlatformOperator,
  type PlatformOperatorRole,
  resolvePlatformApiBaseUrl,
} from "../lib/api.js";
import { clearPlatformSession, readPlatformSession, writePlatformSession } from "../lib/session.js";
import { AiUsageByMerchant } from "./AiCostsByCompany.js";
import { AiGovernance } from "./AiGovernance.js";
import { AuditTrail } from "./AuditTrail.js";
import { BillingSubscriptions } from "./BillingSubscriptions.js";
import { FeedbackQueue } from "./FeedbackQueue.js";
import { SupportInbox } from "./SupportInbox.js";
import { InfrastructureReadiness } from "./InfrastructureReadiness.js";
import { MerchantDirectory } from "./MerchantDirectory.js";
import { PlatformMetricsPanel } from "./PlatformMetrics.js";
import { OrdersPage } from "./OrdersPage.js";
import { BillingPromotions } from "./BillingPromotions.js";
import { Disclosure } from "./Disclosure.js";
import "./minimal.css";

type ViewId = "support" | "overview" | "feedback" | "merchants" | "orders" | "billing" | "billing-promotions" | "ai-usage" | "ai-governance" | "infrastructure" | "audit";

type NavigationItem = {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  permission?: "support" | "feedback" | "merchants" | "orders" | "billing" | "ai-usage" | "infrastructure" | "audit";
  source?: "ready" | "pending";
};

const navigation: NavigationItem[] = [
  { id: "support", label: "Atendimento técnico", icon: MessageSquareMore, permission: "support", source: "ready" },
  { id: "overview", label: "Visão geral", icon: Activity, source: "ready" },
  { id: "feedback", label: "Feedback", icon: MessageSquareMore, permission: "feedback", source: "ready" },
  { id: "merchants", label: "Empresas", icon: Building2, permission: "merchants", source: "ready" },
  { id: "orders", label: "Pedidos", icon: ShoppingBag, permission: "orders", source: "ready" },
  { id: "billing", label: "Cobrança", icon: ReceiptText, permission: "billing", source: "ready" },
  { id: "billing-promotions", label: "Cupons de assinatura", icon: TicketPercent, permission: "billing", source: "ready" },
  { id: "ai-usage", label: "Uso de IA", icon: Bot, permission: "ai-usage", source: "ready" },
  { id: "ai-governance", label: "Governança de IA", icon: ShieldCheck, permission: "ai-usage", source: "ready" },
  { id: "infrastructure", label: "Infraestrutura", icon: ServerCog, permission: "infrastructure", source: "ready" },
  { id: "audit", label: "Auditoria", icon: FileClock, permission: "audit", source: "ready" },
];

const roleLabels: Record<PlatformOperatorRole, string> = {
  platform_admin: "Administração da plataforma",
  billing_ops: "Operações de cobrança",
  support_ops: "Operações de suporte",
  infra_ops: "Operações de infraestrutura",
  auditor: "Auditoria",
};

const overviewSourceRows: Array<{ source: PlatformOverviewSourceId; title: string; icon: LucideIcon }> = [
  { source: "merchant_registry", title: "Empresas e usuários", icon: Building2 },
  { source: "subscriptions", title: "Assinaturas", icon: ReceiptText },
  { source: "receivables", title: "Recebíveis", icon: ReceiptText },
  { source: "delinquency", title: "Inadimplência", icon: ReceiptText },
  { source: "due_dates", title: "Vencimentos", icon: FileClock },
  { source: "ai_chat", title: "IA: chat", icon: Bot },
  { source: "ai_voice", title: "IA: voz", icon: Bot },
  { source: "infrastructure", title: "Infraestrutura", icon: HeartPulse },
];

export function ControlApp() {
  const [session, setSession] = useState(readPlatformSession);
  const [checkingSession, setCheckingSession] = useState(Boolean(session));
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const api = useMemo(() => new PlatformApi(resolvePlatformApiBaseUrl(import.meta.env), {
    token: session?.token,
    onRefreshed(response) {
      writePlatformSession(response);
      setSession({ token: response.access_token, operator: {
        operator_id: response.operator_id, email: response.email, role: response.role,
      } });
    },
    onExpired() {
      clearPlatformSession();
      setSession(null);
      setSessionMessage("Sua sessão expirou. Entre novamente para continuar.");
    },
  }), []);

  useEffect(() => {
    if (!session) {
      setCheckingSession(false);
      return;
    }
    let cancelled = false;
    void api.me(session.token)
      .then(operator => {
        if (cancelled) return;
        // /me may have renewed the token. Keep that replacement in state/storage.
        setSession(current => {
          if (!current) return null;
          const verified = { ...current, operator };
          writePlatformSession(verified);
          return verified;
        });
      })
      .catch(error => {
        if (cancelled) return;
        // A timeout, offline connection or 5xx does not invalidate a session.
        if (!(error instanceof PlatformApiError) || error.status !== 401) return;
        clearPlatformSession();
        setSession(null);
        setSessionMessage("A sessão não está mais válida. Entre novamente.");
      })
      .finally(() => {
        if (!cancelled) setCheckingSession(false);
      });
    return () => { cancelled = true; };
  }, [api]);

  useEffect(() => {
    if (!session) return;
    const renew = () => {
      if (document.visibilityState !== "hidden") void api.renewSession().catch(() => {
        // Invalid credentials are handled centrally; transient failures retry
        // on the next interval, request, or return to this tab.
      });
    };
    const interval = window.setInterval(renew, 30_000);
    window.addEventListener("focus", renew);
    window.addEventListener("online", renew);
    document.addEventListener("visibilitychange", renew);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", renew);
      window.removeEventListener("online", renew);
      document.removeEventListener("visibilitychange", renew);
    };
  }, [api, session?.operator.operator_id]);

  async function handleLogin(email: string, password: string) {
    const response = await api.login(email, password);
    writePlatformSession(response);
    setSession({
      token: response.access_token,
      operator: {
        operator_id: response.operator_id,
        email: response.email,
        role: response.role,
      },
    });
    setSessionMessage(null);
  }

  async function handleLogout() {
    if (session) {
      try {
        await api.logout(session.token);
      } catch {
        // The token is removed locally even if the API cannot be reached.
      }
    }
    clearPlatformSession();
    setSession(null);
  }

  function handleSessionExpired() {
    clearPlatformSession();
    setSession(null);
    setSessionMessage("Sua sessão expirou. Entre novamente para continuar.");
  }

  if (checkingSession) return <SessionSkeleton />;
  if (!session) return <OperatorLogin onSubmit={handleLogin} initialMessage={sessionMessage} />;

  return (
    <ControlShell
      api={api}
      token={session.token}
      operator={session.operator}
      onLogout={handleLogout}
      onSessionExpired={handleSessionExpired}
    />
  );
}

function ControlShell({
  api,
  token,
  operator,
  onLogout,
  onSessionExpired,
}: {
  api: PlatformApi;
  token: string;
  operator: PlatformOperator;
  onLogout: () => Promise<void>;
  onSessionExpired: () => void;
}) {
  const [view, setView] = useState<ViewId>("overview");
  const [navOpen, setNavOpen] = useState(false);
  const allowedNavigation = navigation.filter(item => canReadNavigationItem(item, operator.role));
  const readyNavigation = allowedNavigation.filter(item => item.source === "ready");
  const pendingNavigation = allowedNavigation.filter(item => item.source === "pending");
  const title = navigation.find(item => item.id === view)?.label ?? "Central operacional";

  function selectView(id: ViewId) {
    setView(id);
    setNavOpen(false);
  }

  return (
    <div className="control-app">
      <a className="skip-link" href="#control-content">Pular para o conteúdo</a>
      <aside className={`control-sidebar ${navOpen ? "control-sidebar--open" : ""}`} aria-label="Navegação principal">
        <div className="control-brand">
          <img className="control-mark" src="/zyon-z.png" alt="" width="44" height="33" />
          <span>
            <strong>Zyon</strong>
            <small>Control</small>
          </span>
          <button className="icon-button control-sidebar__close" type="button" onClick={() => setNavOpen(false)} aria-label="Fechar navegação">
            <X size={18} />
          </button>
        </div>

        <nav className="control-nav">
          <p className="nav-label">Operação</p>
          {readyNavigation.map(item => (
            <NavigationButton key={item.id} item={item} selected={item.id === view} onClick={() => selectView(item.id)} />
          ))}
          {pendingNavigation.length > 0 ? <>
            <p className="nav-label nav-label--spaced">Fontes em preparação</p>
            {pendingNavigation.map(item => (
              <NavigationButton key={item.id} item={item} selected={item.id === view} onClick={() => selectView(item.id)} />
            ))}
          </> : null}
        </nav>

        <div className="sidebar-operator">
          <div className="operator-avatar" aria-hidden="true">{operator.email.slice(0, 1).toUpperCase()}</div>
          <div className="operator-summary">
            <strong>{operator.email}</strong>
            <span>{roleLabels[operator.role]}</span>
          </div>
          <button className="icon-button" type="button" onClick={() => void onLogout()} aria-label="Sair do painel">
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      {navOpen ? <button type="button" className="nav-backdrop" onClick={() => setNavOpen(false)} aria-label="Fechar navegação" /> : null}

      <div className="control-main">
        <header className="control-topbar">
          <button className="icon-button control-menu" type="button" onClick={() => setNavOpen(true)} aria-label="Abrir navegação" aria-expanded={navOpen}>
            <Menu size={19} />
          </button>
          <div>
            <p className="eyebrow">Central operacional</p>
            <h1>{title}</h1>
          </div>
          <div className="topbar-operator">
            <CircleUserRound size={18} aria-hidden="true" />
            <span>{roleLabels[operator.role]}</span>
          </div>
        </header>

        <main id="control-content" className={`control-content ${view === "ai-usage" ? "" : "control-content--minimal"}`}>
          {view === "overview" ? <Overview api={api} token={token} onNavigate={selectView} role={operator.role} onSessionExpired={onSessionExpired} /> : null}
          {view === "feedback" ? (
            <FeedbackQueue api={api} token={token} operator={operator} onSessionExpired={onSessionExpired} />
          ) : null}
          {view === "support" ? <SupportInbox api={api} token={token} operator={operator} onSessionExpired={onSessionExpired} /> : null}
          {view === "merchants" ? <MerchantDirectory api={api} token={token} onSessionExpired={onSessionExpired} /> : null}
          {view === "orders" ? <OrdersPage api={api} token={token} onSessionExpired={onSessionExpired} /> : null}
          {view === "billing" ? <BillingSubscriptions api={api} token={token} onSessionExpired={onSessionExpired} /> : null}
          {view === "billing-promotions" ? <BillingPromotions api={api} token={token} canWrite={operator.role === "platform_admin"} onSessionExpired={onSessionExpired} /> : null}
          {view === "ai-usage" ? <AiUsageByMerchant api={api} token={token} onSessionExpired={onSessionExpired} canExport={operator.role === "platform_admin"} /> : null}
          {view === "ai-governance" ? <AiGovernance api={api} token={token} onSessionExpired={onSessionExpired} canManage={operator.role === "platform_admin"} /> : null}
          {view === "infrastructure" ? <InfrastructureReadiness api={api} token={token} onSessionExpired={onSessionExpired} /> : null}
          {view === "audit" ? <AuditTrail api={api} token={token} onSessionExpired={onSessionExpired} /> : null}
        </main>
      </div>
    </div>
  );
}

function NavigationButton({ item, selected, onClick }: { item: NavigationItem; selected: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button type="button" className={`control-nav__item ${selected ? "control-nav__item--current" : ""}`} onClick={onClick} aria-current={selected ? "page" : undefined}>
      <Icon size={18} aria-hidden="true" />
      <span>{item.label}</span>
      {item.source === "pending" ? <span className="nav-source" aria-label="Fonte ainda em preparação">em breve</span> : null}
    </button>
  );
}

function Overview({
  api,
  token,
  onNavigate,
  role,
  onSessionExpired,
}: {
  api: PlatformApi;
  token: string;
  onNavigate: (view: ViewId) => void;
  role: PlatformOperatorRole;
  onSessionExpired: () => void;
}) {
  const feedbackReady = canReadFeedback(role);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);

    void api.getOverview(token)
      .then(snapshot => {
        if (current) setOverview(snapshot);
      })
      .catch(caught => {
        if (!current) return;
        if (caught instanceof PlatformApiError && caught.status === 401) {
          onSessionExpired();
          return;
        }
        setError(overviewErrorMessage(caught));
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => { current = false; };
  }, [api, onSessionExpired, requestVersion, token]);

  if (loading && !overview) return <OverviewState title="Carregando a visão geral" detail="Consultando as fontes operacionais disponíveis para este operador." />;
  if (error && !overview) return <OverviewState title="Não foi possível carregar a visão geral" detail={error} onRetry={() => setRequestVersion(version => version + 1)} />;
  if (!overview) return null;

  const aiPeriod = new Date(overview.ai_chat.period_started_at).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const capturedAt = new Date(overview.generated_at).toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" });
  const environment = import.meta.env.VITE_PLATFORM_API_BASE_URL?.includes("sandbox") ? "Sandbox"
    : ({ production: "Produção", development: "Desenvolvimento", staging: "Homologação", test: "Teste" }[overview.scope.environment] ?? overview.scope.environment);
  const receivablesObservedSince = overview.receivables.observed_since
    ? new Date(overview.receivables.observed_since).toLocaleDateString("pt-BR", { dateStyle: "medium" })
    : null;
  const nextDueAt = overview.receivables.next_due_at
    ? new Date(overview.receivables.next_due_at).toLocaleDateString("pt-BR", { dateStyle: "medium" })
    : null;

  return (
    <div className="page-flow">
      <section className="page-intro page-intro--split">
        <div>
          <h2>Panorama da plataforma</h2>
          <p>Atualizado em {capturedAt} · {environment}</p>
        </div>
        <button type="button" className="button button--secondary" onClick={() => setRequestVersion(version => version + 1)}>Atualizar</button>
      </section>

      <section className="overview-snapshot" aria-labelledby="snapshot-heading">
        <div className="section-heading">
          <div>
            <h2 id="snapshot-heading">Operação</h2>
          </div>
        </div>
        <dl className="overview-facts">
          <OverviewFact label="Empresas" value={formatNumber(overview.merchants.registered)} detail="Cadastradas" />
          <OverviewFact label="Usuários ativos" value={formatNumber(overview.merchants.active_users)} detail="Contas das empresas" />
          <OverviewFact label="Assinaturas ativas" value={formatNumber(overview.subscriptions.active_records)} detail="Estado local" />
          <OverviewFact label="Feedbacks" value={formatNumber(overview.feedback.received)} detail="Recebidos" />
        </dl>
      </section>

      <PlatformMetricsPanel api={api} token={token} onSessionExpired={onSessionExpired} />
      <Disclosure title="Detalhes da operação" note="Cobranças, infraestrutura e cobertura dos dados">
      <section className="overview-snapshot" aria-labelledby="receivables-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Financeiro observado</p>
            <h2 id="receivables-heading">Cobranças de assinatura observadas</h2>
          </div>
          <span className="source-state source-state--partial"><span aria-hidden="true" />Cobertura parcial</span>
        </div>
        <dl className="overview-facts">
          <OverviewFact
            label="Em aberto"
            value={formatOptionalNumber(overview.receivables.open_count)}
            detail={`Saldo conhecido: ${formatBrlCents(overview.receivables.open_known_balance_cents)}`}
          />
          <OverviewFact
            label="Em atraso"
            value={formatOptionalNumber(overview.receivables.overdue_count)}
            detail={`${formatOptionalNumber(overview.receivables.overdue_merchant_count)} empresas; saldo conhecido: ${formatBrlCents(overview.receivables.overdue_known_balance_cents)}`}
          />
          <OverviewFact
            label="Vencimentos"
            value={formatOptionalNumber(overview.receivables.due_next_7_days_count)}
            detail={`${formatOptionalNumber(overview.receivables.due_today_count)} vencem hoje${nextDueAt ? `; próximo: ${nextDueAt}` : ""}`}
          />
          <OverviewFact
            label="Pagamentos confirmados"
            value={formatOptionalNumber(overview.receivables.confirmed_payment_count_since_capture)}
            detail={`Valor conhecido: ${formatBrlCents(overview.receivables.confirmed_payment_known_amount_cents_since_capture)}`}
          />
        </dl>
        <p className="overview-disclosure">
          {overview.receivables.financial_metrics_available
            ? `${formatNumber(overview.receivables.observed_receivables)} cobranças observadas${receivablesObservedSince ? ` desde ${receivablesObservedSince}` : ""}. Valores são fatos de webhook e não receita conciliada.`
            : "Ainda não há cobranças Asaas, Stripe ou Mercado Pago capturadas. Os indicadores ficam sem valor até o primeiro evento autenticado."}
        </p>
      </section>

      <section className="overview-snapshot" aria-labelledby="ai-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Uso de IA</p>
            <h2 id="ai-heading">Chat no período atual</h2>
          </div>
          <span className="source-state source-state--partial"><span aria-hidden="true" />Cobertura parcial</span>
        </div>
        <dl className="overview-facts overview-facts--three">
          <OverviewFact label="Eventos de chat" value={formatNumber(overview.ai_chat.usage_events)} detail={`Desde ${aiPeriod}`} />
          <OverviewFact label="Tokens processados" value={formatNumber(overview.ai_chat.total_tokens)} detail={`${formatNumber(overview.ai_chat.priced_usage_events)} com preço conhecido`} />
          <OverviewFact label="Custo conhecido" value={formatUsdMicros(overview.ai_chat.known_cost_micros)} detail={`${formatNumber(overview.ai_chat.unpriced_usage_events)} eventos sem preço; USD estimado`} />
        </dl>
      </section>

      <section className="overview-snapshot" aria-labelledby="readiness-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Infraestrutura</p>
            <h2 id="readiness-heading">Readiness no momento da consulta</h2>
          </div>
          <span className={`source-state ${overview.infrastructure.readiness === "ready" ? "source-state--ready" : "source-state--unavailable"}`}><span aria-hidden="true" />{overview.infrastructure.readiness === "ready" ? "Pronta" : "Indisponível"}</span>
        </div>
        <dl className="overview-facts overview-facts--three">
          <OverviewFact label="Banco de dados" value={overview.infrastructure.database} detail="Resultado da readiness atual" />
          <OverviewFact label="Redis" value={overview.infrastructure.redis} detail="Resultado da readiness atual" />
          <OverviewFact label="Sinais e histórico local" value="Parcial" detail="Filas e integrações; sem monitoramento externo contínuo" />
        </dl>
      </section>

      <section className="source-ledger" aria-labelledby="feedback-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Fonte disponível</p>
            <h2 id="feedback-heading">Feedback das empresas</h2>
          </div>
          <span className="source-state source-state--ready"><span aria-hidden="true" />Conectada</span>
        </div>
        <div className="source-ledger__body">
          <MessageSquareMore size={22} aria-hidden="true" />
          <p>Acompanhe sugestões e problemas enviados pelas empresas.</p>
          {feedbackReady ? <button type="button" className="button button--primary" onClick={() => onNavigate("feedback")}>Abrir fila</button> : <span className="quiet-note">Seu papel não inclui a leitura da fila.</span>}
        </div>
      </section>

      <section className="coverage-section" aria-labelledby="coverage-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Cobertura de dados</p>
            <h2 id="coverage-heading">Fontes e limites da leitura</h2>
          </div>
          <span className="quiet-note">Sem inferências financeiras</span>
        </div>
        <ul className="coverage-list">
          {overviewSourceRows.map(row => <CoverageRow key={row.source} icon={row.icon} title={row.title} source={overview.sources[row.source]} />)}
        </ul>
      </section>
      </Disclosure>
    </div>
  );
}

function OverviewState({ title, detail, onRetry }: { title: string; detail: string; onRetry?: () => void }) {
  return (
    <section className="overview-state" aria-live="polite">
      <p className="eyebrow">Visão geral</p>
      <h2>{title}</h2>
      <p>{detail}</p>
      {onRetry ? <button type="button" className="button button--secondary" onClick={onRetry}>Tentar novamente</button> : null}
    </section>
  );
}

function OverviewFact({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd><small>{detail}</small></div>;
}

function CoverageRow({ icon: Icon, title, source }: { icon: LucideIcon; title: string; source: PlatformOverview["sources"][PlatformOverviewSourceId] }) {
  return (
    <li className="coverage-row">
      <span className="coverage-icon"><Icon size={18} aria-hidden="true" /></span>
      <span><strong>{title}</strong><small>{source.description}</small></span>
      <SourceState status={source.status} />
    </li>
  );
}

function SourceState({ status }: { status: PlatformOverview["sources"][PlatformOverviewSourceId]["status"] }) {
  const label = status === "available" ? "Disponível" : status === "partial" ? "Parcial" : "Indisponível";
  return <span className={`source-state source-state--${status}`}><span aria-hidden="true" />{label}</span>;
}

function OperatorLogin({ onSubmit, initialMessage }: { onSubmit: (email: string, password: string) => Promise<void>; initialMessage: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialMessage);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(email.trim(), password);
      setPassword("");
    } catch (caught) {
      setError(loginErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-introduction" aria-label="Sobre o Zyon Control">
        <div className="control-brand control-brand--login">
          <img className="control-mark" src="/zyon-z.png" alt="" width="44" height="33" />
          <span><strong>Zyon</strong><small>Control</small></span>
        </div>
        <div>
          <p className="eyebrow">Acesso de operadores</p>
          <h1>Uma central para a operação da plataforma.</h1>
          <p>Acesse com sua conta interna de operador.</p>
        </div>
        <ul className="login-notes">
          <li><ShieldCheck size={17} aria-hidden="true" />Permissões aplicadas pelo servidor</li>
          <li><FileClock size={17} aria-hidden="true" />Comandos de tratamento são auditados</li>
        </ul>
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <div>
          <p className="eyebrow">Identificação</p>
          <h2 id="login-title">Entrar no Control</h2>
          <p>Informe seu e-mail de operador e sua senha.</p>
        </div>
        <form className="login-form" onSubmit={submit} aria-busy={busy}>
          <label className="field" htmlFor="operator-email">
            <span>E-mail</span>
            <input id="operator-email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} placeholder="operador@zyon.com.br" required disabled={busy} />
          </label>
          <label className="field" htmlFor="operator-password">
            <span>Senha</span>
            <input id="operator-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} />
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button button--primary button--wide" type="submit" disabled={busy}>{busy ? "Verificando acesso..." : "Entrar"}</button>
        </form>
      </section>
    </main>
  );
}

function SessionSkeleton() {
  return (
    <main className="session-skeleton" aria-label="Verificando sessão" aria-busy="true">
      <div className="skeleton-mark" />
      <div><span className="skeleton-line skeleton-line--wide" /><span className="skeleton-line" /></div>
    </main>
  );
}

function canReadFeedback(role: PlatformOperatorRole): boolean {
  return role === "platform_admin" || role === "support_ops" || role === "auditor";
}

function canReadMerchantDirectory(role: PlatformOperatorRole): boolean {
  return role === "platform_admin" || role === "billing_ops" || role === "support_ops" || role === "auditor";
}

function canReadOrders(role: PlatformOperatorRole): boolean {
  return role === "platform_admin";
}

function canReadBilling(role: PlatformOperatorRole): boolean {
  return role === "platform_admin" || role === "billing_ops" || role === "auditor";
}

function canReadAiUsage(role: PlatformOperatorRole): boolean {
  return role === "platform_admin" || role === "billing_ops" || role === "auditor";
}

function canReadInfrastructure(role: PlatformOperatorRole): boolean {
  return role === "platform_admin" || role === "infra_ops" || role === "auditor";
}

function canReadAudit(role: PlatformOperatorRole): boolean {
  return role === "platform_admin" || role === "auditor";
}

function canReadNavigationItem(item: NavigationItem, role: PlatformOperatorRole): boolean {
  if (item.permission === "support") return role === "platform_admin" || role === "support_ops";
  if (item.permission === "feedback") return canReadFeedback(role);
  if (item.permission === "merchants") return canReadMerchantDirectory(role);
  if (item.permission === "orders") return canReadOrders(role);
  if (item.permission === "billing") return canReadBilling(role);
  if (item.permission === "ai-usage") return canReadAiUsage(role);
  if (item.permission === "infrastructure") return canReadInfrastructure(role);
  if (item.permission === "audit") return canReadAudit(role);
  return true;
}

function loginErrorMessage(error: unknown): string {
  if (error instanceof PlatformApiError && error.status === 503) return "A autenticação interna ainda não está configurada neste ambiente.";
  if (error instanceof PlatformApiError && error.status === 401) return "E-mail ou senha de operador inválidos.";
  return "Não foi possível verificar o acesso. Tente novamente.";
}

function overviewErrorMessage(error: unknown): string {
  if (error instanceof PlatformApiError && error.status === 403) return "Seu papel não possui permissão para consultar esta visão geral.";
  return "A leitura das fontes operacionais falhou. Tente novamente.";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatOptionalNumber(value: number | null): string {
  return value === null ? "Sem dados" : formatNumber(value);
}

function formatBrlCents(value: string | null): string {
  if (value === null) return "Sem valor conhecido";
  try {
    const cents = BigInt(value);
    const sign = cents < 0n ? "-" : "";
    const absolute = cents < 0n ? -cents : cents;
    const reais = absolute / 100n;
    const centsPart = (absolute % 100n).toString().padStart(2, "0");
    return `R$ ${sign}${formatBigInteger(reais)},${centsPart}`;
  } catch {
    return "Sem valor conhecido";
  }
}

function formatUsdMicros(value: string): string {
  try {
    const micros = BigInt(value);
    const sign = micros < 0n ? "-" : "";
    const absolute = micros < 0n ? -micros : micros;
    const dollars = absolute / 1_000_000n;
    const cents = ((absolute % 1_000_000n) / 10_000n).toString().padStart(2, "0");
    return `US$ ${sign}${formatBigInteger(dollars)},${cents}`;
  } catch {
    return "Indisponível";
  }
}

function formatBigInteger(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
