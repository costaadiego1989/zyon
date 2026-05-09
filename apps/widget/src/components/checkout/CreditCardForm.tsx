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
      className={cn(
        "rounded-3xl border p-5 shadow-lg backdrop-blur-xl transition-all duration-300",
        isDark
          ? "border-white/10 bg-gradient-to-br from-[#15121f] to-[#1c1830] shadow-[0_8px_40px_rgba(168,85,247,0.15)]"
          : "border-purple-200/60 bg-gradient-to-br from-white to-purple-50/30 shadow-[0_8px_30px_rgba(168,85,247,0.08)]"
      )}
    >
      <div className="flex items-center gap-3 mb-5">
        <div
          className={cn(
            "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0",
            isDark ? "bg-purple-500/20 text-purple-400" : "bg-purple-100 text-purple-600"
          )}
        >
          <CreditCard size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <strong className={cn("block text-sm font-bold", isDark ? "text-white" : "text-slate-800")}>
            Pagamento com cartão
          </strong>
          <span className={cn("block text-xs", isDark ? "text-white/50" : "text-slate-500")}>
            Total: {total} · Dados protegidos por criptografia
          </span>
        </div>
        <Lock size={14} className={isDark ? "text-emerald-400" : "text-emerald-600"} />
      </div>

      {vm.cardError ? (
        <div
          className={cn(
            "flex items-start gap-2 p-3 rounded-2xl mb-4 text-xs font-semibold",
            isDark
              ? "bg-red-500/10 border border-red-500/20 text-red-300"
              : "bg-red-50 border border-red-200 text-red-700"
          )}
          role="alert"
        >
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{vm.cardError}</span>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="grid gap-3" autoComplete="off">
        <label className="grid gap-1.5">
          <span className={cn("text-[10px] font-bold uppercase tracking-widest", isDark ? "text-white/40" : "text-slate-400")}>
            Nome no cartão
          </span>
          <input
            type="text"
            value={holderName}
            onChange={(e) => setHolderName(e.target.value)}
            placeholder="Conforme impresso no cartão"
            autoComplete="cc-name"
            className={cn(
              "w-full rounded-xl px-4 py-3 text-sm transition-all focus:outline-none",
              isDark
                ? "bg-white/5 border border-white/10 text-white placeholder-white/25 focus:border-purple-500/50"
                : "bg-white border border-slate-200 text-slate-800 placeholder-slate-400 focus:border-purple-400"
            )}
            required
            disabled={vm.busy}
          />
        </label>

        <label className="grid gap-1.5">
          <span className={cn("text-[10px] font-bold uppercase tracking-widest", isDark ? "text-white/40" : "text-slate-400")}>
            Número do cartão
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={number}
            onChange={(e) => setNumber(formatCardNumber(e.target.value))}
            placeholder="0000 0000 0000 0000"
            autoComplete="cc-number"
            className={cn(
              "w-full rounded-xl px-4 py-3 text-sm font-mono tracking-wider transition-all focus:outline-none",
              isDark
                ? "bg-white/5 border border-white/10 text-white placeholder-white/25 focus:border-purple-500/50"
                : "bg-white border border-slate-200 text-slate-800 placeholder-slate-400 focus:border-purple-400"
            )}
            maxLength={19}
            required
            disabled={vm.busy}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5">
            <span className={cn("text-[10px] font-bold uppercase tracking-widest", isDark ? "text-white/40" : "text-slate-400")}>
              Validade
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={expiry}
              onChange={(e) => setExpiry(formatExpiry(e.target.value))}
              placeholder="MM/AA"
              autoComplete="cc-exp"
              className={cn(
                "w-full rounded-xl px-4 py-3 text-sm font-mono transition-all focus:outline-none",
                isDark
                  ? "bg-white/5 border border-white/10 text-white placeholder-white/25 focus:border-purple-500/50"
                  : "bg-white border border-slate-200 text-slate-800 placeholder-slate-400 focus:border-purple-400"
              )}
              maxLength={5}
              required
              disabled={vm.busy}
            />
          </label>

          <label className="grid gap-1.5">
            <span className={cn("text-[10px] font-bold uppercase tracking-widest", isDark ? "text-white/40" : "text-slate-400")}>
              CVV
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={ccv}
              onChange={(e) => setCcv(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="•••"
              autoComplete="cc-csc"
              className={cn(
                "w-full rounded-xl px-4 py-3 text-sm font-mono transition-all focus:outline-none",
                isDark
                  ? "bg-white/5 border border-white/10 text-white placeholder-white/25 focus:border-purple-500/50"
                  : "bg-white border border-slate-200 text-slate-800 placeholder-slate-400 focus:border-purple-400"
              )}
              maxLength={4}
              required
              disabled={vm.busy}
            />
          </label>
        </div>

        <div className="flex items-center gap-3 mt-2">
          <button
            type="submit"
            disabled={vm.busy}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed",
              isDark
                ? "bg-gradient-to-r from-purple-600 to-purple-700 text-white shadow-[0_8px_24px_rgba(168,85,247,0.3)] hover:shadow-[0_12px_32px_rgba(168,85,247,0.4)] hover:-translate-y-0.5"
                : "bg-gradient-to-r from-purple-600 to-purple-700 text-white shadow-md hover:shadow-lg hover:-translate-y-0.5"
            )}
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
            className={cn(
              "px-4 py-3.5 rounded-xl text-xs font-bold transition-all",
              isDark
                ? "border border-white/10 bg-white/5 text-white/60 hover:text-white hover:bg-white/10"
                : "border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50"
            )}
          >
            Cancelar
          </button>
        </div>

        <div className={cn("flex items-center justify-center gap-2 mt-1 text-[10px]", isDark ? "text-white/25" : "text-slate-400")}>
          <Lock size={10} />
          <span>Tokenizado via Asaas · Dados do cartão nunca armazenados</span>
        </div>
      </form>
    </div>
  );
}
