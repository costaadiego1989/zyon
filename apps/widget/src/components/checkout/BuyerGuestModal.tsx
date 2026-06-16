import { LogIn, User, X } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { selectBuyerGuestModalModel } from "../../presentation/selectors/buyer-guest-modal.selector.js";
import type { BuyerGuestModalModel } from "../../presentation/models/buyer-guest-modal.model.js";

export function BuyerGuestModal({ vm }: { vm: CheckoutAgentViewModel }) {
  const model = selectBuyerGuestModalModel(vm);
  if (!model.open) return null;
  return <BuyerGuestModalView model={model} />;
}

export function BuyerGuestModalView({ model }: { model: BuyerGuestModalModel }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6" role="presentation">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={model.onClose} aria-hidden />
      <section
        className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-[var(--aacp-line-strong)] bg-[var(--aacp-surface)] text-[var(--aacp-fg)] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aacp-guest-modal-title"
      >
        <header className="flex items-center justify-between border-b border-[var(--aacp-line)] px-6 py-4">
          <div>
            <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-[var(--aacp-faint)]">
              Minha conta
            </span>
            <strong id="aacp-guest-modal-title" className="text-sm font-black tracking-tight">
              Acesso ao hub do cliente
            </strong>
          </div>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--aacp-line-strong)] bg-[var(--aacp-surface-2)] transition-colors hover:bg-[var(--aacp-surface-3)]"
            onClick={model.onClose}
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex flex-col items-center px-6 py-10 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--aacp-surface-2)] text-[var(--aacp-fg)] opacity-80">
            <User size={28} />
          </div>
          <h3 className="mb-2 text-base font-bold">Entre para acessar sua conta</h3>
          <p className="mb-3 max-w-xs text-sm leading-relaxed text-[var(--aacp-muted)]">
            {model.firstName
              ? `${model.firstName}, faça login para ver pedidos anteriores e gerenciar seu perfil.`
              : "Faça login para ver pedidos anteriores e gerenciar seu perfil."}
          </p>
          {model.emailConfirmed && model.checkoutEmail ? (
            <p className="mb-6 max-w-xs text-xs leading-relaxed text-[var(--aacp-muted)]">
              Seu e-mail <strong className="text-[var(--aacp-fg)]">{model.checkoutEmail}</strong> foi
              confirmado neste pedido, mas ainda não há sessão ativa.
            </p>
          ) : (
            <div className="mb-6" />
          )}
          <button
            type="button"
            className="aacp-cta inline-flex items-center gap-2 px-5 py-2.5 text-sm"
            onClick={model.onLogin}
          >
            <LogIn size={16} />
            Entrar
          </button>
        </div>
      </section>
    </div>
  );
}
