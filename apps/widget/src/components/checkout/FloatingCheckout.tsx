import { MessageCircle, Send, X } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn, themeStyle } from "../../hooks/checkout-view-model.js";

export function FloatingCheckout({ vm }: { vm: CheckoutAgentViewModel }) {
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
