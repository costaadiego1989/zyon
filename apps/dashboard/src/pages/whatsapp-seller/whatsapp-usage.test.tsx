import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WhatsAppUsageTab, whatsappUsageMoney } from "./WhatsAppUsageTab.js";
describe("WhatsApp consumption presentation", () => {
  it("preserves a real zero in the provider's currency", () => { expect(whatsappUsageMoney(0, "BRL")).toContain("R$"); expect(whatsappUsageMoney(0, "BRL")).toContain("0,00"); });
  it("never represents unavailable spend as zero", () => { expect(whatsappUsageMoney(null, "BRL")).toBe("Indisponível"); });
  it("does not invent currency when Meta withholds it", () => { expect(whatsappUsageMoney(2, null)).toContain("moeda não informada"); expect(whatsappUsageMoney(2, null)).not.toContain("R$"); });
  it("keeps retry and direct Meta billing available when the consumption request fails", () => {
    const html=renderToStaticMarkup(<WhatsAppUsageTab vm={{data:null,error:"Falha na consulta",loading:false,period:"month",setPeriod:()=>{},refresh:async()=>{}}} />);
    expect(html).toContain('role="alert"');expect(html).toContain("Falha na consulta");expect(html).toContain("Abrir faturamento da Meta");expect(html).not.toContain("R$ 0");
  });
});
