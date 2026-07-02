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
import { useEffect, useRef, useState } from "react";
import type { AccountHubSection, AccountHubState } from "../../hooks/use-account-hub.js";
import type { GlobalAuthController } from "../../hooks/use-global-auth.js";
import { cn } from "../../hooks/checkout-presentation.js";

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

/**
 * FOCUSABLE_SELECTOR — matches all interactive elements that should receive
 * keyboard focus within a dialog. Excludes disabled elements and hidden inputs.
 */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * useFocusTrap — moves focus into the dialog on open, traps Tab/Shift+Tab
 * within it, and restores focus to the previously-focused element on close.
 * Pressing Escape calls onClose.
 *
 * P2 (ADR 0002 components): fixes WCAG 2.1.2 / 2.4.3 violations where
 * keyboard users could tab behind the modal and no Escape dismiss existed.
 */
function useFocusTrap(
  active: boolean,
  dialogRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    // Remember the element that had focus before the dialog opened.
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    // Move focus to the first focusable element in the dialog.
    const dialog = dialogRef.current;
    if (dialog) {
      const firstFocusable = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      firstFocusable?.focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const dlg = dialogRef.current;
      if (!dlg) return;
      const focusable = Array.from(dlg.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Restore focus to the previously focused element when dialog closes.
      previousFocusRef.current?.focus();
    };
  }, [active, dialogRef, onClose]);
}

export function GlobalAuthModal({ auth, hub }: GlobalAuthModalProps) {
  const [phone, setPhone] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [phoneCode, setPhoneCode] = useState("");
  const dialogRef = useRef<HTMLElement | null>(null);

  // P2: focus trap + Escape dismiss (WCAG 2.1.2, 2.4.3).
  useFocusTrap(auth.open, dialogRef, auth.close);

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
    <div className="zyon-auth-layer" role="presentation">
      <div className="zyon-auth-backdrop" onClick={auth.close} aria-hidden />
      <section
        ref={(el) => { dialogRef.current = el; }}
        className="zyon-auth-dialog zyon-login-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zyon-login-title"
      >
        <button type="button" className="zyon-icon-button zyon-auth-close" onClick={auth.close} aria-label="Fechar">
          <X size={20} />
        </button>

        <div className="zyon-auth-icon" aria-hidden>
          <LogIn size={24} />
        </div>

        <span className="zyon-auth-eyebrow">Conta segura</span>
        <h2 id="zyon-login-title" className="zyon-auth-title">
          Entrar com celular
        </h2>
        <p className="zyon-auth-copy">
          Acesse pedidos anteriores e conclua compras futuras com menos etapas.
        </p>

        <div className="zyon-auth-assurance">
          <ShieldCheck size={17} />
          <span>Seu acesso e seus dados permanecem protegidos.</span>
        </div>

        <button type="button" className="zyon-auth-provider" disabled>
          <span className="zyon-auth-provider-mark" aria-hidden>G</span>
          Entrar com Google em breve
        </button>

        <div className="zyon-auth-divider" aria-hidden>
          <span>ou use seu celular</span>
        </div>

        <form
          className="zyon-auth-form"
          onSubmit={(event) => event.preventDefault()}
        >
          {!codeSent ? (
            <label className="zyon-auth-field">
              <span>Celular</span>
              <div className="zyon-auth-input-wrap">
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
            <label className="zyon-auth-field">
              <span>Codigo de verificacao</span>
              <div className="zyon-auth-input-wrap">
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
            <p className="zyon-auth-status" role="status">
              Codigo enviado para {normalizedPhone}
            </p>
          ) : null}

          {auth.error ? (
            <p className="zyon-auth-error" role="alert">
              {auth.error}
            </p>
          ) : null}

          <button
            type="button"
            className="zyon-auth-primary"
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
            <button type="button" className="zyon-auth-secondary" onClick={() => setCodeSent(false)}>
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
  const dialogRef = useRef<HTMLElement | null>(null);

  // P2: same focus trap for the hub panel.
  useFocusTrap(auth.open, dialogRef, auth.close);

  return (
    <div className="zyon-auth-layer" role="presentation">
      <div className="zyon-auth-backdrop" onClick={auth.close} aria-hidden />
      <section
        ref={(el) => { dialogRef.current = el; }}
        className="zyon-auth-dialog zyon-hub-sheet zyon-hub-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zyon-hub-title"
      >
        <header className="zyon-hub-header">
          <div className="zyon-hub-identity">
            <div className="zyon-hub-mark" aria-hidden>
              <ShieldCheck size={20} />
            </div>
            <div>
              <span>Conta verificada</span>
              <strong id="zyon-hub-title">{auth.session?.email}</strong>
            </div>
          </div>
          <button type="button" className="zyon-icon-button" onClick={auth.close} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>

        <div className="zyon-hub-layout">
          <nav className="zyon-hub-nav" aria-label="Navegacao da conta">
            <div className="zyon-hub-nav-label">Sua conta</div>
            {HUB_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={cn("zyon-hub-nav-item", hub.section === item.key && "is-active")}
                  onClick={() => hub.setSection(item.key)}
                  aria-current={hub.section === item.key ? "page" : undefined}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              );
            })}
            <button type="button" className="zyon-hub-logout" onClick={auth.logout}>
              <LogOut size={18} />
              <span>Sair da conta</span>
            </button>
          </nav>

          <main className="zyon-hub-content">
            <div className="zyon-hub-content-head">
              <div>
                <span>Central do comprador</span>
                <h2>{currentLabel}</h2>
              </div>
              <span className="zyon-hub-secure-label">
                <ShieldCheck size={15} />
                Sessao protegida
              </span>
            </div>

            {hub.loading ? <div className="zyon-hub-state">Carregando...</div> : null}
            {hub.error && !hub.loading ? <div className="zyon-hub-state is-error">{hub.error}</div> : null}

            {!hub.loading && !hub.error && hub.section === "summary" ? (
              <div className="zyon-hub-section">
                <article className="zyon-hub-overview">
                  <span>Resumo da operacao</span>
                  <h3>{merchant?.name ?? "Sua conta"}</h3>
                  <p>
                    {overview
                      ? `${overview.conversations_started} sessões iniciadas hoje.`
                      : "Seus dados de compra aparecerao aqui assim que estiverem disponiveis."}
                  </p>
                </article>
                <div className="zyon-hub-metrics">
                  <MetricCard label="Experiencia" value={theme?.fontFamily ?? "Padrao da loja"} />
                  <MetricCard
                    label="Metodo de acesso"
                    value={auth.session?.provider === "password" ? "Senha" : "Celular"}
                  />
                </div>
              </div>
            ) : null}

            {!hub.loading && !hub.error && hub.section === "orders" ? (
              <div className="zyon-hub-section">
                <SectionIntro
                  title="Pedidos recentes"
                  description="Acompanhe as sessoes e valores associados a esta conta."
                />
                <div className="zyon-hub-list">
                  {overview?.recent_sessions?.length ? (
                    overview.recent_sessions.map((session) => (
                      <article key={session.sessionId} className="zyon-hub-list-row">
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
              <div className="zyon-hub-section">
                <SectionIntro
                  title="Desempenho operacional"
                  description="Indicadores essenciais da experiencia assistida."
                />
                <div className="zyon-hub-metrics">
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
              <div className="zyon-hub-section">
                <SectionIntro
                  title="Assistente da loja"
                  description="Entenda quem conduz a experiencia e como ele opera."
                />
                <dl className="zyon-hub-details">
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
              <div className="zyon-hub-section">
                <SectionIntro
                  title="Dados da conta"
                  description="Informacoes usadas para identificar sua sessao de compra."
                />
                <dl className="zyon-hub-details">
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
    <header className="zyon-hub-section-intro">
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
    <article className={cn("zyon-hub-metric", emphasis && "is-emphasis")}>
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
  return <div className="zyon-hub-empty">{text}</div>;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
