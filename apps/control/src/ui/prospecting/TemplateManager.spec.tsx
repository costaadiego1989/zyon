import {expect,it,vi} from "vitest";
import {TemplateManager} from "./TemplateManager.js";
import {screenProps,show} from "./screen-test.js";
import type {ProspectingMaxPrice} from "@zyon/shared-types";

it("MAX-PRICE AC5 creates an explicit capped draft without choosing a price or budget for the operator",async()=>{
 const rows:Array<{id:string;name:string;revision:number;state:string;body:string;maxPrice?:ProspectingMaxPrice|null}>=[];
 const createTemplate=vi.fn(async command=>{
  const draft={...command,id:"priced-local",name:"zyon_varejo_price",revision:1,state:"draft",reason:null,observedAt:null};rows.push(draft);return draft;
 });
 const submitTemplate=vi.fn(async()=>{rows[0]={...rows[0],state:"PENDING"};return rows[0];});
 const props=screenProps({templates:async()=>[...rows],createTemplate,submitTemplate});
 const ui=await show(<TemplateManager {...props} bindingAvailable/>);
 await ui.click("Preparar mensagem");await ui.fill("Nome da mensagem","zyon_varejo");await ui.fill("Texto da mensagem","Olá! Podemos apresentar a Zyon para sua loja?");
 await ui.fill("Preço da mensagem","max_price");expect(ui.control("Teto por entrega (R$)").value).toBe("");
 expect(ui.button("Salvar rascunho da mensagem").disabled).toBe(true);await ui.click("Salvar rascunho da mensagem");expect(createTemplate).not.toHaveBeenCalled();
 await ui.fill("Teto por entrega (R$)","0,15");await ui.click("Salvar rascunho da mensagem");
 expect(createTemplate.mock.calls[0][0]).toEqual({name:"zyon_varejo",language:"pt_BR",body:"Olá! Podemos apresentar a Zyon para sua loja?",maxPrice:{currency:"BRL",amountPerThousandMinor:15000},clientRequestId:expect.any(String)});
 expect(ui.text()).toContain("Max Price · teto de R$ 0,15 por entrega");expect(ui.text()).toContain("Não enviado à Meta");expect(submitTemplate).not.toHaveBeenCalled();
 await ui.click("Enviar zyon_varejo_price à Meta");expect(ui.text()).toContain("Em análise pela Meta");expect(ui.text()).not.toContain("Aprovado pela Meta");
 expect(submitTemplate.mock.calls[0]).toEqual(["priced-local",{expectedRevision:1,clientRequestId:expect.any(String)}]);
});

it("MAX-PRICE AC5 keeps standard drafts compatible and explains a provider pricing mismatch",async()=>{
 const createTemplate=vi.fn(async c=>({...c,id:"normal",state:"draft",name:"normal",revision:1}));
 const ui=await show(<TemplateManager {...screenProps({templates:async()=>[],createTemplate})} bindingAvailable={false}/>);
 await ui.click("Preparar mensagem");await ui.fill("Nome da mensagem","zyon_normal");await ui.fill("Texto da mensagem","Mensagem revisada");await ui.click("Salvar rascunho da mensagem");
 expect(createTemplate.mock.calls[0][0]).toEqual({name:"zyon_normal",language:"pt_BR",body:"Mensagem revisada",clientRequestId:expect.any(String)});
 const choose=vi.fn();const mismatch=await show(<TemplateManager {...screenProps({templates:async()=>[{id:"price",name:"wrong_price",body:"Oferta",state:"APPROVED",reason:"template_pricing_mismatch",maxPrice:{currency:"BRL",amountPerThousandMinor:10000}}]})} bindingAvailable choose={choose}/>);
 expect(mismatch.text()).toContain("O preço observado na Meta difere");expect(mismatch.button("Usar wrong_price nesta campanha").disabled).toBe(true);await mismatch.click("Usar wrong_price nesta campanha");expect(choose).not.toHaveBeenCalled();
});
