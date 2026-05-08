import {
  CheckCircle2,
  CreditCard,
  Gift,
  LockKeyhole,
  MessageCircle,
  Package,
  Send,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Store,
  Tag,
  Trash2,
  Truck,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { ChatTurn, CheckoutExperienceSnapshot } from "@aacp/shared-types";
import { GlobalAuthModal } from "../../global-auth-modal.js";
import { useStreamedText } from "../../use-streamed-text.js";
import type { CheckoutAgentViewModel } from "../../use-checkout-agent-view-model.js";
import {
  agentGivenAndRest,
  agentTypingLine,
  bubbleKey,
  cn,
  formatCurrency,
  quickReplyId,
  STAGE_FLOW,
  stageLabel,
  themeStyle
} from "../../checkout-view-model.js";

const STEP_ICONS = {
  data_collection: UserRound,
  shipping: Truck,
  payment: CreditCard,
  completed: CheckCircle2
} as const;

export function CheckoutShell({ vm }: { vm: CheckoutAgentViewModel }) {
  if (!vm.isConversational) return <FloatingCheckout vm={vm} />;

  return (
    <section
      className="aacp-widget aacp-widget--conversational aacp-page"
      style={themeStyle(vm.theme)}
      data-cart-open={vm.cartOpen ? "true" : undefined}
    >
      <div className="aacp-shell">
        <main className="aacp-main">
          <CheckoutHeader vm={vm} />
          <CheckoutStepper vm={vm} />
          <ChatThread vm={vm} />
          <Composer vm={vm} />
        </main>
        <CartPanel vm={vm} />
        <button
          type="button"
          className="aacp-mobile-cart-fab"
          onClick={() => vm.setCartOpen(true)}
          aria-expanded={vm.cartOpen}
          aria-controls="aacp-cart-panel"
          aria-label="Abrir resumo do pedido"
        >
          <span className="aacp-mobile-cart-icon" aria-hidden="true">
            <ShoppingBag size={18} />
          </span>
          <span>
            <strong>Carrinho</strong>
            <em>{formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}</em>
          </span>
        </button>
        <button
          type="button"
          className={cn("aacp-backdrop", vm.cartOpen && "open")}
          onClick={() => vm.setCartOpen(false)}
          aria-label="Fechar resumo do pedido"
        />
      </div>
      <GlobalAuthModal auth={vm.auth} hub={vm.hub} />
    </section>
  );
}

function FloatingCheckout({ vm }: { vm: CheckoutAgentViewModel }) {
  return (
    <section className="aacp-widget fixed bottom-5 right-5 z-50 font-merchant" style={themeStyle(vm.theme)}>
      {vm.open ? (
        <div className="aacp-panel flex h-[560px] w-[min(380px,calc(100vw-32px))] flex-col overflow-hidden rounded-[30px] border border-white/10 bg-slate-950/90 text-white shadow-agentic-glow backdrop-blur-2xl">
          <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4">
            <div>
              <strong className="block text-sm font-black">Assistente de checkout</strong>
              <span className="mt-1 block text-xs text-white/50">
                {vm.session?.global_user_id
                  ? `Cliente ${vm.session.global_user_id.slice(0, 12)}`
                  : "Conectando a API..."}
              </span>
            </div>
            <button className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/10 transition hover:bg-white/15" type="button" aria-label="Fechar chat" onClick={() => vm.setOpen(false)}>
              <X size={18} />
            </button>
          </header>
          <div className="aacp-lines aacp-scrollbar flex flex-1 flex-col gap-2 overflow-y-auto p-4" role="log" aria-live="polite">
            {vm.turns.map((turn, index) => (
              <p
                key={`${turn.role}-${index}-${turn.occurredAt}`}
                className={cn(
                  turn.role,
                  "max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                  turn.role === "agent" ? "self-start bg-white/10 text-white" : "self-end bg-[var(--aacp-accent)] text-white"
                )}
              >
                {turn.text}
              </p>
            ))}
          </div>
          <form
            className="flex gap-2 border-t border-white/10 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void vm.sendMessage();
            }}
          >
            <input
              className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35"
              value={vm.message}
              onChange={(event) => vm.setMessage(event.target.value)}
              placeholder="Digite sua duvida..."
              disabled={vm.busy || Boolean(vm.networkError)}
              aria-label="Mensagem para o assistente"
            />
            <button className="grid h-11 w-11 place-items-center rounded-full bg-[var(--aacp-accent)] text-white disabled:opacity-50" type="submit" aria-label="Enviar mensagem" disabled={vm.busy || !vm.message.trim()}>
              <Send size={18} />
            </button>
          </form>
        </div>
      ) : (
        <button
          type="button"
          className="aacp-launcher grid h-16 w-16 place-items-center rounded-3xl bg-[var(--aacp-accent)] text-white shadow-[0_18px_44px_color-mix(in_srgb,var(--aacp-accent)_35%,transparent)] transition hover:-translate-y-1"
          aria-label="Abrir assistente"
          onClick={() => vm.setOpen(true)}
        >
          <MessageCircle size={24} />
        </button>
      )}
    </section>
  );
}

function CheckoutHeader({ vm }: { vm: CheckoutAgentViewModel }) {
  const agentName = agentGivenAndRest(vm.activeExperience.agent.name);
  return (
    <header className="aacp-header aacp-shell-header">
      <div className="aacp-header-left">
        <div className="aacp-avatar" aria-hidden="true">
          {vm.theme.agentAvatarUrl ? <img src={vm.theme.agentAvatarUrl} alt="" /> : <Sparkles size={20} />}
          <span className="aacp-status-dot" />
        </div>
        <div className="min-w-0">
          <div className="aacp-agent-name">
            <span>{agentName.given}</span>
            {agentName.rest ? (
              <>
                <span className="sep">·</span>
                <span className="role">{agentName.rest}</span>
              </>
            ) : (
              <span className="role">Assistente de Vendas</span>
            )}
          </div>
          <div className="aacp-agent-sub">
            <span className="live-dot" />
            {vm.activeExperience.brand.name} · online · responde em segundos
          </div>
        </div>
      </div>
      <div className="aacp-header-actions">
        <button
          type="button"
          className={cn("aacp-google-login aacp-login-btn", vm.auth.session && "is-authenticated")}
          onClick={vm.auth.session ? vm.auth.openHub : vm.auth.openLogin}
        >
          <span className="aacp-login-mark" aria-hidden="true">
            <Smartphone size={14} />
          </span>
          <span>
            <strong>{vm.auth.session ? "Minha conta" : "Entrar"}</strong>
            <em>{vm.auth.session ? vm.auth.session.email : "Login por celular"}</em>
          </span>
        </button>
      </div>
    </header>
  );
}

function CheckoutStepper({ vm }: { vm: CheckoutAgentViewModel }) {
  const activeIndex = STAGE_FLOW.findIndex((step) => step.key === vm.checkoutStage);
  return (
    <section className="aacp-command aacp-flow-rail" aria-label="Fluxo do checkout">
      <div
        className="aacp-timeline"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={(Math.max(activeIndex, 0) + 1) * 25}
        aria-label={`Etapa: ${stageLabel(vm.checkoutStage)}`}
      >
        {STAGE_FLOW.map((step, index) => {
          const status = index < activeIndex ? "done" : index === activeIndex ? "active" : "todo";
          const Icon = STEP_ICONS[step.key];
          return (
            <div className="aacp-timeline-fragment" key={step.key}>
              <div className={`aacp-tl-step ${status}`}>
                <div className="aacp-tl-node" aria-hidden="true">
                  {status === "done" ? <CheckCircle2 size={16} /> : <Icon size={16} />}
                </div>
                <div className="aacp-tl-label">{step.shortLabel}</div>
              </div>
              {index < STAGE_FLOW.length - 1 ? (
                <div className={`aacp-tl-line ${index < activeIndex ? "filled" : ""}`} aria-hidden="true" />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ChatThread({ vm }: { vm: CheckoutAgentViewModel }) {
  const agentName = agentGivenAndRest(vm.activeExperience.agent.name);
  return (
    <div className="aacp-thread aacp-chat-thread" ref={vm.threadRef} role="log" aria-live="polite" aria-label="Conversa">
      {vm.networkError ? <NetworkError vm={vm} /> : null}

      {vm.turns.map((turn, index) => {
        const key = bubbleKey(turn, index);
        return (
          <ChatBubble
            key={key}
            turn={turn}
            agentName={vm.activeExperience.agent.name}
            bubbleKey={key}
            streamingKey={vm.streamingTurnKey}
            onAgentTypingDone={vm.handleAgentTypingDone}
          />
        );
      })}

      {vm.busy ? (
        <div className="aacp-typing" aria-label={agentTypingLine(vm.activeExperience.agent.name)}>
          <strong>{agentName.given}</strong> esta digitando
          <span className="aacp-dots" aria-hidden="true"><span /><span /><span /></span>
        </div>
      ) : null}

      {vm.showOfferBanner ? <OfferBanner vm={vm} /> : null}

      {vm.showComposer && !vm.composerLocked && vm.quickReplies.length > 0 ? (
        <div className="aacp-quicks aacp-quick-replies aacp-quick-replies--in-thread" role="group" aria-label="Respostas sugeridas">
          {vm.quickReplies.map((reply) => (
            <button className="aacp-chip" key={quickReplyId(reply)} type="button" onClick={() => void vm.tapQuick(reply)}>
              {reply.label}
            </button>
          ))}
        </div>
      ) : null}

      {vm.checkoutStage === "completed" ? (
        <div className="aacp-completion-card" role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          <div>
            <strong>Pedido confirmado</strong>
            <span>
              {vm.lastChat?.message ??
                "Seu pedido foi confirmado. Voce recebera os detalhes, o codigo de rastreio e o resumo do checkout."}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChatBubble({
  turn,
  agentName,
  bubbleKey: key,
  streamingKey,
  onAgentTypingDone
}: {
  turn: ChatTurn;
  agentName: string;
  bubbleKey: string;
  streamingKey: string | null;
  onAgentTypingDone?: (key: string) => void;
}) {
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const shouldStream = streamingKey !== null && key === streamingKey && turn.role === "agent";
  const { displayed, isStreaming } = useStreamedText(turn.text, {
    enabled: shouldStream,
    skipCompleteWhenDisabled: turn.role === "agent",
    onComplete: turn.role === "agent" ? () => onAgentTypingDone?.(key) : undefined
  });
  const showCaret = shouldStream && isStreaming;
  const { given } = agentGivenAndRest(agentName);

  useEffect(() => {
    if (typeof bubbleRef.current?.scrollIntoView !== "function") return;
    bubbleRef.current.scrollIntoView({ block: "end" });
  }, [displayed]);

  return (
    <div
      ref={bubbleRef}
      className={cn(
        "aacp-bubble aacp-chat-bubble",
        turn.role === "agent"
          ? "aacp-bubble-agent aacp-chat-bubble--agent"
          : "aacp-bubble-buyer aacp-chat-bubble--buyer"
      )}
    >
      {turn.role === "agent" ? <div className="aacp-bubble-label">{given}</div> : null}
      <span className="aacp-chat-text">
        {displayed}
        {showCaret ? <span className="chat-caret aacp-chat-caret" aria-hidden="true" /> : null}
      </span>
    </div>
  );
}

function NetworkError({ vm }: { vm: CheckoutAgentViewModel }) {
  return (
    <div className="aacp-network-error" role="alert">
      <span>{vm.networkError}</span>
      <button type="button" className="aacp-retry" onClick={vm.retryStartCheckout}>
        Tentar novamente
      </button>
    </div>
  );
}

function OfferBanner({ vm }: { vm: CheckoutAgentViewModel }) {
  return (
    <div className="aacp-offer aacp-offer-banner aacp-offer-banner--in-thread" role="status">
      <div className="aacp-offer-icon"><Gift size={18} /></div>
      <div className="aacp-offer-text aacp-offer-banner-text">
        <strong>Oferta aplicada</strong>
        <span>
          -{formatCurrency(vm.visibleTotals.discount, vm.visibleTotals.currency)} · novo total{" "}
          {formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}
        </span>
      </div>
      <button className="aacp-offer-cta" type="button" onClick={() => void vm.continueToPayment()} disabled={vm.busy}>
        Continuar
      </button>
    </div>
  );
}

function Composer({ vm }: { vm: CheckoutAgentViewModel }) {
  if (!vm.showComposer) return null;
  return (
    <div className="aacp-composer-wrap">
      <div className="aacp-composer-hint" id="aacp-inline-composer-label">
        {vm.activeExperience.copy.expected_input_type === "email"
          ? "Digite seu email para avancar"
          : vm.activeExperience.copy.expected_input_type === "tel"
            ? "Digite seu telefone com DDD"
            : vm.activeExperience.copy.expected_input_type === "number"
              ? "Digite o dado solicitado apenas com numeros"
              : "Sua vez - quando quiser, responda"}
      </div>
      <form
        className="aacp-composer aacp-input-form aacp-input-form--inline"
        aria-labelledby="aacp-inline-composer-label"
        onSubmit={(event) => {
          event.preventDefault();
          void vm.sendMessage();
        }}
      >
        <input
          className="aacp-input"
          ref={vm.composerInputRef}
          value={vm.message}
          onChange={(event) => vm.setMessage(event.target.value)}
          placeholder={
            vm.checkoutStage === "payment"
              ? "Prefiro PIX"
              : vm.checkoutStage === "shipping"
                ? "Digite o CEP ou numero"
                : "Escreva sua mensagem..."
          }
          aria-label="Mensagem para o assistente"
          autoComplete="off"
          disabled={vm.composerLocked}
          type={
            vm.activeExperience.copy.expected_input_type === "email"
              ? "email"
              : vm.activeExperience.copy.expected_input_type === "tel"
                ? "tel"
                : "text"
          }
          inputMode={vm.activeExperience.copy.expected_input_type === "number" ? "numeric" : undefined}
          pattern={vm.activeExperience.copy.expected_input_type === "number" ? "[0-9]*" : undefined}
        />
        <button className="aacp-send" type="submit" aria-label="Enviar mensagem" disabled={vm.composerLocked || !vm.message.trim()}>
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}

function CartPanel({ vm }: { vm: CheckoutAgentViewModel }) {
  const experience = vm.activeExperience;
  return (
    <aside
      id="aacp-cart-panel"
      className={cn("aacp-cart", vm.cartOpen && "open")}
      aria-label="Resumo do pedido"
    >
      <div className="aacp-cart-header">
        {vm.theme.logoUrl ? (
          <img src={vm.theme.logoUrl} alt={experience.brand.name} className="aacp-cart-logo" />
        ) : (
          <div className="aacp-cart-logo" aria-hidden="true"><Store size={20} /></div>
        )}
        <div className="aacp-cart-brand" style={{ flex: 1, minWidth: 0 }}>
          <strong>{experience.brand.name}</strong>
          <span className="aacp-cart-headline">Pedido #{vm.session?.session_id?.slice(-6) ?? experience.brand.merchant_id}</span>
        </div>
        <button className="aacp-cart-close" onClick={() => vm.setCartOpen(false)} aria-label="Fechar resumo" type="button">
          <X size={18} />
        </button>
      </div>

      <div className="aacp-intel">
        <div>
          <span>Etapa</span>
          <strong>{stageLabel(vm.checkoutStage)}</strong>
        </div>
        <div>
          <span>Frete</span>
          <strong>{vm.visibleTotals.shipping > 0 ? formatCurrency(vm.visibleTotals.shipping, vm.visibleTotals.currency) : "A validar"}</strong>
        </div>
        <div>
          <span>Protecao</span>
          <strong>{vm.offer?.approved ? "Oferta" : "Ativa"}</strong>
        </div>
      </div>

      <div className="aacp-cart-badges" role="group" aria-label="Garantias e seguranca">
        <span className="aacp-badge"><ShieldCheck size={12} />Margem protegida</span>
        <span className="aacp-badge"><ShieldCheck size={12} />Sem dados sensiveis</span>
        <span className="aacp-badge"><LockKeyhole size={12} />Identidade em coleta</span>
      </div>

      <div className="aacp-cart-title">
        <span className="aacp-cart-title-kicker">Carrinho</span>
        <strong>Seu pedido agora</strong>
        <p>
          {vm.cartItemCount} item{vm.cartItemCount === 1 ? "" : "s"} no carrinho · {experience.brand.name}
        </p>
      </div>

      <div>
        <div className="aacp-section-title">Itens</div>
        <ul className="aacp-items aacp-cart-items">
          {vm.visibleItems.length > 0 ? (
            vm.visibleItems.map((item) => (
              <li className="aacp-item aacp-cart-item" key={item.sku}>
                {item.image_url ? (
                  <img src={item.image_url} alt={item.name} className="aacp-item-thumb" />
                ) : (
                  <div className="aacp-item-thumb" aria-hidden="true"><Package size={22} /></div>
                )}
                <div className="aacp-item-info">
                  <div className="aacp-item-name">{item.name}</div>
                  <div className="aacp-item-meta">
                    {item.variant ? `${item.variant} · ` : ""}Qtd x {item.quantity}
                  </div>
                  <button
                    type="button"
                    className="aacp-cart-item-remove"
                    aria-label={`Remover ${item.name}`}
                    onClick={() => vm.handleRemoveCartItem(item.sku)}
                    disabled={vm.busy}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    Remover
                  </button>
                </div>
                <div className="aacp-item-price">{formatCurrency(item.line_total, vm.visibleTotals.currency)}</div>
              </li>
            ))
          ) : (
            <li className="aacp-cart-empty" role="status">
              <strong>Carrinho vazio</strong>
              <span>Voce pode voltar ao chat e continuar quando quiser.</span>
            </li>
          )}
        </ul>
      </div>

      <dl className="aacp-totals aacp-cart-totals">
        <dt>Subtotal</dt>
        <dd>{formatCurrency(vm.visibleTotals.subtotal, vm.visibleTotals.currency)}</dd>
        {vm.visibleTotals.shipping > 0 ? (
          <>
            <dt>Frete</dt>
            <dd>{formatCurrency(vm.visibleTotals.shipping, vm.visibleTotals.currency)}</dd>
          </>
        ) : null}
        {vm.visibleTotals.discount > 0 ? (
          <>
            <dt>Desconto</dt>
            <dd className="discount">-{formatCurrency(vm.visibleTotals.discount, vm.visibleTotals.currency)}</dd>
          </>
        ) : null}
        <div className="aacp-cart-total">
          <dt className="total-row">Total</dt>
          <dd className="total-row value">{formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}</dd>
        </div>
      </dl>

      {vm.showCouponBox ? (
        <form
          className="aacp-coupon aacp-cart-coupon"
          onSubmit={(event) => {
            event.preventDefault();
            void vm.submitCoupon();
          }}
        >
          <Tag size={16} aria-hidden="true" />
          <input
            value={vm.coupon}
            onChange={(event) => vm.setCoupon(event.target.value)}
            placeholder="Cupom de desconto"
            aria-label="Cupom de desconto"
            disabled={vm.busy || Boolean(vm.networkError)}
          />
          <button type="submit" disabled={vm.busy || !vm.coupon.trim()}>Aplicar</button>
        </form>
      ) : null}

      {!vm.showOfferBanner && vm.offer?.approved ? (
        <button type="button" className="aacp-cta" disabled={vm.busy} onClick={() => void vm.applyOffer()}>
          Aplicar oferta autorizada
        </button>
      ) : null}

      {vm.config.mode === "embed" && vm.session ? (
        <button type="button" className="aacp-cta aacp-cta-secondary" disabled={vm.busy} onClick={() => void vm.createEmbedPaymentIntentDemo()}>
          Demo: gerar cobranca (PIX)
        </button>
      ) : null}

      <ul className="aacp-trust aacp-cart-trust">
        <li><CheckCircle2 size={14} />Compra segura e identidade validada no servidor</li>
        <li><CheckCircle2 size={14} />O assistente nunca solicita senha ou CVV no chat</li>
        {experience.copy.trust_badges.slice(0, 3).map((badge) => (
          <li key={badge}><CheckCircle2 size={14} />{badge}</li>
        ))}
      </ul>
    </aside>
  );
}

export type CheckoutShellExperience = CheckoutExperienceSnapshot;
