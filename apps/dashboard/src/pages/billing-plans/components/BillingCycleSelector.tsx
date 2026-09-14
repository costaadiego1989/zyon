import type { BillingCycle } from "@zyon/shared-types";
import "./billing-cycle-selector.css";
export function BillingCycleSelector({ value, onChange, annualAvailable, discountPercent = 0 }: {
  value: BillingCycle; onChange: (cycle: BillingCycle) => void; annualAvailable: boolean; discountPercent?: number;
}) {
  return <div>
    <div className="billing-cycle" role="group" aria-label="Período de cobrança">
      <button type="button" aria-pressed={value === "monthly"} onClick={() => onChange("monthly")}>Mensal</button>
      <button type="button" aria-pressed={value === "annual"} disabled={!annualAvailable} onClick={() => onChange("annual")}>Anual{annualAvailable && discountPercent > 0 ? " · " + discountPercent + "% de desconto" : ""}</button>
    </div>
    {value === "annual" && !annualAvailable && <p role="status">O anual está indisponível. Selecione o mensal para continuar.</p>}
  </div>;
}
