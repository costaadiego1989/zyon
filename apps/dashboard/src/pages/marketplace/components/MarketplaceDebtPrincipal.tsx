import React from "react";
import type { MarketplaceSellerDebt } from "../../../api/endpoints/marketplace-v2.js";
import "./marketplace-debt-principal.css";

const valid = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);

export function marketplaceDebtStatusLabel(status: MarketplaceSellerDebt["status"]): string {
  switch (status) {
    case "outstanding": return "Em aberto";
    case "deducted": return "Deduzido";
    case "resolved": return "Resolvido";
    case "extinguished": return "Principal extinto";
    default: return "Status não confirmado";
  }
}

/** Older responses expose the principal only; missing recovery is never assumed to be zero. */
export function MarketplaceDebtPrincipal({ debt }: { debt: MarketplaceSellerDebt }) {
  const original = debt.amountCents, recovered = debt.recoveredAmountCents, remaining = debt.outstandingAmountCents;
  const extinguished = debt.extinguishedAmountCents ?? (debt.status === "extinguished" ? undefined : 0);
  if (!valid(original)) return <span>Principal indisponível</span>;
  const complete = valid(recovered) && valid(remaining) && valid(extinguished) && recovered + extinguished + remaining === original &&
    (debt.status === "extinguished" ? extinguished === original && recovered === 0 && remaining === 0 : extinguished === 0);
  return <div className="marketplace-debt-principal">
    <dl aria-label="Valores do principal"><dt>Principal original</dt><dd>{money(original)}</dd>
      {complete && <><dt>Principal recuperado</dt><dd>{money(recovered)}</dd>
        {debt.status === "extinguished" && <><dt>Principal extinto</dt><dd>{money(extinguished)}</dd></>}
        <dt>Principal restante</dt><dd>{money(remaining)}</dd></>}
    </dl>
    {!complete && <small>Saldo atualizado não informado.</small>}
    {complete && debt.status === "extinguished" && <small>A restituição do provedor encerrou este principal. Taxas e repasses são conciliados separadamente.</small>}
  </div>;
}
