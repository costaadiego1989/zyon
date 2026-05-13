import { type FormEvent, useCallback, useState } from "react";
import { CreditCard, Lock, AlertCircle, Loader2 } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { formatCurrency } from "../../hooks/checkout-view-model.js";
import { CHECKOUT_EMBED_PATHS, CHECKOUT_LEGACY_PATHS } from "../../lib/embed-client.js";

export type CardBrand = "visa" | "mastercard" | "elo" | "amex" | "unknown";

export function detectBrand(digits: string): CardBrand {
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(digits)) return "elo";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^5[1-5]|^2[2-7]/.test(digits)) return "mastercard";
  if (/^4/.test(digits)) return "visa";
  return "unknown";
}

export function luhnCheck(rawInput: string): boolean {
  const digits = rawInput.replace(/\D/g, "");
  if (digits.length < 13) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i]!, 10);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function validateExpiry(value: string): boolean {
  const match = value.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return false;
  const month = parseInt(match[1]!, 10);
  const year = 2000 + parseInt(match[2]!, 10);
  if (month < 1 || month > 12) return false;
  const now = new Date();
  return new Date(year, month - 1, 1) >= new Date(now.getFullYear(), now.getMonth(), 1);
}

function maskNumber(raw: string, brand: CardBrand): string {
  const digits = raw.replace(/\D/g, "");
  const groups = brand === "amex" ? [4, 6, 5] : [4, 4, 4, 4];
  let result = "";
  let pos = 0;
  for (const g of groups) {
    if (pos >= digits.length) break;
    if (result) result += " ";
    result += digits.slice(pos, pos + g);
    pos += g;
  }
  return result;
}

const BRAND_LABEL: Record<CardBrand, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  elo: "Elo",
  amex: "Amex",
  unknown: "Cartão"
};

function CardPreview({ number, name, expiry, brand }: { number: string; name: string; expiry: string; brand: CardBrand }) {
  return (
    <div
      className="relative w-full rounded-2xl p-4 text-white shadow-lg overflow-hidden select-none"
      style={{
        background: "linear-gradient(135deg, var(--aacp-accent) 0%, color-mix(in srgb, var(--aacp-accent) 60%, #000) 100%)",
        minHeight: 140
      }}
    >
      <div
        className="absolute inset-0 opacity-10"
        style={{ backgroundImage: "radial-gradient(circle at 70% 30%, white 0%, transparent 60%)" }}
        aria-hidden="true"
      />
      <div className="relative flex flex-col h-full justify-between gap-3">
        <div className="text-xs font-bold uppercase tracking-widest opacity-70">{BRAND_LABEL[brand]}</div>
        <div className="text-xl font-mono tracking-widest">
          {number || "•••• •••• •••• ••••"}
        </div>
        <div className="flex justify-between text-xs">
          <div>
            <div className="opacity-60 text-[10px] uppercase">Titular</div>
            <div className="font-bold tracking-wide">{name || "NOME DO TITULAR"}</div>
          </div>
          <div className="text-right">
            <div className="opacity-60 text-[10px] uppercase">Validade</div>
            <div className="font-bold">{expiry || "MM/AA"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-[var(--aacp-line)] bg-[var(--aacp-surface-3)] px-3 py-2.5 text-sm text-[var(--aacp-fg)] placeholder:text-[var(--aacp-muted)] focus:outline-none focus:border-[var(--aacp-accent)]";

export function CardForm({ vm }: { vm: CheckoutAgentViewModel }) {
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [brand, setBrand] = useState<CardBrand>("unknown");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const total = formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency);
  const cvvLen = brand === "amex" ? 4 : 3;

  const handleNumberChange = useCallback((raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, brand === "amex" ? 15 : 16);
    const newBrand = detectBrand(digits);
    setBrand(newBrand);
    setNumber(maskNumber(digits, newBrand));
    setFieldErrors((prev) => ({ ...prev, number: "" }));
  }, [brand]);

  const handleExpiryChange = useCallback((raw: string) => {
    let v = raw.replace(/\D/g, "").slice(0, 4);
    if (v.length >= 3) v = `${v.slice(0, 2)}/${v.slice(2)}`;
    setExpiry(v);
    setFieldErrors((prev) => ({ ...prev, expiry: "" }));
  }, []);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    const digits = number.replace(/\D/g, "");
    if (!luhnCheck(digits)) errs.number = "Número de cartão inválido.";
    if (!name.trim()) errs.name = "Informe o nome do titular.";
    if (!validateExpiry(expiry)) errs.expiry = "Data de validade inválida ou expirada.";
    if (cvv.length !== cvvLen) errs.cvv = `CVV deve ter ${cvvLen} dígitos.`;
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    if (typeof location !== "undefined" && location.protocol !== "https:" && location.hostname !== "localhost") {
      setError("Pagamento com cartão requer conexão segura (HTTPS).");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const [expiryMonth, expiryYear] = expiry.split("/");
      const base = vm.apiOrigin.replace(/\/$/, "");
      const paths = vm.config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
      const bodyPayload: Record<string, unknown> = {
        session_id: vm.session?.session_id,
        idempotency_key: crypto.randomUUID(),
        method: "card",
        credit_card: {
          holderName: name.trim(),
          number: number.replace(/\D/g, ""),
          expiryMonth: expiryMonth ?? "",
          expiryYear: expiryYear ? `20${expiryYear}` : "",
          ccv: cvv,
        },
        ...(vm.config.mode !== "embed" && { merchant_id: vm.activeExperience.brand.merchant_id }),
      };
      const res = await fetch(`${base}${paths.paymentIntents}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(bodyPayload),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? "Pagamento recusado.");
      }

      const data = (await res.json()) as { amount_cents?: number; currency?: string };
      const amountCents = data.amount_cents ?? Math.round(vm.visibleTotals.total * 100);
      const currency = data.currency ?? vm.visibleTotals.currency;
      vm.onStripePaymentConfirmed(amountCents, currency);
      vm.setShowCardForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pagamento recusado. Verifique os dados e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-3xl border p-5 shadow-lg backdrop-blur-xl transition-all duration-300 bg-[var(--aacp-surface-2)] border-[var(--aacp-line-strong)]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 bg-[var(--aacp-surface-3)] text-[var(--aacp-accent)]">
          <CreditCard size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <strong className="block text-sm font-bold text-[var(--aacp-fg)]">Pagamento com cartão</strong>
          <span className="block text-xs text-[var(--aacp-muted)]">
            Total: {total}
            {brand !== "unknown" && <span className="ml-1 font-semibold text-[var(--aacp-fg)]">{BRAND_LABEL[brand]}</span>}
          </span>
        </div>
        <Lock size={14} className="text-[var(--aacp-success)]" />
      </div>

      <CardPreview number={number} name={name} expiry={expiry} brand={brand} />

      <form onSubmit={handleSubmit} className="grid gap-3 mt-4">
        {error ? (
          <div
            className="flex items-start gap-2 p-3 rounded-2xl text-xs font-semibold bg-red-500/10 border border-red-500/20 text-red-300"
            role="alert"
          >
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : null}

        <div>
          <input
            type="text"
            inputMode="numeric"
            placeholder="Número do cartão"
            value={number}
            onChange={(e) => handleNumberChange(e.target.value)}
            maxLength={19}
            autoComplete="cc-number"
            aria-label="Número do cartão"
            className={inputClass}
          />
          {fieldErrors.number ? <p className="text-xs text-red-400 mt-1">{fieldErrors.number}</p> : null}
        </div>

        <div>
          <input
            type="text"
            placeholder="Nome do titular (como no cartão)"
            value={name}
            onChange={(e) => { setName(e.target.value.toUpperCase()); setFieldErrors((p) => ({ ...p, name: "" })); }}
            autoComplete="cc-name"
            aria-label="Nome do titular"
            className={inputClass}
          />
          {fieldErrors.name ? <p className="text-xs text-red-400 mt-1">{fieldErrors.name}</p> : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <input
              type="text"
              inputMode="numeric"
              placeholder="MM/AA"
              value={expiry}
              onChange={(e) => handleExpiryChange(e.target.value)}
              maxLength={5}
              autoComplete="cc-exp"
              aria-label="Validade"
              className={inputClass}
            />
            {fieldErrors.expiry ? <p className="text-xs text-red-400 mt-1">{fieldErrors.expiry}</p> : null}
          </div>
          <div>
            <input
              type="text"
              inputMode="numeric"
              placeholder={`CVV (${cvvLen} dígitos)`}
              value={cvv}
              onChange={(e) => { setCvv(e.target.value.replace(/\D/g, "").slice(0, cvvLen)); setFieldErrors((p) => ({ ...p, cvv: "" })); }}
              maxLength={cvvLen}
              autoComplete="cc-csc"
              aria-label="CVV"
              className={inputClass}
            />
            {fieldErrors.cvv ? <p className="text-xs text-red-400 mt-1">{fieldErrors.cvv}</p> : null}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-1">
          <button
            type="submit"
            disabled={submitting || vm.busy}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed text-white"
            style={{ background: "var(--aacp-grad-primary)" }}
          >
            {submitting ? (
              <><Loader2 size={16} className="animate-spin" />Processando...</>
            ) : (
              <><Lock size={14} />Pagar {total}</>
            )}
          </button>
          <button
            type="button"
            onClick={() => vm.setShowCardForm(false)}
            disabled={submitting}
            className="px-4 py-3.5 rounded-xl text-xs font-bold transition-all bg-[rgba(255,255,255,0.03)] border border-[var(--aacp-line-strong)] text-[var(--aacp-muted)] hover:text-[var(--aacp-fg)] hover:border-[var(--aacp-line)]"
          >
            Cancelar
          </button>
        </div>

        <div className="flex items-center justify-center gap-2 text-[10px] text-[var(--aacp-faint)]">
          <Lock size={10} />
          <span>Dados transmitidos com criptografia TLS · Checkout transparente via Asaas</span>
        </div>
      </form>
    </div>
  );
}
