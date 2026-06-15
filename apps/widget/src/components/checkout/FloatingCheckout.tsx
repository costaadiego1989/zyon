import { MessageCircle, Send, X } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn, themeStyle } from "../../hooks/checkout-presentation.js";
import { ThemeStudio } from "./ThemeStudio.js";

export function FloatingCheckout({ vm }: { vm: CheckoutAgentViewModel }) {
  return (
    <section className="aacp-widget fixed bottom-5 right-5 z-50 font-merchant" style={themeStyle(vm.theme, false, vm.colorMode)} data-theme={vm.colorMode}>
      {vm.open ? (
        <div className="aacp-panel flex h-[560px] w-[min(380px,calc(100vw-32px))] flex-col overflow-hidden rounded-[var(--aacp-radius-lg)] border border-[var(--aacp-line-strong)] bg-[var(--aacp-surface)] text-[var(--aacp-fg)] shadow-[var(--aacp-shadow-lg)]">
          <header className="flex items-center justify-between gap-3 border-b border-[var(--aacp-line-strong)] px-4 py-4 bg-[var(--aacp-panel-bg)]">
            <div>
              <strong className="block text-sm font-black">Assistente de checkout</strong>
              <span className="mt-1 block text-xs text-[var(--aacp-muted)]">
                {vm.session?.global_user_id
                  ? `Cliente ${vm.session.global_user_id.slice(0, 12)}`
                  : "Conectando a API..."}
              </span>
            </div>
            <button className="grid h-9 w-9 place-items-center rounded-[var(--aacp-radius-sm)] border border-[var(--aacp-line-strong)] bg-[var(--aacp-surface)] transition hover:bg-[var(--aacp-accent-hover-bg)]" type="button" aria-label="Fechar chat" onClick={() => vm.setOpen(false)}>
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
                  turn.role === "agent" ? "self-start bg-[var(--aacp-surface-2)] text-[var(--aacp-fg)] border border-[var(--aacp-line-strong)]" : "self-end bg-[var(--aacp-accent)] text-white"
                )}
              >
                {turn.text}
              </p>
            ))}
          </div>
          <form
            className="flex gap-2 border-t border-[var(--aacp-line-strong)] bg-[var(--aacp-panel-bg)] p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void vm.sendMessage();
            }}
          >
            <input
              className="min-w-0 flex-1 rounded-[var(--aacp-radius-pill)] border border-[var(--aacp-line-strong)] bg-[var(--aacp-surface)] px-4 py-3 text-sm text-[var(--aacp-fg)] outline-none placeholder:text-[var(--aacp-faint)]"
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
          className="aacp-launcher grid h-16 w-16 place-items-center rounded-[var(--aacp-radius-lg)] bg-[var(--aacp-accent)] text-white shadow-[var(--aacp-shadow-md)] transition hover:-translate-y-0.5"
          aria-label="Abrir assistente"
          onClick={() => vm.setOpen(true)}
        >
          <MessageCircle size={24} />
        </button>
      )}
      <ThemeStudio studio={vm.themeStudio} theme={vm.theme} />
    </section>
  );
}
