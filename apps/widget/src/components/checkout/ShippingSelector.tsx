import React from "react";
import type { ShippingQuote } from "@aacp/shared-types";
import { formatCurrency } from "../../hooks/checkout-view-model.js";

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
    <div className="aacp-shipping-selector mt-3 flex flex-col gap-2">
      <p className="text-xs font-medium opacity-60 mb-1 px-1">Selecione o frete:</p>
      <div className="grid grid-cols-1 gap-2">
        {options.map((option) => {
          const isSelected = selectedMethod === option.method;
          return (
            <button
              key={`${option.method}-${option.carrier}`}
              disabled={busy}
              onClick={() => onSelect(option)}
              className={`
                flex items-center justify-between p-3 rounded-xl border transition-all text-left
                ${isSelected 
                  ? "border-[var(--aacp-accent)] bg-[var(--aacp-accent)] bg-opacity-10" 
                  : "border-[var(--aacp-fg)] border-opacity-10 hover:border-opacity-30 bg-[var(--aacp-bg)]"}
              `}
            >
              <div className="flex flex-col">
                <span className="text-sm font-semibold">{option.method}</span>
                <span className="text-[10px] opacity-60">{option.deliveryDays} dias úteis</span>
              </div>
              <div className="text-sm font-bold text-[var(--aacp-accent)]">
                {option.customerPrice === 0 ? "Grátis" : formatCurrency(option.customerPrice, "BRL")}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
