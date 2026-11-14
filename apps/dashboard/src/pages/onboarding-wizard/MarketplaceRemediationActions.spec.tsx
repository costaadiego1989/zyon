import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,expect,it,vi } from "vitest";
import { MarketplaceRemediationActions } from "./MarketplaceRemediationActions.js";

const labels=["Gerenciar cobranças existentes do marketplace","Gerenciar remessas existentes do marketplace",
  "Gerenciar estornos existentes do marketplace","Gerenciar retornos Asaas do marketplace",
  "Gerenciar aportes para estornos do marketplace","Gerenciar taxas existentes do marketplace","Gerenciar taxas existentes da loja principal"];
const actions=()=>labels.map((label,index)=>({id:`operation-${index}`,label,onSelect:vi.fn()}));
describe("marketplace remediation progressive disclosure",()=>{
  it("does not render or inspect actions when hidden for a new/unrestricted account",()=>{
    const forbidden=new Proxy(actions(),{get(){throw Error("hidden_operations_must_not_be_accessed");}});
    expect(renderToStaticMarkup(<MarketplaceRemediationActions visible={false} actions={forbidden}/>)).toBe("");
  });
  it("keeps all seven existing actions in a closed native accessible disclosure",()=>{
    const values=actions(),html=renderToStaticMarkup(<MarketplaceRemediationActions visible actions={values}/>);
    const details=html.match(/<details\b[^>]*>/)?.[0];expect(details).toBeDefined();expect(details).not.toMatch(/\bopen(?:\s|=|>)/);
    expect(html).toMatch(/<summary\b[^>]*>Gerenciar operações existentes<\/summary>/);
    expect(html).toContain('aria-label="Operações existentes do marketplace"');
    expect(html.match(/<nav\b/g)).toHaveLength(1);expect(html.match(/<button\b/g)).toHaveLength(7);
    expect(html.match(/type="button"/g)).toHaveLength(7);
    for(const label of labels)expect(html).toContain(label);
    expect(html).not.toMatch(/<input|<form|\bopen="|href="https?:/);
    for(const value of values)expect(value.onSelect).not.toHaveBeenCalled();
  });
  it("does not select, prepare, charge or mutate anything during repeated render",()=>{
    const values=actions();
    const first=renderToStaticMarkup(<MarketplaceRemediationActions visible actions={values}/>);
    expect(renderToStaticMarkup(<MarketplaceRemediationActions visible actions={values}/>)).toBe(first);
    for(const value of values)expect(value.onSelect).not.toHaveBeenCalled();
  });
});
