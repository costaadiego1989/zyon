import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,it,expect} from "vitest";
import type {MarketplaceSellerDebt} from "../../../api/endpoints/marketplace-v2.js";
import {MarketplaceDebtPrincipal,marketplaceDebtStatusLabel} from "./MarketplaceDebtPrincipal.js";

const debt: MarketplaceSellerDebt = {id:"debt",settlementId:"settlement",amountCents:8000,recoveredAmountCents:0,
  extinguishedAmountCents:8000,outstandingAmountCents:0,status:"extinguished",deductedFromSettlementId:null,
  createdAt:"2026-10-05T00:00:00.000Z",resolvedAt:"2026-10-05T00:01:00.000Z"};
const render = (patch: Partial<MarketplaceSellerDebt> = {}) => renderToStaticMarkup(<MarketplaceDebtPrincipal debt={{...debt,...patch}} />);

describe("marketplace native principal extinction",()=>{
  it("separates principal extinction from seller recovery and payout permission",()=>{
    const html=render();
    expect(html).toContain("Principal extinto");expect(html).toContain("Principal recuperado</dt><dd>R$ 0,00");
    expect(html).toContain("Principal restante</dt><dd>R$ 0,00");expect(html).toContain("Taxas e repasses são conciliados separadamente.");
    expect(html).not.toContain("Saldo atualizado não informado");expect(html).not.toContain("Repasse liberado");
  });
  it("preserves older recovery projections without inventing an extinction",()=>{
    const html=render({status:"outstanding",extinguishedAmountCents:undefined,recoveredAmountCents:3000,outstandingAmountCents:5000});
    expect(html).toContain("Principal recuperado</dt><dd>R$ 30,00");expect(html).toContain("Principal restante</dt><dd>R$ 50,00");
    expect(html).not.toContain("Principal extinto");expect(html).not.toContain("Saldo atualizado não informado");
  });
  it("does not claim a cleared balance when the extinction amount is missing",()=>{
    const html=render({extinguishedAmountCents:undefined});expect(html).toContain("Saldo atualizado não informado");
    expect(html).not.toContain("Principal restante");expect(html).not.toContain("encerrou este principal");
  });
  it("withholds inconsistent certified arithmetic instead of reporting a fabricated recovery",()=>{
    const html=render({recoveredAmountCents:1000,extinguishedAmountCents:7000});expect(html).toContain("Saldo atualizado não informado");
    expect(html).not.toContain("Principal recuperado");expect(html).not.toContain("encerrou este principal");
  });
  it.each([
    ["outstanding","Em aberto"],["deducted","Deduzido"],["resolved","Resolvido"],
    ["extinguished","Principal extinto"],["unexpected","Status não confirmado"],
  ])("labels %s without silently calling a different terminal state resolved",(status,label)=>{
    expect(marketplaceDebtStatusLabel(status as MarketplaceSellerDebt["status"])).toBe(label);
  });
});
