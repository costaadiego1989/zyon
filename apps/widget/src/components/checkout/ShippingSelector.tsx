import React from "react";
import type { ShippingQuote } from "@zyon/shared-types";
import { formatCurrency } from "../../hooks/checkout-presentation.js";

interface ShippingSelectorProps {
  options: ShippingQuote[];
  selectedMethod?: string;
  onSelect: (option: ShippingQuote) => void;
  busy?: boolean;
}

export const ShippingSelector: React.FC<ShippingSelectorProps> = ({
  options,
  selectedMethod,
  onSelect,
  busy
}) => {
  if (!options || options.length === 0) return null;

  return (
    <div className="zyon-shipping-selector mt-3 flex flex-col gap-2">
      <p className="mb-1 px-1 text-xs font-medium opacity-60">Selecione o frete:</p>
      <div className="grid grid-cols-1 gap-2">
        {options.map((option) => {
          const displayCarrier = option.carrier?.trim() || "Transportadora";
          const displayMethod = option.method?.trim() || "Frete";
          const isSelected = selectedMethod === option.method;
          return (
            <button
              key={`${displayCarrier}-${displayMethod}-${option.customerPrice}`}
              disabled={busy}
              onClick={() => onSelect(option)}
              className={`
                flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition-all
                ${isSelected
                  ? "border-[var(--aacp-accent)] bg-[var(--aacp-accent)] bg-opacity-10"
                  : "border-[var(--aacp-fg)] border-opacity-10 bg-[var(--aacp-bg)] hover:border-opacity-30"}
              `}
            >
              <div className="min-w-0 flex flex-col">
                <span className="text-[10px] font-medium uppercase tracking-[0.08em] opacity-55">{displayCarrier}</span>
                <span className="truncate text-sm font-semibold">{displayMethod}</span>
                <span className="text-[10px] opacity-60">{option.deliveryDays} dias uteis</span>
              </div>
              <div className="shrink-0 text-sm font-bold text-[var(--aacp-accent)]">
                {option.customerPrice === 0 ? "Gratis" : formatCurrency(option.customerPrice, "BRL")}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
