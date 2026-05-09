import { useState, type FormEvent } from "react";
import { CreditCard, Lock, AlertCircle, Loader2 } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn, formatCurrency } from "../../hooks/checkout-view-model.js";

export function CreditCardForm({ vm }: { vm: CheckoutAgentViewModel }) {
  const isDark = vm.colorMode === "dark";
  const [holderName, setHolderName] = useState("");
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [ccv, setCcv] = useState("");

  function formatCardNumber(value: string): string {
    const digits = value.replace(/\D/g, "").slice(0, 16);
    return digits.replace(/(.{4})/g, "$1 ").trim();
  }

  function formatExpiry(value: string): string {
    const digits = value.replace(/\D/g, "").slice(0, 4);
    if (digits.length >= 3) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return digits;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const digits = number.replace(/\D/g, "");
    const [month, year] = expiry.split("/");
    if (!holderName.trim() || digits.length < 13 || !month || !year || ccv.length < 3) return;

    void vm.createPaymentIntent("card", {
      holderName: holderName.trim(),
      number: digits,
      expiryMonth: month.padStart(2, "0"),
      expiryYear: year.length === 2 ? `20${year}` : year,
      ccv: ccv.trim()
    });
  }

  const total = formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency);

  return (
    <div
      className="rounded-3xl border p-5 shadow-lg backdrop-blur-xl transition-all duration-300 bg-[var(--aacp-surface-2)] border-[var(--aacp-line-strong)]"
    >
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 bg-[var(--aacp-surface-3)] text-[var(--aacp-accent)]">
          <CreditCard size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <strong className="block text-sm font-bold text-[var(--aacp-fg)]">
            Pagamento com cartão
          </strong>
          <span className="block text-xs text-[var(--aacp-muted)]">
            Total: {total} · Dados protegidos por criptografia
          </span>
        </div>
        <Lock size={14} className="text-[var(--aacp-success)]" />
      </div>

      {vm.cardError ? (
        <div
          className="flex items-start gap-2 p-3 rounded-2xl mb-4 text-xs font-semibold bg-red-500/10 border border-red-500/20 text-red-300"
          role="alert"
        >
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{vm.cardError}</span>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="grid gap-3" autoComplete="off">
        <label className="grid gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--aacp-faint)]">
            Nome no cartão
          </span>
          <input
            type="text"
            value={holderName}
            onChange={(e) => setHolderName(e.target.value)}
            placeholder="Conforme impresso no cartão"
            autoComplete="cc-name"
            className="w-full rounded-xl px-4 py-3 text-sm transition-all focus:outline-none bg-[rgba(255,255,255,0.03)] border border-[var(--aacp-line-strong)] text-[var(--aacp-fg)] placeholder-[var(--aacp-faint)] focus:border-[#a855f7]/50"
            required
            disabled={vm.busy}
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--aacp-faint)]">
            Número do cartão
          </span>
          <div className="relative">
            <input
              type="text"
              inputMode="numeric"
              value={number}
              onChange={(e) => setNumber(formatCardNumber(e.target.value))}
              placeholder="0000 0000 0000 0000"
              autoComplete="cc-number"
              className="w-full rounded-xl px-4 py-3 pl-10 text-sm font-semibold transition-all focus:outline-none bg-[rgba(255,255,255,0.03)] border border-[var(--aacp-line-strong)] text-[var(--aacp-fg)] placeholder-[var(--aacp-faint)] focus:border-[#a855f7]/50"
              required
              disabled={vm.busy}
            />
            <CreditCard size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--aacp-faint)]" />
          </div>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--aacp-faint)]">
              Validade
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={expiry}
              onChange={(e) => setExpiry(formatExpiry(e.target.value))}
              placeholder="MM/AA"
              autoComplete="cc-exp"
              className="w-full rounded-xl px-4 py-3 text-sm font-semibold transition-all focus:outline-none bg-[rgba(255,255,255,0.03)] border border-[var(--aacp-line-strong)] text-[var(--aacp-fg)] placeholder-[var(--aacp-faint)] focus:border-[#a855f7]/50"
              maxLength={5}
              required
              disabled={vm.busy}
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--aacp-faint)]">
              CVC
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={ccv}
              onChange={(e) => setCcv(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="123"
              autoComplete="cc-csc"
              className="w-full rounded-xl px-4 py-3 text-sm font-semibold transition-all focus:outline-none bg-[rgba(255,255,255,0.03)] border border-[var(--aacp-line-strong)] text-[var(--aacp-fg)] placeholder-[var(--aacp-faint)] focus:border-[#a855f7]/50"
              maxLength={4}
              required
              disabled={vm.busy}
            />
          </label>
        </div>

        <div className="flex items-center gap-3 mt-2">
          <button
            type="submit"
            disabled={vm.busy || !holderName.trim() || number.length < 19 || expiry.length < 5 || ccv.length < 3}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--aacp-grad-primary)] text-white shadow-[var(--aacp-shadow-md)]"
          >
            {vm.busy ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <Lock size={14} />
                Pagar {total}
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => vm.setShowCardForm(false)}
            disabled={vm.busy}
            className="px-4 py-3.5 rounded-xl text-xs font-bold transition-all bg-[rgba(255,255,255,0.03)] border border-[var(--aacp-line-strong)] text-[var(--aacp-muted)] hover:text-[var(--aacp-fg)] hover:border-[var(--aacp-line)]"
          >
            Cancelar
          </button>
        </div>

        <div className="flex items-center justify-center gap-2 mt-1 text-[10px] text-[var(--aacp-faint)]">
          <Lock size={10} />
          <span>Tokenizado via Asaas · Dados do cartão nunca armazenados</span>
        </div>
      </form>
    </div>
  );
}
